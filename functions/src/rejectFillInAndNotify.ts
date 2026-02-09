import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildFillInEmail } from './send-fill-in-email';

const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
  'http://localhost:4200',
  'https://localhost:4200',
]);

function applyCors(req: any, res: any): boolean {
  const origin = String(req.headers.origin || '');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Requested-With, X-Internal-Secret'
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

if (!admin.apps.length) admin.initializeApp();
const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}
function timingSafeEq(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function isInternalCall(req: any): boolean {
  const secret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
  const got = String(req.headers['x-internal-secret'] || req.headers['X-Internal-Secret'] || '');
  return !!(secret && got && timingSafeEq(got, secret));
}
async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new Error('Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
}

export const rejectFillInAndNotify = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    try {
      if (applyCors(req, res)) return;
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      let decidedByUid: string | null = null;
      if (!isInternalCall(req)) {
        const decoded = await requireAuth(req);
        decidedByUid = decoded?.uid ?? null;
      }

      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const requestId = String(body.requestId || '').trim();
      const decisionNote = body.decisionNote == null ? null : String(body.decisionNote).trim();

      if (!tenantSchema) return void res.status(400).json({ ok: false, message: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ ok: false, message: 'Missing tenantId' });
      if (!requestId) return void res.status(400).json({ ok: false, message: 'Missing requestId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // fetch request
      const { data: reqRow, error: reqErr } = await sbTenant
        .from('secretarial_requests')
        .select('id,status,request_type,child_id,lesson_occ_id')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;

      if (!reqRow) return void res.status(404).json({ ok: false, message: 'Request not found' });
      if (reqRow.status !== 'PENDING') {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין' });
      }
      if (reqRow.request_type !== 'FILL_IN') {
        return void res.status(400).json({ ok: false, message: 'Wrong request_type (expected FILL_IN)' });
      }

      const lessonId = String((reqRow as any).lesson_occ_id ?? '').trim();
      if (!lessonId) return void res.status(400).json({ ok: false, message: 'Missing lesson_occ_id on request' });

      // find occur_date
      const { data: exRow, error: exErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .select('occur_date')
        .eq('lesson_id', lessonId)
        .eq('status', 'נשלחה בקשה למילוי מקום')
        .order('occur_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exErr) throw exErr;

      const occurDate = exRow?.occur_date ? String(exRow.occur_date) : null;
      if (!occurDate) {
        return void res.status(400).json({ ok: false, message: 'לא נמצא שיעור יעד למילוי מקום (lesson_occurrence_exceptions).' });
      }

      // ✅ rejection: status "בוטל" + is_makeup_allowed TRUE
      const { error: exUpErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .update({ status: 'בוטל', is_makeup_allowed: true })
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate);
      if (exUpErr) throw exUpErr;

      // update request rejected
      const upd: any = {
        status: 'REJECTED',
        decided_at: new Date().toISOString(),
        decision_note: decisionNote || null,
      };
      if (decidedByUid) upd.decided_by_uid = decidedByUid;

      const { data: updRow, error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update(upd)
        .eq('id', requestId)
        .eq('status', 'PENDING')
        .select('id')
        .maybeSingle();
      if (updErr) throw updErr;
      if (!updRow) return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין' });

      // target info for email
      const { data: occ, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('occur_date, day_of_week, start_time, end_time, instructor_id')
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate)
        .maybeSingle();
      if (occErr) throw occErr;

      // child + parent
      const childId = String((reqRow as any).child_id ?? '').trim();
      if (!childId) throw new Error('Request missing child_id');

      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName =
        `${String(childRow.first_name ?? '').trim()} ${String(childRow.last_name ?? '').trim()}`.trim() || 'הילד/ה';

      const { data: parentRow, error: parErr } = await sbTenant
        .from('parents')
        .select('first_name,last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;

      const parentName =
        `${String(parentRow?.first_name ?? '').trim()} ${String(parentRow?.last_name ?? '').trim()}`.trim() || 'הורה';

      let instructorName: string | null = null;
      const instIdNum = (occ as any)?.instructor_id ?? null;
      if (instIdNum) {
        const { data: inst, error: instErr } = await sbTenant
          .from('instructors')
          .select('first_name,last_name')
          .eq('id_number', String(instIdNum))
          .maybeSingle();
        if (!instErr && inst) {
          instructorName = `${String(inst.first_name ?? '').trim()} ${String(inst.last_name ?? '').trim()}`.trim() || null;
        }
      }

      const target = {
        occur_date: String((occ as any)?.occur_date ?? occurDate),
        day_of_week: String((occ as any)?.day_of_week ?? ''),
        start_time: String((occ as any)?.start_time ?? ''),
        end_time: String((occ as any)?.end_time ?? ''),
        instructor_name: instructorName,
      };

      const { subject, html, text } = buildFillInEmail({
        kind: 'rejected',
        parentName,
        childName,
        farmName,
        target,
        decisionNote: decisionNote || null,
      });

      const mail = await notifyUserInternal({
        tenantSchema,
        userType: 'parent',
        uid: childRow.parent_uid,
        subject,
        html,
        text,
        category: 'fill_in',
        forceEmail: true,
      });

      return void res.status(200).json({ ok: true, mail });
    } catch (e: any) {
      console.error('rejectFillInAndNotify error', e);
      return void res.status(500).json({ ok: false, error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

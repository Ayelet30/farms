// functions/src/reject-makeup-lesson-and-notify.ts

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildMakeupLessonDecisionEmail } from './email-builders/send-makeup-lesson-decision-email';

const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Internal-Secret');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

if (!admin.apps.length) admin.initializeApp();

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
function fullName(f?: string | null, l?: string | null) {
  return `${(f ?? '').trim()} ${(l ?? '').trim()}`.trim() || null;
}

export const rejectMakeupLessonAndNotify = onRequest(
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
const source = String(body.source || '').trim(); // 'system' או ריק
      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // 1) להביא את הבקשה
      const { data: reqRow, error: reqErr } = await sbTenant
        .from('secretarial_requests')
        .select('id, status, request_type, child_id, instructor_id, lesson_occ_id, from_date, payload')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!reqRow) return void res.status(404).json({ ok: false, message: 'request not found' });
      if (reqRow.status !== 'PENDING') {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });
      }
      if (reqRow.request_type !== 'MAKEUP_LESSON') {
        return void res.status(400).json({ ok: false, message: 'Not a MAKEUP_LESSON request' });
      }

      const childId = String(reqRow.child_id || '');
      const lessonId = String(reqRow.lesson_occ_id || '');
      if (!childId || !lessonId) throw new Error('Missing child_id / lesson_occ_id in request');

      const payload = typeof reqRow.payload === 'string' ? JSON.parse(reqRow.payload) : (reqRow.payload ?? {});
      const requestedDate = String(reqRow.from_date || '').slice(0, 10);
      const requestedStart = payload.requested_start_time ?? null;
      const requestedEnd = payload.requested_end_time ?? null;

      // 2) למצוא את תאריך השיעור המקורי מתוך exceptions
      const { data: ex, error: exErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .select('occur_date')
        .eq('lesson_id', lessonId)
        .eq('status', 'נשלחה בקשה להשלמה')
        .order('occur_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exErr) throw exErr;

      const originalDate = ex?.occur_date ? String(ex.occur_date).slice(0, 10) : null;

      // 3) לעדכן exception של השיעור המקורי ל"בוטל" + ✅ להחזיר is_makeup_allowed ל-TRUE
      if (originalDate) {
        const { error: upExErr } = await sbTenant
          .from('lesson_occurrence_exceptions')
          .update({ status: 'בוטל', is_makeup_allowed: true })
          .eq('lesson_id', lessonId)
          .eq('occur_date', originalDate);
        if (upExErr) throw upExErr;
      }

      // 4) לעדכן את הבקשה ל-REJECTED
    const statusToSet = source === 'system' ? 'REJECTED_BY_SYSTEM' : 'REJECTED';

const updatePayload: any = {
  status: statusToSet,
  decided_at: new Date().toISOString(),
  decision_note: decisionNote || null,
};
      if (decidedByUid) updatePayload.decided_by_uid = decidedByUid;

      const { data: upd, error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update(updatePayload)
        .eq('id', requestId)
        .eq('status', 'PENDING')
        .select('id,status')
        .maybeSingle();
      if (updErr) throw updErr;
      if (!upd) {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });
      }

      // 5) להביא שמות ילד/ה + הורה
      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName = fullName(childRow.first_name, childRow.last_name) ?? 'הילד/ה';

      const { data: parentRow, error: parErr } = await sbTenant
        .from('parents')
        .select('first_name, last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;
      const parentName = fullName(parentRow?.first_name ?? null, parentRow?.last_name ?? null) ?? 'הורה';

      // 6) farm name
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // 7) שמות מדריכים
      let requestedInstructorName: string | null = null;
      if (reqRow.instructor_id) {
        const { data: inst, error: instErr } = await sbTenant
          .from('instructors')
          .select('first_name, last_name')
          .eq('id_number', String(reqRow.instructor_id))
          .maybeSingle();
        if (!instErr && inst) requestedInstructorName = fullName(inst.first_name, inst.last_name);
      }

      let originalStart: string | null = null;
      let originalEnd: string | null = null;
      let originalInstructorName: string | null = null;

      if (originalDate) {
        const { data: occ, error: occErr } = await sbTenant
          .from('lessons_occurrences')
          .select('start_time, end_time, instructor_id')
          .eq('lesson_id', lessonId)
          .eq('occur_date', originalDate)
          .maybeSingle();
        if (!occErr && occ) {
          originalStart = occ.start_time ?? null;
          originalEnd = occ.end_time ?? null;

          if (occ.instructor_id) {
            const { data: inst2, error: inst2Err } = await sbTenant
              .from('instructors')
              .select('first_name, last_name')
              .eq('id_number', String(occ.instructor_id))
              .maybeSingle();
            if (!inst2Err && inst2) originalInstructorName = fullName(inst2.first_name, inst2.last_name);
          }
        }
      }

      // 8) build + notify
      const { subject, html, text } = buildMakeupLessonDecisionEmail({
        kind: 'rejected',
        farmName,
        parentName,
        childName,
        requestedDate,
        requestedStart,
        requestedEnd,
        requestedInstructorName,
        originalDate,
        originalStart,
        originalEnd,
        originalInstructorName,
        decisionNote,
      });

     let mail: any = null;
let mailOk = false;
let warning: string | null = null;
let mailError: any = null;

try {
  mail = await notifyUserInternal({
    tenantSchema,
    userType: 'parent',
    uid: childRow.parent_uid,
    subject,
    html,
    text,
    category: 'makeup_lesson',
    forceEmail: true,
  });
  mailOk = true;
} catch (e: any) {
  mailOk = false;
  warning = 'הבקשה נדחתה, אך שליחת המייל נכשלה';
  mailError = { message: e?.message || String(e) };
  console.warn('rejectMakeupLessonAndNotify: mail failed', mailError);
}

return void res.status(200).json({
  ok: true,
  status: statusToSet,
  mailOk,
  warning,
  mail,
  mailError,
});
    } catch (e: any) {
      console.error('rejectMakeupLessonAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

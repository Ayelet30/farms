// functions/src/approve-add-child-and-notify.ts

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildAddChildDecisionEmail } from './email-builders/send-add-child-decision-email';

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

export const approveAddChildAndNotify = onRequest(
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
      const requestId = String(body.requestId || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      let childId = String(body.childId || '').trim();
      const decisionNote = String(body.decisionNote || '').trim() || null;

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // 0) farm name
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // 1) אם לא הגיע childId – נשלוף מהבקשה
      if (!childId) {
        const { data: reqRow, error: reqErr } = await sbTenant
          .from('secretarial_requests')
          .select('id, status, request_type, child_id')
          .eq('id', requestId)
          .maybeSingle();
        if (reqErr) throw reqErr;
        if (!reqRow) throw new Error('Request not found');

        // אם את רוצה להיות ממש קשוחה:
        // if (reqRow.request_type !== 'ADD_CHILD') throw new Error('Request is not ADD_CHILD');

        childId = String(reqRow.child_id || '').trim();
        if (!childId) throw new Error('Request missing child_id');
      }

      // 2) update request approved (רק אם PENDING)
      const updatePayload: any = {
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
        decision_note: decisionNote,
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
        return void res.status(409).json({
          ok: false,
          message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).',
        });
      }

      // 3) child => Active
      const { error: childUpdErr } = await sbTenant
        .from('children')
        .update({ status: 'Active' })
        .eq('child_uuid', childId);
      if (childUpdErr) throw childUpdErr;

      // 4) fetch child + parent
      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName =
        `${(childRow.first_name ?? '').trim()} ${(childRow.last_name ?? '').trim()}`.trim() || 'הילד/ה';

      const { data: parentRow, error: parErr } = await sbTenant
        .from('parents')
        .select('first_name, last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;

      const parentName =
        `${String(parentRow?.first_name ?? '').trim()} ${String(parentRow?.last_name ?? '').trim()}`.trim() ||
        'הורה';

      // 5) build + notify (soft-fail)
      const { subject, html, text } = buildAddChildDecisionEmail({
        kind: 'approved',
        parentName,
        childName,
        farmName,
        decisionNote,
      });

      let emailOk = true;
      let emailError: string | null = null;
      let mail: any = null;

      try {
        mail = await notifyUserInternal({
          tenantSchema,
          userType: 'parent',
          uid: childRow.parent_uid,
          subject,
          html,
          text,
          category: 'add_child',
          forceEmail: true,
        });

        if (mail && (mail.ok === false || mail.emailOk === false)) {
          emailOk = false;
          emailError = String(mail.message ?? mail.error ?? mail.emailError ?? 'שליחת מייל נכשלה').slice(0, 300);
        }
      } catch (err: any) {
        emailOk = false;
        emailError = String(err?.message ?? err ?? 'שליחת מייל נכשלה').slice(0, 300);
        console.warn('approveAddChildAndNotify: email failed but approval OK', err);
      }

      return void res.status(200).json({
        ok: true,
        childId,
        emailOk,
        emailError,
        mail,
      });
    } catch (e: any) {
      console.error('approveAddChildAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new Error('Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
}
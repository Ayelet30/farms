import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildInstructorDayOffDecisionEmail } from './email-builders/send-instructor-day-off-decision-email';

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
function parsePayload(p: any) {
  try {
    if (!p) return {};
    if (typeof p === 'string') return JSON.parse(p);
    return p;
  } catch {
    return {};
  }
}
function fmtTime(t: any) {
  const s = String(t ?? '');
  if (!s) return null;
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export const rejectInstructorDayOffAndNotify = onRequest(
  { region: 'us-central1', secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S] },
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

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // 1) בקשה
      const { data: reqRow, error: reqErr } = await sbTenant
        .from('secretarial_requests')
        .select('id,status,request_type,instructor_id,from_date,to_date,payload')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!reqRow) return void res.status(404).json({ ok: false, message: 'request not found' });

      if (reqRow.request_type !== 'INSTRUCTOR_DAY_OFF') {
        return void res.status(400).json({ ok: false, message: 'Not an INSTRUCTOR_DAY_OFF request' });
      }
      if (reqRow.status !== 'PENDING') {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });
      }

      // 2) דחייה “אטומית”
      const { data: upd, error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update({
          status: 'REJECTED',
          decided_by_uid: decidedByUid,
          decided_at: new Date().toISOString(),
          decision_note: decisionNote ?? null,
        })
        .eq('id', requestId)
        .eq('status', 'PENDING')
        .select('id,status')
        .maybeSingle();

      if (updErr) throw updErr;
      if (!upd) return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });

      // 3) שמות/חווה/מדריך
      const payload = parsePayload((reqRow as any).payload);
      const fromDate = String(reqRow.from_date ?? payload?.from_date ?? '').slice(0, 10);
      const toDate = String(reqRow.to_date ?? payload?.to_date ?? fromDate ?? '').slice(0, 10);
      const allDay = !!(payload?.all_day ?? true);
      const startTime = fmtTime(payload?.requested_start_time ?? payload?.start_time);
      const endTime = fmtTime(payload?.requested_end_time ?? payload?.end_time);

      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      const insId =
        String(
          (reqRow as any).instructor_id ||
          payload?.instructor_id ||
          payload?.instructor_id_number ||
          ''
        ).trim() || null;

      let instructorName: string | null = null;
      let instructorUid: string | null = null;

      if (insId) {
        const { data: inst, error: instErr } = await sbTenant
          .from('instructors')
          .select('uid, first_name, last_name')
          .eq('id_number', insId)
          .maybeSingle();
        if (instErr) throw instErr;
        if (inst) {
          instructorName = fullName((inst as any).first_name, (inst as any).last_name);
          instructorUid = (inst as any).uid ?? null;
        }
      }

      // 4) מייל (לא מפיל)
      let mailOk = false;
      let warning: string | null = null;
      let mail: any = null;
      let mailError: any = null;

      try {
        if (!instructorUid) {
          warning = 'הבקשה נדחתה, אך לא נמצא uid למדריך ולכן לא נשלח מייל.';
          mailOk = false;
        } else {
          const { subject, html, text } = buildInstructorDayOffDecisionEmail({
            kind: 'rejected_instructor',
            farmName,
            instructorName: instructorName ?? 'המדריך/ה',
            fromDate,
            toDate,
            allDay,
            startTime,
            endTime,
            decisionNote,
          });

          mail = await notifyUserInternal({
            tenantSchema,
            userType: 'instructor',
            uid: instructorUid,
            subject,
            html,
            text,
            category: 'instructor_day_off',
            forceEmail: true,
          });
          mailOk = true;
        }
      } catch (e: any) {
        warning = 'הבקשה נדחתה, אך שליחת המייל למדריך נכשלה';
        mailError = { message: e?.message || String(e) };
        mailOk = false;
      }

      return void res.status(200).json({ ok: true, mailOk, warning, mail, mailError });
    } catch (e: any) {
      console.error('rejectInstructorDayOffAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

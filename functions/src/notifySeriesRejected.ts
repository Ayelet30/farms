import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client'; 
import { buildSeriesRejectedEmail } from './send-series-rejected-email';

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
function stripHtml(html: string) {
  return String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const notifySeriesRejected = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    try {
      if (applyCors(req, res)) return;
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      if (!isInternalCall(req)) {
        await requireAuth(req);
      }

      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const requestId = String(body.requestId || '').trim();

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // farm name
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // request row (כולל payload + decision_note)
      const { data: reqRow, error: reqErr } = await sbTenant
        .from('secretarial_requests')
        .select('id, status, child_id, instructor_id, from_date, to_date, payload, decision_note')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!reqRow) throw new Error('Request not found');

      if (String((reqRow as any).status) !== 'REJECTED') {
        throw new Error('Request is not REJECTED (won’t send email)');
      }

      const payload: any = (reqRow as any).payload ?? {};
      const repeatWeeks = payload?.repeat_weeks ?? null;
      const isOpenEnded = !!payload?.is_open_ended;
      const requestedStartTime = String(payload?.requested_start_time ?? '').trim() || null;
      const paymentPlanId = payload?.payment_plan_id ?? null;

      const rejectReason = String((reqRow as any).decision_note ?? '').trim();

      const childId = String((reqRow as any).child_id ?? '').trim();
      if (!childId) throw new Error('Request missing child_id');

      const instructorIdNumber = String((reqRow as any).instructor_id ?? '').trim() || null;

      const startDate = (reqRow as any).from_date ? String((reqRow as any).from_date).slice(0, 10) : null;
      const endDate = isOpenEnded
        ? null
        : ((reqRow as any).to_date ? String((reqRow as any).to_date).slice(0, 10) : null);

      // child + parent
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
  .select('first_name, last_name')
  .eq('uid', childRow.parent_uid)
  .maybeSingle();
if (parErr) throw parErr;

const parentName =
  `${String(parentRow?.first_name ?? '').trim()} ${String(parentRow?.last_name ?? '').trim()}`.trim() || 'הורה';

      // instructor name
      let instructorName: string | null = null;
      if (instructorIdNumber) {
        const { data: instRow, error: instErr } = await sbTenant
          .from('instructors')
          .select('first_name,last_name,id_number')
          .eq('id_number', instructorIdNumber)
          .maybeSingle();
        if (instErr) throw instErr;

        instructorName =
          `${String(instRow?.first_name ?? '').trim()} ${String(instRow?.last_name ?? '').trim()}`.trim() ||
          (instRow?.id_number ? String(instRow.id_number) : null);
      }

      // payment plan name
      let paymentPlanName: string | null = null;
      if (paymentPlanId) {
        const { data: ppRow, error: ppErr } = await sbTenant
          .from('payment_plans')
          .select('name')
          .eq('id', paymentPlanId)
          .maybeSingle();
        if (ppErr) throw ppErr;
        paymentPlanName = String(ppRow?.name ?? '').trim() || null;
      }
const { subject, html, text } = buildSeriesRejectedEmail({
  parentName,
  childName,
  farmName,
  instructorName,
  seriesStartDate: startDate,
  seriesEndDate: endDate,
  startTime: requestedStartTime,
  isOpenEnded,
  repeatWeeks: repeatWeeks != null ? Number(repeatWeeks) : null,
  ridingTypeName: null, // אם אין לך כרגע
  paymentPlanName,
  rejectReason: rejectReason || null,
});

const mail = await notifyUserInternal({
  tenantSchema,
  userType: 'parent',
  uid: childRow.parent_uid,
  subject,
  html,
  text,
  category: 'series',
  forceEmail: true,
});

return void res.status(200).json({ ok: true, mail });

    } catch (e: any) {
      console.error('notifySeriesRejected error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

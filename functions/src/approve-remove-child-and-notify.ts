import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sendChildRemovalApprovedEmailViaGmailCF } from './send-child-removal-email';
import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
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

export const approveRemoveChildAndNotify = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    try {
      if (applyCors(req, res)) return; // ✅ זה פותר את OPTIONS
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });
if (!isInternalCall(req)) {
  await requireAuth(req);
}

      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const childId = String(body.childId || '').trim();
      const requestId = String(body.requestId || '').trim();
      const tenantId = String(body.tenantId || '').trim();


      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!childId) return void res.status(400).json({ error: 'Missing childId' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });


      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
const sbPublic = createClient(url, key, { db: { schema: 'public' } });
      const { data: fsRow, error: fsErr } = await sbTenant
  .from('farm_settings')
  .select('child_deletion_grace_days')
  .limit(1)
  .maybeSingle();

if (fsErr) throw fsErr;

if (fsErr) throw fsErr;
const { data: farmRow, error: farmErr } = await sbPublic
  .from('farms')
  .select('name')
  .eq('id', tenantId)
  .maybeSingle(); // ✅ כי id הוא PK

if (farmErr) throw farmErr;
console.log('tenantSchema=', tenantSchema, 'tenantId=', tenantId);

const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

const graceDaysRaw = fsRow?.child_deletion_grace_days;
const graceDays =
  graceDaysRaw == null ? null : Number(graceDaysRaw);

if (graceDays != null && !Number.isFinite(graceDays)) {
  throw new Error('Invalid child_deletion_grace_days in farm_settings');
}


      // 1) schedule deletion (מחזיר scheduledDeletionAt)
      const { data: scheduledIso, error: schErr } = await sbTenant.rpc('schedule_child_deletion', { p_child_id: childId });
      if (schErr) throw schErr;
      if (!scheduledIso) throw new Error('schedule_child_deletion returned empty scheduledDeletionAt');

      const scheduledDate = String(scheduledIso).slice(0, 10);

      // 2) update request approved
      const { error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update({ status: 'APPROVED', decided_at: new Date().toISOString() })
        .eq('id', requestId);
      if (updErr) throw updErr;

      // 3) fetch child + parent
      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName = `${(childRow.first_name ?? '').trim()} ${(childRow.last_name ?? '').trim()}`.trim() || 'הילד/ה';

      const { data: parentRow, error: parErr } = await sbTenant
        .from('parents')
        .select('email, first_name, last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;

      const parentEmail = String(parentRow?.email ?? '').trim();
      if (!parentEmail) throw new Error('Parent has no email in parents table');

      const parentName = `${String(parentRow?.first_name ?? '').trim()} ${String(parentRow?.last_name ?? '').trim()}`.trim() || 'הורה';

      // 4) fetch occurrences
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data: occData, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('occur_date, day_of_week, start_time, end_time, lesson_type, status, instructor_id')
        .eq('child_id', childId)
        .gte('occur_date', todayIso)
        .in('status', ['ממתין לאישור', 'אושר'])
        .order('occur_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (occErr) throw occErr;

      const occ = (occData ?? []) as any[];

      // 5) fetch instructors names
      const instructorIds = Array.from(new Set(occ.map(o => o.instructor_id).filter(Boolean)));
      let instMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      if (instructorIds.length) {
        const { data: instData, error: instErr } = await sbTenant
          .from('instructors')
          .select('id_number, first_name, last_name')
          .in('id_number', instructorIds);
        if (instErr) throw instErr;

        (instData ?? []).forEach((i: any) => {
          instMap.set(i.id_number, { first_name: i.first_name ?? null, last_name: i.last_name ?? null });
        });
      }

      const fullName = (f?: string | null, l?: string | null) =>
        `${(f ?? '').trim()} ${(l ?? '').trim()}`.trim() || '—';

      const rows = occ.map(o => {
        const ins = instMap.get(o.instructor_id);
        return {
          occur_date: o.occur_date,
          day_of_week: o.day_of_week || '—',
          start_time: o.start_time,
          end_time: o.end_time,
          lesson_type: o.lesson_type ?? '—',
          instructorName: fullName(ins?.first_name, ins?.last_name),
          willCancel: String(o.occur_date) >= scheduledDate,
        };
      });

      const willHappen = rows.filter(r => !r.willCancel);
      const willCancel = rows.filter(r => r.willCancel);

      // 6) send mail
      const sendEmailGmailUrl =
  'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';

// זה ה־secret שכבר יש לך ב־approveRemoveChildAndNotify כסוד:
const internalCallSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET')!;
if (!internalCallSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

const mailRes = await sendChildRemovalApprovedEmailViaGmailCF({
  tenantSchema,
  to: parentEmail,
  parentName,
  childName,
  farmName,
  scheduledDeletionAtIso: String(scheduledIso),
  willHappen,
  willCancel,
  graceDays,

  sendEmailGmailUrl,
  internalCallSecret,
});

      return void res.status(200).json({ ok: true, scheduledDeletionAt: scheduledIso, mail: mailRes });
    } catch (e: any) {
      console.error('approveRemoveChildAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);
async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) {
    throw new Error('Missing Bearer token');
  }
  return admin.auth().verifyIdToken(m[1]);
}

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { sendChildRemovalEmailViaGmailCF } from './send-child-removal-email';
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

 
res.setHeader(
  'Access-Control-Allow-Headers',
  'Authorization, Content-Type, X-Requested-With, X-Internal-Secret, x-internal-secret'
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

export const rejectRemoveChildAndNotify = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    // ✅ CORS תמיד ראשון, מחוץ ל-try
    if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') {
        return void res.status(405).json({ error: 'Method not allowed' });
      }

      // auth: פנימי או Bearer
      let decidedByUid: string | null = null;
      if (!isInternalCall(req)) {
        const decoded = await requireAuth(req);
        decidedByUid = decoded?.uid ?? null;
      }
      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const childId = String(body.childId || '').trim();
      const requestId = String(body.requestId || '').trim();
      const tenantId = String(body.tenantId || '').trim();
const decisionNoteRaw = body.decisionNote ?? body.decision_note ?? null;
const decisionNote =
  decisionNoteRaw == null ? null : String(decisionNoteRaw).trim();

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!childId) return void res.status(400).json({ error: 'Missing childId' });
      if (!requestId) return void res.status(400).json({ error: 'Missing requestId' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // להביא שם חווה
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();

      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // 1) לעדכן את סטטוס הבקשה ל-REJECTED
      const updatePayload: any = {
        status: 'REJECTED',
        decided_at: new Date().toISOString(),
      };
      if (decidedByUid) updatePayload.decided_by_uid = decidedByUid;
if (decisionNote) updatePayload.decision_note = decisionNote;

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
let decisionNoteFinal = decisionNote;

if (!decisionNoteFinal) {
  const { data: noteRow, error: noteErr } = await sbTenant
    .from('secretarial_requests')
    .select('decision_note')
    .eq('id', requestId)
    .maybeSingle();

  if (noteErr) throw noteErr;
  decisionNoteFinal = String(noteRow?.decision_note ?? '').trim() || null;
}

      // 2) להחזיר את הילד ל-Active + ניקוי שדות מחיקה
      //    (אם אצלך הערך המדויק באנום שונה — תחליפי כאן)
      const { error: childUpdErr } = await sbTenant
        .from('children')
        .update({
          status: 'Active',
          deletion_requested_at: null,
          scheduled_deletion_at: null,
        })
        .eq('child_uuid', childId);

      if (childUpdErr) throw childUpdErr;

      // 3) להביא ילד + הורה בשביל המייל
      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName =
        `${String(childRow.first_name ?? '').trim()} ${String(childRow.last_name ?? '').trim()}`.trim() ||
        'הילד/ה';

      const { data: parentRow, error: parErr } = await sbTenant
        .from('parents')
        .select('email, first_name, last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;

      const parentEmail = String(parentRow?.email ?? '').trim();
      if (!parentEmail) throw new Error('Parent has no email in parents table');

      const parentName =
        `${String(parentRow?.first_name ?? '').trim()} ${String(parentRow?.last_name ?? '').trim()}`.trim() ||
        'הורה';

      // 4) אופציונלי: להביא שיעורים עתידיים (כדי להרגיע במייל שהם ממשיכים כרגיל)
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

      // שמות מדריכים
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

      const upcomingRows = occ.map(o => {
        const ins = instMap.get(o.instructor_id);
        return {
          occur_date: o.occur_date,
          day_of_week: o.day_of_week || '—',
          start_time: o.start_time,
          end_time: o.end_time,
          lesson_type: o.lesson_type ?? '—',
          instructorName: fullName(ins?.first_name, ins?.last_name),
        };
      });

      // 5) שליחת מייל דרך sendEmailGmail (פנימי)
      const sendEmailGmailUrl = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';
      const internalCallSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET')!;
      if (!internalCallSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

      const mailRes = await sendChildRemovalEmailViaGmailCF({
  kind: 'rejected',
  tenantSchema,
  to: parentEmail,
  parentName,
  childName,
  farmName,
  decisionNote: decisionNoteFinal, 
  sendEmailGmailUrl,
  internalCallSecret,
});

      return void res.status(200).json({ ok: true, mail: mailRes });
    } catch (e: any) {
      // ✅ חשוב: גם בשגיאה – להבטיח CORS headers
      applyCors(req, res);
      console.error('rejectRemoveChildAndNotify error', e);
      return void res
        .status(500)
        .json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);
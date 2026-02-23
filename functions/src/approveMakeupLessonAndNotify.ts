// functions/src/approve-makeup-lesson-and-notify.ts

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildMakeupLessonDecisionEmail } from './send-makeup-lesson-decision-email';

const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
  'http://localhost:4200',
  'https://localhost:4200',
]);
function hebrewDayOfWeek(dateISO: string): string {
  // dateISO: 'YYYY-MM-DD'
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun ... 6=Sat
  const map = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;
  return map[day];
}
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

export const approveMakeupLessonAndNotify = onRequest(
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
        .select('id, status, request_type, child_id, instructor_id, lesson_occ_id, from_date, to_date, payload')
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
      const lessonId = String(reqRow.lesson_occ_id || ''); // זה lesson_id המקורי
      // להביא את השיעור המקורי כדי להעתיק ממנו נתונים (appointment_kind וכו')
const { data: originalLesson, error: origLErr } = await sbTenant
  .from('lessons')
  .select(`
    id,
    child_id,
    instructor_id,
    instructor_uid,
    start_time,
    end_time,
    appointment_kind,
    payment_plan_id,
    riding_type_id,
    payment_source,
    approval_id,
    capacity,
    current_booked
  `)
  .eq('id', lessonId)
  .maybeSingle();

if (origLErr) throw origLErr;
if (!originalLesson) throw new Error('Original lesson not found');
      if (!childId || !lessonId) throw new Error('Missing child_id / lesson_occ_id in request');

      const payload = typeof reqRow.payload === 'string' ? JSON.parse(reqRow.payload) : (reqRow.payload ?? {});
      const requestedRidingTypeId = payload.riding_type_id ?? null; // אמור להיות uuid
      if (!requestedRidingTypeId) {
  throw new Error('Missing riding_type_id in payload (new lesson riding_type_id is required)');
}
      const requestedDate = String(reqRow.from_date || '').slice(0, 10);
      const requestedStart = payload.requested_start_time ?? null;
      const requestedEnd = payload.requested_end_time ?? null;

  const baseExceptionId = payload.base_lesson_uid ?? null;
if (!baseExceptionId) throw new Error('Missing base_lesson_uid (lesson_occurrence_exceptions.id) in payload');

const { data: ex, error: exErr } = await sbTenant
  .from('lesson_occurrence_exceptions')
  .select('id, occur_date, lesson_id')
  .eq('id', baseExceptionId)
  .maybeSingle();
if (exErr) throw exErr;
if (!ex) throw new Error('Base exception not found');

const originalExId = String(ex.id);
const originalDate = String(ex.occur_date).slice(0, 10);

// ואז update לפי id (לא לפי lesson_id+date+status)
const { error: upExErr } = await sbTenant
  .from('lesson_occurrence_exceptions')
  .update({ status: 'הושלם', is_makeup_allowed: false })
  .eq('id', originalExId);
if (upExErr) throw upExErr;
const dayOfWeekHe = hebrewDayOfWeek(requestedDate);

// לקבוע מדריך לשיעור ההשלמה:
// אם בבקשה יש instructor_id -> נשתמש בו, אחרת במדריך של השיעור המקורי
const makeupInstructorId = String(reqRow.instructor_id || originalLesson.instructor_id || '').trim();
if (!makeupInstructorId) throw new Error('Missing instructor_id for makeup lesson');

// להביא instructor_uid למדריך שנבחר (אם הוא שונה מהמקורי)
let makeupInstructorUid = String(originalLesson.instructor_uid || '').trim();

if (makeupInstructorId && makeupInstructorId !== String(originalLesson.instructor_id || '').trim()) {
  const { data: instRow, error: instErr } = await sbTenant
    .from('instructors')
    .select('uid')
    .eq('id_number', makeupInstructorId)
    .maybeSingle();
  if (instErr) throw instErr;
  if (!instRow?.uid) throw new Error('Instructor missing uid');
  makeupInstructorUid = String(instRow.uid).trim();
}

if (!requestedStart || !requestedEnd) {
  throw new Error('Missing requested_start_time / requested_end_time in payload');
}

// לבנות רשומת שיעור השלמה חדשה
const newLessonPayload: any = {
  lesson_type: 'השלמה',
  status: 'אושר',
  day_of_week: dayOfWeekHe,
  start_time: requestedStart, // צריך להיות 'HH:MM:SS' או 'HH:MM'
  end_time: requestedEnd,

  child_id: originalLesson.child_id,
  repeat_weeks: 1,

  // חשוב: כדי שהמופע יצא בדיוק בתאריך המבוקש, אנחנו שמים anchor_week_start = requestedDate
  // הטריגר normalize_anchor_week_start ינרמל לשבוע - אצלך זה עובד כבר עם ה-view.
  anchor_week_start: requestedDate,

appointment_kind: 'therapy_makeup',

  // לא סדרה
  series_id: null,

  // אם תרצי לקשר לאישור בריאות של המקורי:
  approval_id: originalLesson.approval_id ?? null,

origin: 'parent',
  is_tentative: false,

  // ⚠️ MUST להיות id של lesson_occurrence_exceptions כדי לעבור FK
  base_lesson_uid: originalExId ?? null,

  capacity: originalLesson.capacity ?? null,
  current_booked: originalLesson.current_booked ?? null,

  payment_source: originalLesson.payment_source ?? 'private',
riding_type_id: requestedRidingTypeId,
  payment_plan_id: originalLesson.payment_plan_id ?? null,
  payment_docs_url: null, // לפי מה שאתם עושים "כרגיל"

  instructor_id: makeupInstructorId,
  instructor_uid: makeupInstructorUid,

  is_open_ended: false,
};

// ליצור בפועל
const { data: newLesson, error: insErr } = await sbTenant
  .from('lessons')
  .insert(newLessonPayload)
  .select('id')
  .maybeSingle();

if (insErr) throw insErr;
if (!newLesson?.id) throw new Error('Failed to create makeup lesson');

const newMakeupLessonId = String(newLesson.id);
      // 4) לעדכן את הבקשה ל-APPROVED
      const updatePayload: any = {
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
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

      // 7) שמות מדריכים (גם של המבוקש וגם המקורי)
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

      // 8) לבנות מייל + לשלוח
      const { subject, html, text } = buildMakeupLessonDecisionEmail({
        kind: 'approved',
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
        decisionNote: null,
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
  warning = 'הבקשה אושרה, אך שליחת המייל נכשלה';
  mailError = { message: e?.message || String(e) };
  console.warn('approveMakeupLessonAndNotify: mail failed', mailError);
  // לא זורקים — האישור כבר בוצע
}

return void res.status(200).json({
  ok: true,
  newMakeupLessonId,
  mailOk,
  warning,
  mail,
  mailError,
});

    } catch (e: any) {
      console.error('approveMakeupLessonAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

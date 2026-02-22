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

export const approveFillInAndNotify = onRequest(
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

      if (!tenantSchema) return void res.status(400).json({ ok: false, message: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ ok: false, message: 'Missing tenantId' });
      if (!requestId) return void res.status(400).json({ ok: false, message: 'Missing requestId' });

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

      // fetch request
      const { data: reqRow, error: reqErr } = await sbTenant
        .from('secretarial_requests')
        .select('id,status,request_type,child_id,lesson_occ_id,from_date,payload,requested_by_uid , instructor_id')
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

      // find target occur_date by exceptions (stable)
     const payload = typeof (reqRow as any).payload === 'string'
  ? JSON.parse((reqRow as any).payload)
  : ((reqRow as any).payload ?? {});

const requestedStart = payload.requested_start_time ?? null;
const requestedEnd = payload.requested_end_time ?? null;
const requestedRidingTypeId = payload.riding_type_id ?? null;

// ✅ הכי חשוב: base_lesson_uid = exception.id
const baseExceptionId = payload.base_lesson_uid ?? null;

if (!requestedStart || !requestedEnd) {
  throw new Error('Missing requested_start_time / requested_end_time in payload');
}
if (!requestedRidingTypeId) {
  throw new Error('Missing riding_type_id in payload');
}
if (!baseExceptionId) {
  throw new Error('Missing base_lesson_uid (lesson_occurrence_exceptions.id) in payload');
}

// להביא את ה-exception עצמו כדי לקבל occur_date + lesson_id (לבדיקת עקביות)
const { data: ex, error: exErr } = await sbTenant
  .from('lesson_occurrence_exceptions')
  .select('id, occur_date, lesson_id')
  .eq('id', baseExceptionId)
  .maybeSingle();
if (exErr) throw exErr;
if (!ex) throw new Error('Base exception not found');

const occurDate = String(ex.occur_date).slice(0, 10);

// לוודא שה-exception באמת שייך ל-lessonId של הבקשה
if (String(ex.lesson_id).trim() !== lessonId) {
  throw new Error('base_lesson_uid does not match request.lesson_occ_id');
}
      if (!occurDate) {
        return void res.status(400).json({ ok: false, message: 'לא נמצא שיעור יעד למילוי מקום (lesson_occurrence_exceptions).' });
      }
const { data: originalLesson, error: origLErr } = await sbTenant
  .from('lessons')
  .select(`
    id,
    child_id,
    instructor_id,
    instructor_uid,
    appointment_kind,
    payment_plan_id,
    payment_source,
    approval_id,
    capacity,
    current_booked
  `)
  .eq('id', lessonId)
  .maybeSingle();

if (origLErr) throw origLErr;
if (!originalLesson) throw new Error('Original lesson not found');
// ✅ מדריך לשיעור מילוי מקום: רק מהבקשה (secretarial_requests.instructor_id)
const fillInInstructorId = String((reqRow as any).instructor_id || '').trim();
if (!fillInInstructorId) {
  throw new Error('Request missing instructor_id (secretarial_requests.instructor_id)');
}

// להביא instructor_uid למדריך שנבחר
const { data: instRow, error: instErr } = await sbTenant
  .from('instructors')
  .select('uid')
  .eq('id_number', fillInInstructorId)
  .maybeSingle();
if (instErr) throw instErr;
if (!instRow?.uid) throw new Error('Instructor missing uid');

const fillInInstructorUid = String(instRow.uid).trim();
      // update exception: approved + is_makeup_allowed false
      const { error: exUpErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .update({ status: 'הושלם', is_makeup_allowed: false })
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate);
      if (exUpErr) throw exUpErr;
function hebrewDayOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const map = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;
  return map[day];
}

const dayOfWeekHe = hebrewDayOfWeek(occurDate);

const newLessonPayload: any = {
  lesson_type: 'מילוי מקום',
  status: 'אושר',
  day_of_week: dayOfWeekHe,
  start_time: requestedStart,
  end_time: requestedEnd,

  child_id: originalLesson.child_id,
  repeat_weeks: 1,
  anchor_week_start: occurDate,     // כדי “לעגן” את זה לתאריך

  appointment_kind: 'therapy_fill_in', // או מה שאתם משתמשים
  series_id: null,
  approval_id: originalLesson.approval_id ?? null, // ✅ העתקה מהמקורי
  origin: 'parent',
  is_tentative: false,

  base_lesson_uid: String(ex.id),   // ✅ FK ל-exception

  capacity: originalLesson.capacity ?? null,
  current_booked: originalLesson.current_booked ?? null,

  payment_source: originalLesson.payment_source ?? 'private',
  riding_type_id: requestedRidingTypeId,            // ✅ מה-payload
  payment_plan_id: originalLesson.payment_plan_id ?? null, // ✅ העתקה מהמקורי
  payment_docs_url: null,

  instructor_id: fillInInstructorId,
  instructor_uid: fillInInstructorUid,

  is_open_ended: false,
};

const { data: newLesson, error: insErr } = await sbTenant
  .from('lessons')
  .insert(newLessonPayload)
  .select('id')
  .maybeSingle();

if (insErr) throw insErr;
if (!newLesson?.id) throw new Error('Failed to create fill-in lesson');

const newFillInLessonId = String(newLesson.id);
      // update request approved
      const upd: any = {
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
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

      // fetch target lesson info for email
      const { data: occ, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('occur_date, day_of_week, start_time, end_time, instructor_id')
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate)
        .maybeSingle();
      if (occErr) throw occErr;

      // fetch child + parent
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

      // instructor name
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

      // build + notify
      const { subject, html, text } = buildFillInEmail({
        kind: 'approved',
        parentName,
        childName,
        farmName,
        target,
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
    category: 'fill_in',
    forceEmail: true,
  });
  mailOk = true;
} catch (e: any) {
  mailOk = false;
  warning = 'הבקשה אושרה, אך שליחת המייל נכשלה';
  mailError = { message: e?.message || String(e) };
  console.warn('approveFillInAndNotify: mail failed', mailError);
}

return void res.status(200).json({
  ok: true,
  newFillInLessonId,
  mailOk,
  warning,
  mail,
  mailError,
});

    } catch (e: any) {
      console.error('approveFillInAndNotify error', e);
      return void res.status(500).json({ ok: false, error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

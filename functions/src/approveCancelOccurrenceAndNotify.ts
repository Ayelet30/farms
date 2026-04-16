// functions/src/approve-cancel-occurrence-and-notify.ts

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildCancelOccurrenceDecisionEmail } from './email-builders/send-cancel-occurrence-decision-email';


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
function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export const approveCancelOccurrenceAndNotify = onRequest(
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
        .select('id,status,request_type,child_id,lesson_occ_id,from_date,to_date,payload')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!reqRow) return void res.status(404).json({ ok: false, message: 'request not found' });
      if (reqRow.status !== 'PENDING') {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });
      }
      if (reqRow.request_type !== 'CANCEL_OCCURRENCE') {
        return void res.status(400).json({ ok: false, message: 'Not a CANCEL_OCCURRENCE request' });
      }

           const payload = parsePayload((reqRow as any).payload);
      const cancelReason = String(payload?.reason ?? '').trim();
      const noteText = cancelReason
        ? `בוטל על ידי ההורה - ${cancelReason}`
        : 'בוטל על ידי ההורה';

      const cancelDate = String(reqRow.from_date ?? reqRow.to_date ?? payload?.occur_date ?? '').slice(0, 10);
      if (!cancelDate) {
        return void res.status(400).json({ ok: false, message: 'Request has no from_date/to_date' });
      }

      const childId = String(reqRow.child_id || '').trim();
      if (!childId) {
        throw new Error('Missing child_id in request');
      }
      // 2) resolve lessonId + occurrence row
const lessonIdFromReq = (reqRow as any).lesson_id ? String((reqRow as any).lesson_id) : null; // אם קיים אצלך
const lessonIdFromOcc = reqRow.lesson_occ_id ? String(reqRow.lesson_occ_id) : null;           // אצלך כנראה שזה lesson_id בפועל

const lessonId = lessonIdFromReq ?? lessonIdFromOcc;
if (!lessonId) {
  return void res.status(400).json({ ok: false, message: 'Missing lesson_id (cannot resolve from request)' });
}

const { data: occRow, error: occErr } = await sbTenant
  .from('lessons_occurrences')
  .select('lesson_id, occur_date, start_time, end_time, instructor_id')
  .eq('lesson_id', lessonId)
  .eq('occur_date', cancelDate)
  .maybeSingle();

if (occErr) throw occErr;
if (!occRow) {
  return void res.status(400).json({ ok: false, message: `No occurrence found for lesson_id=${lessonId} on ${cancelDate}` });
}
      // 2.1) farm settings לצורך זכאות להשלמה
           const { data: farmSettings, error: fsErr } = await sbTenant
        .from('farm_settings')
        .select(`
          cancel_before_hours,
          suggest_makeup_on_cancel,
          max_makeups_in_period,
          makeups_period_days,
          parent_cancel_charge_before_deadline,
          parent_cancel_charge_after_deadline,
          parent_cancel_charge_timing
        `)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fsErr) throw fsErr;
      if (!farmSettings) {
        return void res.status(400).json({ ok: false, message: 'Missing farm settings' });
      }

      // 2.2) האם הביטול בוצע בזמן לפי cancel_before_hours
      const lessonStart = new Date(`${cancelDate}T${String(occRow.start_time).slice(0, 8)}`);
      const now = new Date();

      const timeDiffMs = lessonStart.getTime() - now.getTime();
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

      const cancelBeforeHours = Number(farmSettings.cancel_before_hours ?? 0);
      const isBeforeCancelDeadline = timeDiffHours >= cancelBeforeHours;

      // 2.3) שליפת כל ה-lessons של הילד כדי לספור ביטולים קודמים שזוכו להשלמה
      const { data: childLessons, error: childLessonsErr } = await sbTenant
        .from('lessons')
        .select('id')
        .eq('child_id', childId);

      if (childLessonsErr) throw childLessonsErr;

      const childLessonIds = (childLessons || [])
        .map((r: any) => r.id)
        .filter(Boolean);

      // 2.4) ספירת ביטולים קודמים שזוכו להשלמה בתוך הטווח
      let usedMakeupsInPeriod = 0;

      if (
        childLessonIds.length > 0 &&
        farmSettings.max_makeups_in_period != null &&
        farmSettings.makeups_period_days != null
      ) {
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - Number(farmSettings.makeups_period_days));
        const fromDateStr = toDateOnlyString(fromDate);

        const { count, error: countErr } = await sbTenant
          .from('lesson_occurrence_exceptions')
          .select('*', { count: 'exact', head: true })
          .in('lesson_id', childLessonIds)
          .eq('is_makeup_allowed', true)
          .gte('occur_date', fromDateStr);

        if (countErr) throw countErr;
        usedMakeupsInPeriod = count || 0;
      }

      // 2.5) החלטה סופית - האם השיעור זכאי להשלמה
      const suggestMakeup = farmSettings.suggest_makeup_on_cancel === true;

      let underQuota = true;
      if (
        farmSettings.max_makeups_in_period != null &&
        farmSettings.makeups_period_days != null
      ) {
        underQuota = usedMakeupsInPeriod < Number(farmSettings.max_makeups_in_period);
      }

      const isMakeupAllowed = suggestMakeup && isBeforeCancelDeadline && underQuota;
      // 2.6) החלטת חיוב
     // 2.6) החלטה האם הביטול עצמו מחויב
let isBillable = false;

if (isBeforeCancelDeadline) {
  // ביטול בזמן
  isBillable = farmSettings.parent_cancel_charge_before_deadline === true
    && String(farmSettings.parent_cancel_charge_timing || 'at_cancel') === 'at_cancel';
} else {
  // ביטול מאוחר
  isBillable = farmSettings.parent_cancel_charge_after_deadline === true
    && String(farmSettings.parent_cancel_charge_timing || 'at_cancel') === 'at_cancel';
}
console.log('cancel billing decision', {
  cancelDate,
  lessonStart: lessonStart.toISOString(),
  now: now.toISOString(),
  timeDiffHours,
  cancelBeforeHours,
  isBeforeCancelDeadline,
  parent_cancel_charge_before_deadline: farmSettings.parent_cancel_charge_before_deadline,
  parent_cancel_charge_after_deadline: farmSettings.parent_cancel_charge_after_deadline,
  parent_cancel_charge_timing: farmSettings.parent_cancel_charge_timing,
  isBillable,
});
      // 3) upsert exception (כמו RPC)
           // 3) upsert exception (כמו RPC)
           const { error: upExErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .upsert(
          {
            lesson_id: lessonId,
            occur_date: cancelDate,
            status: 'בוטל',
            note: noteText,
            canceller_role: 'parent',
            cancelled_at: new Date().toISOString(),
            is_makeup_allowed: isMakeupAllowed,


            is_billable: isBillable,
          } as any,
          { onConflict: 'lesson_id,occur_date' }
        );
      if (upExErr) throw upExErr;

      // 4) update request -> APPROVED
      const updPayload: any = {
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
        decision_note: decisionNote ?? null,
      };
      if (decidedByUid) updPayload.decided_by_uid = decidedByUid;

      const { data: upd, error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update(updPayload)
        .eq('id', requestId)
        .eq('status', 'PENDING')
        .select('id,status')
        .maybeSingle();
      if (updErr) throw updErr;
      if (!upd) return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });

      // ==== מייל להורה (כמו במייקאפ) ====

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
        .select('first_name,last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();
      if (parErr) throw parErr;

      const parentName = fullName(parentRow?.first_name ?? null, parentRow?.last_name ?? null) ?? 'הורה';

      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // מדריך/שעות (מה-occRow)
      let instructorName: string | null = null;
      const insId = occRow?.instructor_id ? String(occRow.instructor_id) : null;
      if (insId) {
        const { data: inst } = await sbTenant
          .from('instructors')
          .select('first_name,last_name')
          .eq('id_number', insId)
          .maybeSingle();
        if (inst) instructorName = fullName((inst as any).first_name, (inst as any).last_name);
      }

      const { subject, html, text } = buildCancelOccurrenceDecisionEmail({
        kind: 'approved',
        farmName,
        parentName,
        childName,
        occurDate: cancelDate,
        startTime: fmtTime(occRow?.start_time),
        endTime: fmtTime(occRow?.end_time),
        instructorName,
        decisionNote,
      });

      let mailOk = false;
      let warning: string | null = null;
      let mail: any = null;
      let mailError: any = null;

      try {
        mail = await notifyUserInternal({
          tenantSchema,
          userType: 'parent',
          uid: childRow.parent_uid,
          subject,
          html,
          text,
          category: 'cancel_occurrence',
          forceEmail: true,
        });
        mailOk = true;
      } catch (e: any) {
        warning = 'הבקשה אושרה והשיעור בוטל, אך שליחת המייל נכשלה';
        mailError = { message: e?.message || String(e) };
        console.warn('approveCancelOccurrenceAndNotify: mail failed', mailError);
      }

         return void res.status(200).json({
        ok: true,
        mailOk,
        warning,
        mail,
        mailError,
        isMakeupAllowed,
    
        isBillable,
      });
    } catch (e: any) {
      console.error('approveCancelOccurrenceAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

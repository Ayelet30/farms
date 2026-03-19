// functions/src/approve-instructor-day-off-and-notify.ts
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

function toIsoUtc(dateYYYYMMDD: string, timeHHMM: string) {
  return new Date(`${dateYYYYMMDD}T${timeHHMM}:00Z`).toISOString();
}

// חפיפת שעות: lesson_start < window_end && lesson_end > window_start
function overlapsTime(lessonStartHHMM: string, lessonEndHHMM: string, winStartHHMM: string, winEndHHMM: string): boolean {
  return lessonStartHHMM < winEndHHMM && lessonEndHHMM > winStartHHMM;
}

type OccRow = {
  lesson_id: string;
  occur_date: string;   // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  child_id: string | null;
  instructor_id: string | null;
};

export const approveInstructorDayOffAndNotify = onRequest(
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

      // 1) הבקשה
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

      const payload = parsePayload((reqRow as any).payload);

      const fromDate = String((reqRow as any).from_date ?? payload?.from_date ?? '').slice(0, 10);
      const toDate = String((reqRow as any).to_date ?? payload?.to_date ?? fromDate ?? '').slice(0, 10);

      // all_day ברירת מחדל TRUE, ועמיד ל-"false" כמחרוזת
      const allDay =
        payload?.all_day === undefined || payload?.all_day === null
          ? true
          : payload?.all_day === true || payload?.all_day === 'true';

      // שעות מגיעות אצלך ב-requested_*
      const startTime = fmtTime(payload?.requested_start_time);
      const endTime = fmtTime(payload?.requested_end_time);

      const instructorId =
        String(
          (reqRow as any).instructor_id ||
          payload?.instructor_id ||
          payload?.instructor_id_number ||
          ''
        ).trim() || null;

      if (!instructorId) {
        return void res.status(400).json({ ok: false, message: 'Missing instructor_id in request' });
      }
      if (!fromDate) {
        return void res.status(400).json({ ok: false, message: 'Missing from_date in request' });
      }

      // אם לא יום מלא – חובה שעות
      if (!allDay && (!startTime || !endTime)) {
        return void res.status(400).json({
          ok: false,
          message: 'all_day=false but missing requested_start_time/requested_end_time',
        });
      }

      // 2) יצירת Unavailability (כמו RPC)
      const fromTs = allDay ? toIsoUtc(fromDate, '00:00') : toIsoUtc(fromDate, startTime!);
      const toTs = allDay
        ? new Date(`${toDate}T23:59:59Z`).toISOString()
        : toIsoUtc(toDate, endTime!);

      const { error: unErr } = await sbTenant
        .from('instructor_unavailability')
        .insert({
          instructor_id_number: instructorId,
          from_ts: fromTs,
          to_ts: toTs,
          reason: String(payload?.reason ?? payload?.note ?? 'Instructor day off'),
          all_day: allDay,
        } as any);

      if (unErr) throw unErr;

      // 3) שליפת occurrences מה-view lessons_occurrences בטווח תאריכים + סינון שעות אם צריך
      const { data: occs, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('lesson_id, occur_date, start_time, end_time, child_id, instructor_id')
        .eq('instructor_id', instructorId)
        .gte('occur_date', fromDate)
        .lte('occur_date', toDate);

      if (occErr) throw occErr;

      let affected = (occs ?? []) as OccRow[];

      if (!allDay) {
        affected = affected.filter(o => {
          const s = String(o.start_time ?? '').slice(0, 5);
          const e = String(o.end_time ?? '').slice(0, 5);
          return overlapsTime(s, e, startTime!, endTime!);
        });
      }

      // 4) ביטול כל השיעורים שייפגעו: upsert ל-exceptions
      //    שימי לב: אם יש המון rows זה יכול לקחת זמן, אבל לרוב זה סביר.
      for (const x of affected) {
        const { error: upErr } = await sbTenant
          .from('lesson_occurrence_exceptions')
          .upsert({
            lesson_id: x.lesson_id,
            occur_date: String(x.occur_date).slice(0, 10),
            status: 'בוטל',
            note: decisionNote?.trim() || 'בוטל עקב חופש מדריך',
            canceller_role: 'instructor',
            cancelled_at: new Date().toISOString(),
            is_makeup_allowed: true,
          } as any, { onConflict: 'lesson_id,occur_date' });

        if (upErr) throw upErr;
      }

      // 5) עדכון הבקשה ל-APPROVED (מותנה PENDING)
      const { data: upd, error: updErr } = await sbTenant
        .from('secretarial_requests')
        .update({
          status: 'APPROVED',
          decided_by_uid: decidedByUid,
          decided_at: new Date().toISOString(),
          decision_note: decisionNote ?? null,
        })
        .eq('id', requestId)
        .eq('status', 'PENDING')
        .select('id,status')
        .maybeSingle();

      if (updErr) throw updErr;
      if (!upd) {
        return void res.status(409).json({ ok: false, message: 'הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).' });
      }

      // 6) מידע עזר למיילים
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // שם + uid של מדריך (לשליחה)
      let instructorName: string | null = null;
      let instructorUid: string | null = null;

      const { data: inst, error: instErr } = await sbTenant
        .from('instructors')
        .select('uid, first_name, last_name')
        .eq('id_number', instructorId)
        .maybeSingle();
      if (instErr) throw instErr;

      if (inst) {
        instructorName = fullName((inst as any).first_name, (inst as any).last_name);
        instructorUid = (inst as any).uid ?? null;
      }

      // 7) קיבוץ ביטולים לפי הורה
      const childIds = Array.from(
        new Set(
          affected
            .map(r => String((r as any).child_id || '').trim())
            .filter(Boolean)
        )
      );

      const childToParent = new Map<string, { parent_uid: string; child_name: string }>();

      if (childIds.length) {
        const { data: children, error: chErr } = await sbTenant
          .from('children')
          .select('child_uuid,parent_uid,first_name,last_name')
          .in('child_uuid', childIds);

        if (chErr) throw chErr;

        for (const c of (children ?? []) as any[]) {
          if (!c?.child_uuid || !c?.parent_uid) continue;
          childToParent.set(String(c.child_uuid), {
            parent_uid: String(c.parent_uid),
            child_name: fullName(c.first_name, c.last_name) ?? 'הילד/ה',
          });
        }
      }

      type ParentItem = { occur_date: string; start_time: string; end_time: string; child_name: string };
      const parentBuckets = new Map<string, ParentItem[]>();

      for (const row of affected) {
        const cid = String((row as any).child_id || '').trim();
        const meta = cid ? childToParent.get(cid) : null;
        if (!meta?.parent_uid) continue;

        const item: ParentItem = {
          occur_date: String(row.occur_date).slice(0, 10),
          start_time: String(row.start_time ?? '').slice(0, 5),
          end_time: String(row.end_time ?? '').slice(0, 5),
          child_name: meta.child_name,
        };

        if (!parentBuckets.has(meta.parent_uid)) parentBuckets.set(meta.parent_uid, []);
        parentBuckets.get(meta.parent_uid)!.push(item);
      }

      // 8) שליחת מיילים (לא מפילה אישור)
      let mailOk = true;
      const warnings: string[] = [];
      const mailErrors: any[] = [];
      const mailResults: any[] = [];

      // 8.1 מייל למדריך
      try {
        if (instructorUid) {
          const { subject, html, text } = buildInstructorDayOffDecisionEmail({
            kind: 'approved_instructor',
            farmName,
            instructorName: instructorName ?? 'המדריך/ה',
            fromDate,
            toDate,
            allDay,
            startTime,
            endTime,
            decisionNote,
            impactCount: affected.length,
          });

          const rMail = await notifyUserInternal({
            tenantSchema,
            userType: 'instructor',
            uid: instructorUid,
            subject,
            html,
            text,
            category: 'instructor_day_off',
            forceEmail: true,
          });

          mailResults.push({ to: 'instructor', ok: true, result: rMail });
        } else {
          mailOk = false;
          warnings.push('אושר חופש המדריך, אך לא נמצא uid למדריך ולכן לא נשלח אליו מייל.');
        }
      } catch (e: any) {
        mailOk = false;
        warnings.push('אושר חופש המדריך, אך שליחת מייל למדריך נכשלה.');
        mailErrors.push({ to: 'instructor', message: e?.message || String(e) });
      }

      // 8.2 מיילים להורים שנפגעו
      for (const [parentUid, items] of parentBuckets.entries()) {
        try {
          const { data: par, error: parErr } = await sbTenant
            .from('parents')
            .select('first_name,last_name')
            .eq('uid', parentUid)
            .maybeSingle();
          if (parErr) throw parErr;

          const parentName = fullName((par as any)?.first_name ?? null, (par as any)?.last_name ?? null) ?? 'הורה';

          const { subject, html, text } = buildInstructorDayOffDecisionEmail({
            kind: 'approved_parent',
            farmName,
            parentName,
            instructorName: instructorName ?? 'המדריך/ה',
            fromDate,
            toDate,
            allDay,
            startTime,
            endTime,
            decisionNote,
            cancellations: items
              .sort((a, b) => a.occur_date.localeCompare(b.occur_date))
              .map(x => ({
                occurDate: x.occur_date,
                startTime: x.start_time,
                endTime: x.end_time,
                childName: x.child_name,
              })),
          });

          const rMail = await notifyUserInternal({
            tenantSchema,
            userType: 'parent',
            uid: parentUid,
            subject,
            html,
            text,
            category: 'instructor_day_off',
            forceEmail: true,
          });

          mailResults.push({ to: `parent:${parentUid}`, ok: true, result: rMail });
        } catch (e: any) {
          mailOk = false;
          warnings.push('אושרה הבקשה ובוצעו ביטולים, אך שליחת מייל לחלק מההורים נכשלה.');
          mailErrors.push({ to: `parent:${parentUid}`, message: e?.message || String(e) });
        }
      }

      const warning = warnings.length ? warnings.join(' ') : null;

      return void res.status(200).json({
        ok: true,
        mailOk,
        warning,
        mailResults,
        mailErrors,
        meta: {
          impactCount: affected.length,
          fromDate,
          toDate,
          allDay,
          startTime,
          endTime,
        },
      });
    } catch (e: any) {
      console.error('approveInstructorDayOffAndNotify error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

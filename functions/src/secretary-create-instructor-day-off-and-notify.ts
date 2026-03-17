import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
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

if (!admin.apps.length) admin.initializeApp();

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
    'Authorization, Content-Type, X-Requested-With'
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
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

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtDateIL(d: string) {
  try {
    return new Date(d).toLocaleDateString('he-IL');
  } catch {
    return d;
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
function overlapsTime(
  lessonStartHHMM: string,
  lessonEndHHMM: string,
  winStartHHMM: string,
  winEndHHMM: string
): boolean {
  return lessonStartHHMM < winEndHHMM && lessonEndHHMM > winStartHHMM;
}

function normalizeRequestType(x: any): 'HOLIDAY' | 'SICK' | 'PERSONAL' | 'OTHER' {
  const v = String(x ?? '').trim().toUpperCase();
  if (v === 'HOLIDAY' || v === 'SICK' || v === 'PERSONAL') return v;
  return 'OTHER';
}



function windowText(a: {
  fromDate: string;
  toDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
}) {
  const from = a.fromDate;
  const to = a.toDate || from;

  if (from === to) {
    if (a.allDay) return `${fmtDateIL(from)} — יום מלא`;
    if (a.startTime && a.endTime) return `${fmtDateIL(from)} — ${a.startTime}–${a.endTime}`;
    if (a.startTime && !a.endTime) return `${fmtDateIL(from)} — החל מ־${a.startTime}`;
    return `${fmtDateIL(from)} — היעדרות`;
  }

  if (a.allDay) return `${fmtDateIL(from)}–${fmtDateIL(to)} — ימים מלאים`;
  if (a.startTime && a.endTime) {
    return `${fmtDateIL(from)}–${fmtDateIL(to)} — בכל יום ${a.startTime}–${a.endTime}`;
  }
  if (a.startTime && !a.endTime) {
    return `${fmtDateIL(from)}–${fmtDateIL(to)} — בכל יום החל מ־${a.startTime}`;
  }
  return `${fmtDateIL(from)}–${fmtDateIL(to)} — היעדרות`;
}
function requestTypeLabel(type: 'HOLIDAY' | 'SICK' | 'PERSONAL' | 'OTHER') {
  switch (type) {
    case 'HOLIDAY':
      return 'יום חופש';
    case 'SICK':
      return 'יום מחלה';
    case 'PERSONAL':
      return 'יום אישי';
    default:
      return 'היעדרות';
  }
}
// function buildSecretaryCreatedInstructorDayOffEmail(args: {
//   farmName: string;
//   instructorName: string;
//   fromDate: string;
//   toDate: string;
//   allDay: boolean;
//   startTime: string | null;
//   endTime: string | null;
//   decisionNote: string | null;
//   impactCount: number;
//   requestType: 'HOLIDAY' | 'SICK' | 'PERSONAL' | 'OTHER';
// }) {
//   const farmName = esc(args.farmName);
//   const typeLabel = requestTypeLabel(args.requestType);
//   const note = args.decisionNote
//     ? `<p><b>הערה מהמזכירות:</b> ${esc(args.decisionNote)}</p>`
//     : '';

//   const subject = `עודכן עבורך ${typeLabel} במערכת`;

//   const html = `
//     <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
//       <h2>${farmName}</h2>
//       <p>שלום ${esc(args.instructorName)},</p>
//       <p>המזכירות עדכנה עבורך <b>${esc(typeLabel)}</b> במערכת.</p>
//       <p><b>חלון ההיעדרות:</b> ${esc(windowText(args))}</p>
//       ${note}
//       <p><b>מספר שיעורים שהושפעו:</b> ${esc(args.impactCount)}</p>
//     </div>
//   `.trim();

//   const text =
//     `${args.farmName}\n` +
//     `שלום ${args.instructorName},\n` +
//     `המזכירות עדכנה עבורך ${typeLabel} במערכת.\n` +
//     `חלון ההיעדרות: ${windowText(args)}\n` +
//     (args.decisionNote ? `הערה מהמזכירות: ${args.decisionNote}\n` : '') +
//     `מספר שיעורים שהושפעו: ${args.impactCount}\n`;

//   return { subject, html, text };
// }

type OccRow = {
  lesson_id: string;
  occur_date: string;   // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  child_id: string | null;
  instructor_id: string | null;
};

export const secretaryCreateInstructorDayOffAndNotify = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    try {
      if (applyCors(req, res)) return;
      if (req.method !== 'POST') {
        return void res.status(405).json({ error: 'Method not allowed' });
      }

      const decoded = await requireAuth(req);
      const decidedByUid = decoded?.uid ?? null;

      const body = req.body || {};

      const tenantSchema = String(body.tenantSchema || '').trim();
      const tenantId = String(body.tenantId || '').trim();

      const instructorId = String(body.instructorId || '').trim();
      const fromDate = String(body.fromDate || '').trim().slice(0, 10);
      const toDate = String(body.toDate || body.fromDate || '').trim().slice(0, 10);

      const allDay =
        body.allDay === undefined || body.allDay === null
          ? true
          : body.allDay === true || body.allDay === 'true';

      const startTime = fmtTime(body.startTime);
      const endTime = fmtTime(body.endTime);

      const requestType = normalizeRequestType(body.requestType);
      const decisionNote =
        body.decisionNote == null ? null : String(body.decisionNote).trim();

      if (!tenantSchema) {
        return void res.status(400).json({ error: 'Missing tenantSchema' });
      }
      if (!tenantId) {
        return void res.status(400).json({ error: 'Missing tenantId' });
      }
      if (!instructorId) {
        return void res.status(400).json({ error: 'Missing instructorId' });
      }
      if (!fromDate) {
        return void res.status(400).json({ error: 'Missing fromDate' });
      }

      if (!allDay && (!startTime || !endTime)) {
        return void res.status(400).json({
          ok: false,
          message: 'allDay=false but missing startTime/endTime',
        });
      }

      if (!allDay && startTime! >= endTime!) {
        return void res.status(400).json({
          ok: false,
          message: 'endTime must be greater than startTime',
        });
      }

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // 1) יצירת Unavailability
      const fromTs = allDay
        ? toIsoUtc(fromDate, '00:00')
        : toIsoUtc(fromDate, startTime!);

      const toTs = allDay
        ? new Date(`${toDate}T23:59:59Z`).toISOString()
        : toIsoUtc(toDate, endTime!);

      const reason =
        decisionNote?.trim() ||
        requestTypeLabel(requestType) ||
        'Instructor day off';

      const { error: unErr } = await sbTenant
        .from('instructor_unavailability')
        .insert({
          instructor_id_number: instructorId,
          from_ts: fromTs,
          to_ts: toTs,
          reason,
          all_day: allDay,
        } as any);

      if (unErr) throw unErr;

      // 2) occurrences בטווח
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

      // 3) ביטול occurrences מושפעים
      for (const x of affected) {
        const { error: upErr } = await sbTenant
          .from('lesson_occurrence_exceptions')
          .upsert(
            {
              lesson_id: x.lesson_id,
              occur_date: String(x.occur_date).slice(0, 10),
              status: 'בוטל',
              note: decisionNote?.trim() || 'בוטל עקב היעדרות מדריך',
              canceller_role: 'secretary',
              cancelled_at: new Date().toISOString(),
              is_makeup_allowed: true,
            } as any,
            { onConflict: 'lesson_id,occur_date' }
          );

        if (upErr) throw upErr;
      }

      // 4) מידע עזר למיילים
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();

      if (farmErr) throw farmErr;

      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

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

      // 5) קיבוץ לפי הורה
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

      type ParentItem = {
        occur_date: string;
        start_time: string;
        end_time: string;
        child_name: string;
      };

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

        if (!parentBuckets.has(meta.parent_uid)) {
          parentBuckets.set(meta.parent_uid, []);
        }
        parentBuckets.get(meta.parent_uid)!.push(item);
      }

      // 6) שליחת מיילים
      let mailOk = true;
      const warnings: string[] = [];
      const mailErrors: any[] = [];
      const mailResults: any[] = [];

      // 6.1 מדריך — ניסוח חדש
           // 6.1 מדריך — משתמשים באותו builder כמו בפונקציית האישור
      try {
        if (instructorUid) {
          const { subject, html, text } = buildInstructorDayOffDecisionEmail({
            kind: 'created_by_secretary_instructor',
            farmName,
            instructorName: instructorName ?? 'המדריך/ה',
            fromDate,
            toDate,
            allDay,
            startTime,
            endTime,
            decisionNote,
            impactCount: affected.length,
            requestTypeLabel: requestTypeLabel(requestType),
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
          warnings.push('יום החופש עודכן, אך לא נמצא uid למדריך ולכן לא נשלח אליו מייל.');
        }
      } catch (e: any) {
        mailOk = false;
        warnings.push('יום החופש עודכן, אך שליחת מייל למדריך נכשלה.');
        mailErrors.push({ to: 'instructor', message: e?.message || String(e) });
      }
      // 6.2 הורים — משתמשים באותו builder הקיים
      for (const [parentUid, items] of parentBuckets.entries()) {
        try {
          const { data: par, error: parErr } = await sbTenant
            .from('parents')
            .select('first_name,last_name')
            .eq('uid', parentUid)
            .maybeSingle();

          if (parErr) throw parErr;

          const parentName =
            fullName((par as any)?.first_name ?? null, (par as any)?.last_name ?? null) || 'הורה';

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
          warnings.push('יום החופש עודכן ובוצעו ביטולים, אך שליחת מייל לחלק מההורים נכשלה.');
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
          instructorId,
          requestType,
        },
      });
    } catch (e: any) {
      console.error('secretaryCreateInstructorDayOffAndNotify error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
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
  const got = String(
    req.headers['x-internal-secret'] || req.headers['X-Internal-Secret'] || ''
  );
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

type OccRow = {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  child_id: string | null;
  instructor_id: string | null;
};

export const deactivateInstructorAndCancelFutureLessons = onRequest(
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

      let decidedByUid: string | null = null;
      if (!isInternalCall(req)) {
        const decoded = await requireAuth(req);
        decidedByUid = decoded?.uid ?? null;
      }

      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const instructorIdNumber = String(body.instructorIdNumber || '').trim();
      const fromDate = String(
        body.fromDate || new Date().toISOString().slice(0, 10)
      ).slice(0, 10);
      const decisionNote =
        body.decisionNote == null ? null : String(body.decisionNote).trim();

      if (!tenantSchema) {
        return void res.status(400).json({ error: 'Missing tenantSchema' });
      }
      if (!tenantId) {
        return void res.status(400).json({ error: 'Missing tenantId' });
      }
      if (!instructorIdNumber) {
        return void res.status(400).json({ error: 'Missing instructorIdNumber' });
      }

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      // 1) מדריך
      const { data: inst, error: instErr } = await sbTenant
        .from('instructors')
        .select('id_number, uid, first_name, last_name, status')
        .eq('id_number', instructorIdNumber)
        .maybeSingle();

      if (instErr) throw instErr;
      if (!inst) {
        return void res.status(404).json({ ok: false, message: 'Instructor not found' });
      }

      const instructorName =
        fullName((inst as any).first_name, (inst as any).last_name) ?? 'המדריך/ה';
      const instructorUid = (inst as any).uid ?? null;

      // 2) occurrences עתידיים
      const { data: occs, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('lesson_id, occur_date, start_time, end_time, child_id, instructor_id')
        .eq('instructor_id', instructorIdNumber)
        .gte('occur_date', fromDate);

      if (occErr) throw occErr;

      const affected = (occs ?? []) as OccRow[];

      // 3) upsert ל-exceptions
      for (const x of affected) {
        const { error: upErr } = await sbTenant
          .from('lesson_occurrence_exceptions')
          .upsert(
            {
              lesson_id: x.lesson_id,
              occur_date: String(x.occur_date).slice(0, 10),
              status: 'בוטל',
              note:
                decisionNote?.trim() || 'בוטל עקב הפיכת מדריך ללא פעיל',
              canceller_role: 'secretary',
              cancelled_at: new Date().toISOString(),
              is_makeup_allowed: true,
            } as any,
            { onConflict: 'lesson_id,occur_date' }
          );

        if (upErr) throw upErr;
      }

      // 4) להפוך מדריך ל-Inactive
      const { error: updInstErr } = await sbTenant
        .from('instructors')
        .update({
          status: 'Inactive',
        })
        .eq('id_number', instructorIdNumber);

      if (updInstErr) throw updInstErr;

      // 5) שם חווה
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();

      if (farmErr) throw farmErr;
      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      // 6) child -> parent
      const childIds = Array.from(
        new Set(
          affected
            .map((r) => String((r as any).child_id || '').trim())
            .filter(Boolean)
        )
      );

      const childToParent = new Map<
        string,
        { parent_uid: string; child_name: string }
      >();

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

        if (!parentBuckets.has(meta.parent_uid)) parentBuckets.set(meta.parent_uid, []);
        parentBuckets.get(meta.parent_uid)!.push(item);
      }

      // 7) מיילים
      let mailOk = true;
      const warnings: string[] = [];
      const mailErrors: any[] = [];
      const mailResults: any[] = [];

   // 7.1 למדריך
try {
  if (instructorUid) {
    const subject = `עדכון סטטוס מדריך/ה - ${farmName}`;

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
        <p>שלום ${instructorName},</p>

        <p>
          סטטוס המדריך/ה שלך במערכת <b>${farmName}</b> עודכן ל־<b>לא פעיל/ה</b>.
        </p>

        <p>
          בעקבות שינוי זה, כל השיעורים העתידיים המשויכים אליך בוטלו.
        </p>

        <p>
          מספר שיעורים שבוטלו: <b>${affected.length}</b>
        </p>

        ${decisionNote ? `<p><b>הערה:</b> ${decisionNote}</p>` : ''}

        <p>לבירור נוסף ניתן לפנות למזכירות.</p>

        <p>בברכה,<br>${farmName}</p>
      </div>
    `;

    const text = [
      `שלום ${instructorName},`,
      '',
      `סטטוס המדריך/ה שלך במערכת ${farmName} עודכן ללא פעיל/ה.`,
      `בעקבות שינוי זה, כל השיעורים העתידיים המשויכים אליך בוטלו.`,
      `מספר שיעורים שבוטלו: ${affected.length}`,
      decisionNote ? `הערה: ${decisionNote}` : '',
      '',
      `לבירור נוסף ניתן לפנות למזכירות.`,
      '',
      `בברכה,`,
      farmName,
    ]
      .filter(Boolean)
      .join('\n');

    const rMail = await notifyUserInternal({
      tenantSchema,
      userType: 'instructor',
      uid: instructorUid,
      subject,
      html,
      text,
      category: 'instructor_deactivation',
      forceEmail: true,
    });

    mailResults.push({ to: 'instructor', ok: true, result: rMail });
  }
} catch (e: any) {
  mailOk = false;
  warnings.push('המדריך עודכן ללא פעיל, אך שליחת המייל למדריך נכשלה.');
  mailErrors.push({ to: 'instructor', message: e?.message || String(e) });
}

      // 7.2 להורים
      for (const [parentUid, items] of parentBuckets.entries()) {
        try {
          const { data: par, error: parErr } = await sbTenant
            .from('parents')
            .select('first_name,last_name')
            .eq('uid', parentUid)
            .maybeSingle();

          if (parErr) throw parErr;

          const parentName =
            fullName((par as any)?.first_name ?? null, (par as any)?.last_name ?? null) ??
            'הורה';

          const { subject, html, text } = buildInstructorDayOffDecisionEmail({
            kind: 'approved_parent',
            farmName,
            parentName,
            instructorName,
            fromDate,
            toDate: fromDate,
            allDay: true,
            startTime: null,
            endTime: null,
            decisionNote:
              decisionNote ?? 'השיעורים בוטלו עקב הפיכת המדריך/ה ללא פעיל/ה.',
            cancellations: items
              .sort((a, b) => {
                const d = a.occur_date.localeCompare(b.occur_date);
                return d !== 0 ? d : a.start_time.localeCompare(b.start_time);
              })
              .map((x) => ({
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
            category: 'instructor_deactivation',
            forceEmail: true,
          });

          mailResults.push({ to: `parent:${parentUid}`, ok: true, result: rMail });
        } catch (e: any) {
          mailOk = false;
          warnings.push('בוצע ביטול שיעורים, אך שליחת מייל לחלק מההורים נכשלה.');
          mailErrors.push({ to: `parent:${parentUid}`, message: e?.message || String(e) });
        }
      }

      return void res.status(200).json({
        ok: true,
        mailOk,
        warning: warnings.length ? warnings.join(' ') : null,
        mailErrors,
        mailResults,
        meta: {
          impactCount: affected.length,
          instructorIdNumber,
          fromDate,
          decidedByUid,
        },
      });
    } catch (e: any) {
      console.error('deactivateInstructorAndCancelFutureLessons error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
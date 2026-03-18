import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import { sendEmailCore } from './gmail/email-core';
import {
  SUPABASE_URL_S,
  SUPABASE_KEY_S,
  GMAIL_REFRESH_TOKEN_S,
  GMAIL_CLIENT_ID_S,
  GMAIL_CLIENT_SECRET_S,
  GMAIL_SENDER_EMAIL_S,
} from './gmail/email-core';
const NOTIFY_USER_URL = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifyUser';
if (!admin.apps.length) admin.initializeApp();

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

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Requested-With, X-Internal-Secret'
  );
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function timingSafeEq(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isInternalCall(req: any): boolean {
  const secret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
  if (!secret) return false;

  const got = String(req.headers['x-internal-secret'] || '');
  return !!(got && timingSafeEq(got, secret));
}

async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
}

function normStr(x: any, max = 5000) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function looksLikeEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
type ImpactedLesson = {
  lesson_id?: string;
  occur_date?: string;
  start_time?: string | null;
  end_time?: string | null;
  child_id?: string;
  child_name?: string | null;
  parent_uid?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  lesson_type?: string | null;
  instructor_id?: string | null;
  instructor_uid?: string | null;
  instructor_name?: string | null;
};

function toHourMinute(value: any): string {
  const s = String(value ?? '').trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const sendFarmDayOffCancellationEmails = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      GMAIL_REFRESH_TOKEN_S,
      GMAIL_CLIENT_ID_S,
      GMAIL_CLIENT_SECRET_S,
      GMAIL_SENDER_EMAIL_S,
      INTERNAL_CALL_SECRET_S,
    ],
  },
  async (req, res) => {
    if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') {
        return void res.status(405).json({ error: 'Method not allowed' });
      }
const internalSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
if (!internalSecret) {
  throw new Error('Missing INTERNAL_CALL_SECRET');
}
      let decoded: any = null;
      if (!isInternalCall(req)) {
        decoded = await requireAuth(req);
      } else {
        decoded = { uid: 'INTERNAL' };
      }

      const body = req.body || {};
      const tenantSchema = normStr(body.tenantSchema, 120);
      const reason = normStr(body.reason, 300);
      const impactedLessons: ImpactedLesson[] = Array.isArray(body.impactedLessons)
        ? body.impactedLessons
        : [];

      if (!tenantSchema) {
        return void res.status(400).json({ error: 'Missing "tenantSchema"' });
      }

      if (!reason) {
        return void res.status(400).json({ error: 'Missing "reason"' });
      }

      if (!impactedLessons.length) {
        return void res.status(200).json({
          ok: true,
          sentCount: 0,
          failedCount: 0,
          skippedCount: 0,
          sentBy: decoded.uid,
        });
      }

      const grouped = new Map<string, ImpactedLesson[]>();

      for (const row of impactedLessons) {
        const email = normStr(row.parent_email, 200);
        if (!email || !looksLikeEmail(email)) continue;

        if (!grouped.has(email)) grouped.set(email, []);
        grouped.get(email)!.push(row);
      }
const groupedInstructors = new Map<string, ImpactedLesson[]>();

for (const row of impactedLessons) {
  const uid = normStr(row.instructor_uid, 200);
  if (!uid) continue;

  if (!groupedInstructors.has(uid)) groupedInstructors.set(uid, []);
  groupedInstructors.get(uid)!.push(row);
}
let parentSentCount = 0;
let instructorSentCount = 0;
      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const failures: Array<{ email: string; error: string }> = [];

      for (const [email, rows] of grouped.entries()) {
        if (!rows.length) {
          skippedCount++;
          continue;
        }

        const parentName = normStr(rows[0]?.parent_name || 'הורה יקר/ה', 120);
        const safeParentName = escapeHtml(parentName);

        const htmlItems = rows
          .map((row) => {
            const childName = escapeHtml(normStr(row.child_name || 'ללא שם', 150));
            const occurDate = escapeHtml(normStr(row.occur_date || '', 50));
            const start = escapeHtml(toHourMinute(row.start_time));
            const end = escapeHtml(toHourMinute(row.end_time));
            const lessonType = escapeHtml(normStr(row.lesson_type || '', 100));

            const lessonTypeText = lessonType ? ` – ${lessonType}` : '';
            return `<li><strong>${childName}</strong> – ${occurDate} – ${start}-${end}${lessonTypeText}</li>`;
          })
          .join('');

        const textItems = rows
          .map((row) => {
            const childName = normStr(row.child_name || 'ללא שם', 150);
            const occurDate = normStr(row.occur_date || '', 50);
            const start = toHourMinute(row.start_time);
            const end = toHourMinute(row.end_time);
            const lessonType = normStr(row.lesson_type || '', 100);
            return `- ${childName} | ${occurDate} | ${start}-${end}${lessonType ? ` | ${lessonType}` : ''}`;
          })
          .join('\n');

        const subject = 'עדכון מהחווה: שיעור בוטל עקב יום מיוחד';

        const html = `
          <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.7; color: #1f2937;">
            <p>שלום ${safeParentName},</p>
            <p>עקב <strong>${escapeHtml(reason)}</strong>, השיעורים הבאים בוטלו:</p>
            <ul style="padding-right: 18px;">
              ${htmlItems}
            </ul>
            <p>לשאלות נוספות ניתן לפנות למזכירות.</p>
            <p>בברכה,<br>צוות החווה</p>
          </div>
        `;

        const text = [
          `שלום ${parentName},`,
          '',
          `עקב ${reason}, השיעורים הבאים בוטלו:`,
          textItems,
          '',
          'לשאלות נוספות ניתן לפנות למזכירות.',
          '',
          'בברכה,',
          'צוות החווה',
        ].join('\n');

        try {
          await sendEmailCore({
            tenantSchema,
            to: [email],
            subject,
            text,
            html,
            fromName: 'Smart-Farm',
          });
parentSentCount++;
        } catch (e: any) {
          failedCount++;
          failures.push({
            email,
            error: e?.message || String(e),
          });
          console.error('sendFarmDayOffCancellationEmails failed', email, e);
        }
      }
for (const [uid, rows] of groupedInstructors.entries()) {
  if (!rows.length) {
    skippedCount++;
    continue;
  }

  const instructorName = normStr(rows[0]?.instructor_name || 'מדריך/ה יקר/ה', 120);
  const safeInstructorName = escapeHtml(instructorName);

  const htmlItems = rows
    .map((row) => {
      const childName = escapeHtml(normStr(row.child_name || 'ללא שם', 150));
      const occurDate = escapeHtml(normStr(row.occur_date || '', 50));
      const start = escapeHtml(toHourMinute(row.start_time));
      const end = escapeHtml(toHourMinute(row.end_time));
      const lessonType = escapeHtml(normStr(row.lesson_type || '', 100));
      const lessonTypeText = lessonType ? ` – ${lessonType}` : '';

      return `<li><strong>${childName}</strong> – ${occurDate} – ${start}-${end}${lessonTypeText}</li>`;
    })
    .join('');

  const textItems = rows
    .map((row) => {
      const childName = normStr(row.child_name || 'ללא שם', 150);
      const occurDate = normStr(row.occur_date || '', 50);
      const start = toHourMinute(row.start_time);
      const end = toHourMinute(row.end_time);
      const lessonType = normStr(row.lesson_type || '', 100);

      return `- ${childName} | ${occurDate} | ${start}-${end}${lessonType ? ` | ${lessonType}` : ''}`;
    })
    .join('\n');

  const subject = 'עדכון מהחווה: שיעורים בוטלו עקב יום מיוחד';

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.7; color: #1f2937;">
      <p>שלום ${safeInstructorName},</p>
      <p>עקב <strong>${escapeHtml(reason)}</strong>, השיעורים הבאים שלך בוטלו:</p>
      <ul style="padding-right: 18px;">
        ${htmlItems}
      </ul>
      <p>לשאלות נוספות ניתן לפנות למזכירות.</p>
      <p>בברכה,<br>צוות החווה</p>
    </div>
  `;

  const text = [
    `שלום ${instructorName},`,
    '',
    `עקב ${reason}, השיעורים הבאים שלך בוטלו:`,
    textItems,
    '',
    'לשאלות נוספות ניתן לפנות למזכירות.',
    '',
    'בברכה,',
    'צוות החווה',
  ].join('\n');

  try {
    const r = await fetch(NOTIFY_USER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        tenantSchema,
        userType: 'instructor',
        uid,
        category: 'cancelLesson',
forceEmail: true,
        subject,
        html,
        text,
      }),
    });

    const json: any = await r.json().catch(() => ({}));

    if (!r.ok) {
      failedCount++;
      failures.push({
        email: `instructor:${uid}`,
        error: json?.message || json?.error || r.statusText,
      });
      console.error('notify instructor failed', uid, json);
      continue;
    }

    if (json?.sent === true) {
      instructorSentCount++;
    } else {
      skippedCount++;
      console.log('notify instructor skipped', uid, json?.reason);
    }
  } catch (e: any) {
    failedCount++;
    failures.push({
      email: `instructor:${uid}`,
      error: e?.message || String(e),
    });
    console.error('notify instructor exception', uid, e);
  }
}
    return void res.status(200).json({
  ok: true,
  parentSentCount,
  instructorSentCount,
  failedCount,
  skippedCount,
  failures,
  sentBy: decoded.uid,
});
    } catch (e: any) {
      console.error('sendFarmDayOffCancellationEmails error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
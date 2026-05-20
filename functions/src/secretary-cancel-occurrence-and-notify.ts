import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildSecretaryCancelOccurrenceEmail } from './email-builders/send-secretary-cancel-occurrence-email';

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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Internal-Secret');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}

async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);

  if (!m) throw new Error('Missing Bearer token');

  return admin.auth().verifyIdToken(m[1]);
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function fullName(f?: string | null, l?: string | null) {
  return `${(f ?? '').trim()} ${(l ?? '').trim()}`.trim() || null;
}

function fmtTime(t: any) {
  const s = String(t ?? '');
  if (!s) return null;
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export const secretaryCancelOccurrenceAndNotify = onRequest(
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

      await requireAuth(req);

      const body = req.body || {};

      const tenantSchema = String(body.tenantSchema || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const lessonId = String(body.lessonId || '').trim();
      const occurDate = String(body.occurDate || '').slice(0, 10);

      const note =
        body.note == null || String(body.note).trim() === ''
          ? 'בוטל על ידי המזכירות'
          : String(body.note).trim();

      const isMakeupAllowed = body.isMakeupAllowed === true;
      const isBillable = body.isBillable === true;

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });
      if (!lessonId) return void res.status(400).json({ error: 'Missing lessonId' });
      if (!occurDate) return void res.status(400).json({ error: 'Missing occurDate' });

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      const { data: occRow, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select(`
          lesson_id,
          child_id,
          occur_date,
          start_time,
          end_time,
          instructor_id,
          status
        `)
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate)
        .maybeSingle();

      if (occErr) throw occErr;

      if (!occRow) {
        return void res.status(404).json({
          ok: false,
          message: `לא נמצא שיעור לתאריך ${occurDate}`,
        });
      }

      const rawStatus = String((occRow as any).status ?? '');
      if (rawStatus.includes('בוטל')) {
        return void res.status(409).json({
          ok: false,
          message: 'השיעור כבר מסומן כמבוטל.',
        });
      }

      const childId = String((occRow as any).child_id || '').trim();
      const instructorId = String((occRow as any).instructor_id || '').trim();

      if (!childId) throw new Error('Occurrence missing child_id');

      const { error: upsertErr } = await sbTenant
        .from('lesson_occurrence_exceptions')
        .upsert(
          {
            lesson_id: lessonId,
            occur_date: occurDate,
            status: 'בוטל',
            note,
            canceller_role: 'secretary',
            cancelled_at: new Date().toISOString(),
            is_makeup_allowed: isMakeupAllowed,
            is_billable: isBillable,
          } as any,
          { onConflict: 'lesson_id,occur_date' }
        );

      if (upsertErr) throw upsertErr;

      const { data: childRow, error: childErr } = await sbTenant
        .from('children')
        .select('parent_uid, first_name, last_name')
        .eq('child_uuid', childId)
        .maybeSingle();

      if (childErr) throw childErr;
      if (!childRow?.parent_uid) throw new Error('Child missing parent_uid');

      const childName =
        fullName(childRow.first_name, childRow.last_name) ?? 'הילד/ה';

      const { data: parentRow, error: parentErr } = await sbTenant
        .from('parents')
        .select('first_name, last_name')
        .eq('uid', childRow.parent_uid)
        .maybeSingle();

      if (parentErr) throw parentErr;

      const parentName =
        fullName(parentRow?.first_name ?? null, parentRow?.last_name ?? null) ?? 'הורה';
let instructorName: string | null = null;
let instructorUid: string | null = null;

if (instructorId) {
  const { data: instructorRow, error: instructorErr } = await sbTenant
    .from('instructors')
    .select('uid, first_name, last_name')
    .eq('id_number', instructorId)
    .maybeSingle();

  if (instructorErr) throw instructorErr;

  instructorName =
    fullName(instructorRow?.first_name ?? null, instructorRow?.last_name ?? null);

  instructorUid =
    instructorRow?.uid ? String(instructorRow.uid) : null;
}
      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();

      if (farmErr) throw farmErr;

      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      const emailData = {
        farmName,
        parentName,
        childName,
        occurDate,
        startTime: fmtTime((occRow as any).start_time),
        endTime: fmtTime((occRow as any).end_time),
        instructorName,
        note,
        isMakeupAllowed,
        isBillable,
      };

      const parentEmail = buildSecretaryCancelOccurrenceEmail({
        ...emailData,
        recipientType: 'parent',
      });

      const instructorEmail = buildSecretaryCancelOccurrenceEmail({
        ...emailData,
        recipientType: 'instructor',
      });

      let parentMailOk = false;
      let instructorMailOk = false;
      let parentMailError: any = null;
      let instructorMailError: any = null;

      try {
        await notifyUserInternal({
          tenantSchema,
          userType: 'parent',
          uid: childRow.parent_uid,
          subject: parentEmail.subject,
          html: parentEmail.html,
          text: parentEmail.text,
          category: 'secretary_cancel_occurrence',
          forceEmail: true,
        });

        parentMailOk = true;
      } catch (e: any) {
        parentMailError = { message: e?.message || String(e) };
        console.warn('secretaryCancelOccurrenceAndNotify: parent mail failed', parentMailError);
      }

      if (instructorId) {
        try {
          await notifyUserInternal({
            tenantSchema,
            userType: 'instructor',
            uid: instructorUid!,
            subject: instructorEmail.subject,
            html: instructorEmail.html,
            text: instructorEmail.text,
            category: 'secretary_cancel_occurrence',
            forceEmail: true,
          });

          instructorMailOk = true;
        } catch (e: any) {
          instructorMailError = { message: e?.message || String(e) };
          console.warn('secretaryCancelOccurrenceAndNotify: instructor mail failed', instructorMailError);
        }
      }

      const mailOk = parentMailOk && (!instructorId || instructorMailOk);

      return void res.status(200).json({
        ok: true,
        mailOk,
        parentMailOk,
        instructorMailOk,
        parentMailError,
        instructorMailError,
        isMakeupAllowed,
        isBillable,
      });
    } catch (e: any) {
      console.error('secretaryCancelOccurrenceAndNotify error', e);

      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
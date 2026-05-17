import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildAvailabilityLessonActionEmail } from './email-builders/send-availability-lesson-action-email';
import { defineSecret } from 'firebase-functions/params';
if (!admin.apps.length) admin.initializeApp();

const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
  'http://localhost:4200',
  'https://localhost:4200',
]);
const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');
type ActionType = 'move_lesson' | 'cancel_lesson_with_makeup' | 'end_series';

function applyCors(req: any, res: any): boolean {
  const origin = String(req.headers.origin || '');

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');

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

function envOrSecret(s: any, name: string): string {
  return s.value() || process.env[name] || '';
}

function fullName(f?: string | null, l?: string | null): string {
  return `${(f ?? '').trim()} ${(l ?? '').trim()}`.trim();
}


function fmtTime(t?: string | null): string {
  if (!t) return '';
  return String(t).slice(0, 5);
}



export const notifyAvailabilityLessonAction = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S , INTERNAL_CALL_SECRET_S],
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

      const actionType = String(body.actionType || '').trim() as ActionType;

      const lessonId = String(body.lessonId || '').trim();
      const childId = String(body.childId || '').trim();

      const originalInstructorId = String(body.instructorId || '').trim();
      const newInstructorId = String(body.newInstructorId || '').trim();

      const originalDate = body.originalDate ? String(body.originalDate).slice(0, 10) : null;
      const originalStartTime = body.originalStartTime ? fmtTime(body.originalStartTime) : null;
      const originalEndTime = body.originalEndTime ? fmtTime(body.originalEndTime) : null;

      const newDate = body.newDate ? String(body.newDate).slice(0, 10) : null;
      const newStartTime = body.newStartTime ? fmtTime(body.newStartTime) : null;
      const newEndTime = body.newEndTime ? fmtTime(body.newEndTime) : null;

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });
      if (!actionType) return void res.status(400).json({ error: 'Missing actionType' });
      if (!lessonId) return void res.status(400).json({ error: 'Missing lessonId' });
      if (!childId) return void res.status(400).json({ error: 'Missing childId' });

      if (!['move_lesson', 'cancel_lesson_with_makeup', 'end_series'].includes(actionType)) {
        return void res.status(400).json({ error: 'Invalid actionType' });
      }

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');

      if (!url || !key) {
        return void res.status(500).json({ error: 'Missing Supabase secrets' });
      }

      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
      const sbPublic = createClient(url, key, { db: { schema: 'public' } });

      const { data: farmRow, error: farmErr } = await sbPublic
        .from('farms')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();

      if (farmErr) throw farmErr;

      const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

      const { data: child, error: childErr } = await sbTenant
        .from('children')
        .select('child_uuid, first_name, last_name, parent_uid')
        .eq('child_uuid', childId)
        .maybeSingle();

      if (childErr) throw childErr;
      if (!child) return void res.status(404).json({ error: 'Child not found' });

      const childName = fullName((child as any).first_name, (child as any).last_name) || 'הילד/ה';
      const parentUid = String((child as any).parent_uid || '').trim();

      const { data: parent, error: parentErr } = parentUid
        ? await sbTenant
            .from('parents')
            .select('uid, first_name, last_name')
            .eq('uid', parentUid)
            .maybeSingle()
        : { data: null, error: null as any };

      if (parentErr) throw parentErr;

      const parentName =
        parent
          ? fullName((parent as any).first_name, (parent as any).last_name) || 'הורה'
          : 'הורה';

      const instructorIds = Array.from(
        new Set(
          [originalInstructorId, newInstructorId]
            .map(x => String(x || '').trim())
            .filter(Boolean)
        )
      );

      const instructors: Array<{
        id_number: string;
        uid: string | null;
        first_name: string | null;
        last_name: string | null;
      }> = [];

      if (instructorIds.length) {
        const { data: instRows, error: instErr } = await sbTenant
          .from('instructors')
          .select('id_number, uid, first_name, last_name')
          .in('id_number', instructorIds);

        if (instErr) throw instErr;

        instructors.push(...((instRows ?? []) as any[]));
      }

      const primaryInstructor =
        instructors.find(i => i.id_number === newInstructorId) ||
        instructors.find(i => i.id_number === originalInstructorId) ||
        null;

      const instructorName =
        primaryInstructor
          ? fullName(primaryInstructor.first_name, primaryInstructor.last_name) || 'המדריך/ה'
          : 'המדריך/ה';

      let mailOk = true;
      const warnings: string[] = [];
      const mailErrors: any[] = [];
      const mailResults: any[] = [];

      

      // מייל להורה
      try {
        if (parentUid) {
         const { subject, html, text } = buildAvailabilityLessonActionEmail({
  kind: 'parent',
  farmName,
  parentName,
  instructorName,
  childName,
  actionType,
  originalDate,
  originalStartTime,
  originalEndTime,
  newDate,
  newStartTime,
  newEndTime,
});

          const result = await notifyUserInternal({
            tenantSchema,
            userType: 'parent',
            uid: parentUid,
            subject,
            html,
            text,
            category: 'availability_lesson_action',
            forceEmail: true,
          });

          mailResults.push({ to: `parent:${parentUid}`, ok: true, result });
        } else {
          mailOk = false;
          warnings.push('הפעולה בוצעה, אך לא נמצא הורה לילד ולכן לא נשלח מייל להורה.');
        }
      } catch (e: any) {
        mailOk = false;
        warnings.push('הפעולה בוצעה, אך שליחת מייל להורה נכשלה.');
        mailErrors.push({ to: `parent:${parentUid}`, message: e?.message || String(e) });
      }

      // מייל למדריך/ים
      for (const inst of instructors) {
        try {
          if (!inst.uid) {
            mailOk = false;
            warnings.push(`לא נמצא uid למדריך ${inst.id_number}, ולכן לא נשלח אליו מייל.`);
            continue;
          }

          const instName = fullName(inst.first_name, inst.last_name) || 'המדריך/ה';

        const { subject, html, text } = buildAvailabilityLessonActionEmail({
  kind: 'instructor',
  farmName,
  instructorName: instName,
  childName,
  actionType,
  originalDate,
  originalStartTime,
  originalEndTime,
  newDate,
  newStartTime,
  newEndTime,
});
          const result = await notifyUserInternal({
            tenantSchema,
            userType: 'instructor',
            uid: inst.uid,
            subject,
            html,
            text,
            category: 'availability_lesson_action',
            forceEmail: true,
          });

          mailResults.push({ to: `instructor:${inst.uid}`, ok: true, result });
        } catch (e: any) {
          mailOk = false;
          warnings.push('הפעולה בוצעה, אך שליחת מייל למדריך נכשלה.');
          mailErrors.push({ to: `instructor:${inst.uid || inst.id_number}`, message: e?.message || String(e) });
        }
      }
console.log('notifyAvailabilityLessonAction result', {
  actionType,
  lessonId,
  childId,
  parentUid,
  instructorIds,
  mailOk,
  warnings,
  mailErrors,
  mailResults,
});
      return void res.status(200).json({
        ok: true,
        mailOk,
        warning: warnings.length ? warnings.join(' ') : null,
        mailResults,
        mailErrors,
        meta: {
          actionType,
          lessonId,
          childId,
          parentUid,
          instructorIds,
        },
      });
    } catch (e: any) {
      console.error('notifyAvailabilityLessonAction error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
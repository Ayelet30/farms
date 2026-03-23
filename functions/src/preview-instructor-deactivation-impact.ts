import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';

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

export const previewInstructorDeactivationImpact = onRequest(
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

      if (!isInternalCall(req)) {
        await requireAuth(req);
      }

      const body = req.body || {};
      const tenantSchema = String(body.tenantSchema || '').trim();
      const instructorIdNumber = String(body.instructorIdNumber || '').trim();
      const fromDate = String(
        body.fromDate || new Date().toISOString().slice(0, 10)
      ).slice(0, 10);

      if (!tenantSchema) {
        return void res.status(400).json({ error: 'Missing tenantSchema' });
      }
      if (!instructorIdNumber) {
        return void res.status(400).json({ error: 'Missing instructorIdNumber' });
      }

      const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
      const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;
      const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });

      // 1) לוודא שהמדריך קיים
      const { data: inst, error: instErr } = await sbTenant
        .from('instructors')
        .select('id_number, first_name, last_name, status')
        .eq('id_number', instructorIdNumber)
        .maybeSingle();

      if (instErr) throw instErr;
      if (!inst) {
        return void res.status(404).json({ ok: false, message: 'Instructor not found' });
      }

      // 2) שליפת שיעורים עתידיים של המדריך
      const { data: occs, error: occErr } = await sbTenant
        .from('lessons_occurrences')
        .select('lesson_id, occur_date, start_time, end_time, child_id, instructor_id')
        .eq('instructor_id', instructorIdNumber)
        .gte('occur_date', fromDate)
        .order('occur_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (occErr) throw occErr;

      const affected = (occs ?? []) as OccRow[];
      const childIds = Array.from(
        new Set(
          affected
            .map((x) => String(x.child_id || '').trim())
            .filter(Boolean)
        )
      );

      const childMap = new Map<
        string,
        { child_name: string; parent_uid: string | null }
      >();

      if (childIds.length) {
        const { data: children, error: chErr } = await sbTenant
          .from('children')
          .select('child_uuid, first_name, last_name, parent_uid')
          .in('child_uuid', childIds);

        if (chErr) throw chErr;

        for (const c of (children ?? []) as any[]) {
          childMap.set(String(c.child_uuid), {
            child_name: fullName(c.first_name, c.last_name) ?? 'הילד/ה',
            parent_uid: c.parent_uid ? String(c.parent_uid) : null,
          });
        }
      }

      const parentUids = Array.from(
        new Set(
          Array.from(childMap.values())
            .map((x) => x.parent_uid || '')
            .filter(Boolean)
        )
      );

      const parentMap = new Map<string, string>();

      if (parentUids.length) {
        const { data: parents, error: parErr } = await sbTenant
          .from('parents')
          .select('uid, first_name, last_name')
          .in('uid', parentUids);

        if (parErr) throw parErr;

        for (const p of (parents ?? []) as any[]) {
          parentMap.set(
            String(p.uid),
            fullName(p.first_name, p.last_name) ?? 'הורה'
          );
        }
      }

      const items = affected.map((row) => {
        const childMeta = row.child_id ? childMap.get(String(row.child_id)) : null;
        const parentName =
          childMeta?.parent_uid ? parentMap.get(childMeta.parent_uid) ?? 'הורה' : '—';

        return {
          lesson_id: row.lesson_id,
          occur_date: String(row.occur_date).slice(0, 10),
          start_time: String(row.start_time ?? '').slice(0, 5),
          end_time: String(row.end_time ?? '').slice(0, 5),
          child_id: row.child_id,
          child_name: childMeta?.child_name ?? '—',
          parent_name: parentName,
        };
      });

      return void res.status(200).json({
        ok: true,
        instructor: {
          id_number: inst.id_number,
          name: fullName((inst as any).first_name, (inst as any).last_name),
          status: (inst as any).status ?? null,
        },
        impactCount: items.length,
        fromDate,
        items,
      });
    } catch (e: any) {
      console.error('previewInstructorDeactivationImpact error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);
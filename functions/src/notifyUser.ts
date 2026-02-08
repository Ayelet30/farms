import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

// אם תרצי להפוך את זה ל-secret במקום URL קשיח — אפשר.
// כרגע מיישר קו עם מה שיש אצלך ב-callSendEmailGmail.
const SEND_EMAIL_GMAIL_URL = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';

// ===== CORS =====
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
  // תואם למה ש-sendEmailGmail שלך מאפשר
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

  const got = String(req.headers['x-internal-secret'] || req.headers['X-Internal-Secret'] || '');
  return !!(got && timingSafeEq(got, secret));
}

// בסיסי כדי למנוע schema injection
function validateTenantSchema(schema: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(schema);
}

type UserType = 'parent' | 'instructor';

function toBool(v: any): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function isNotifyAllowed(notify: any, category?: string | null): { ok: boolean; reason?: string } {
  const emailEnabled = toBool(notify?.email);
  if (!emailEnabled) return { ok: false, reason: 'notify_email_disabled' };

  if (category) {
    const catEnabled = toBool(notify?.[category]);
    if (!catEnabled) return { ok: false, reason: `notify_category_disabled:${category}` };
  }
  return { ok: true };
}

function normStr(x: any, max = 80000) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

export const notifyUser = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
  },
  async (req, res) => {
    if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      // notifyUser הוא שירות פנימי בלבד (כמו שרצית)
      if (!isInternalCall(req)) {
        // אם כן תרצי לאפשר גם מהקליינט עם Bearer — אפשר להחזיר requireAuth כמו ב-sendEmailGmail
        throw new HttpsError('unauthenticated', 'Internal only');
      }

      const internalSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
      if (!internalSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

      const body = req.body || {};

      const tenantSchema = normStr(body.tenantSchema, 120);
      const userType = String(body.userType || '').trim() as UserType;
      const uid = String(body.uid || '').trim();

      const category = body.category != null ? String(body.category).trim() : null;
      const forceEmail = body.forceEmail === true;

      const subject = normStr(body.subject, 200);
      const html = normStr(body.html, 80000);
      const text = normStr(body.text, 20000);

      const toOverride = body.to ? String(body.to).trim() : null;

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing "tenantSchema"' });
      if (!validateTenantSchema(tenantSchema)) return void res.status(400).json({ error: 'Invalid tenantSchema' });

      if (!uid) return void res.status(400).json({ error: 'Missing "uid"' });
      if (userType !== 'parent' && userType !== 'instructor') {
        return void res.status(400).json({ error: 'userType must be parent|instructor' });
      }
      if (!subject) return void res.status(400).json({ error: 'Missing "subject"' });
      if (!html && !text) return void res.status(400).json({ error: 'Provide "html" or "text"' });

      const sb = createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
        auth: { persistSession: false },
      });

      let notify: any = {};
      let toEmail: string | null = null;

      if (userType === 'parent') {
        // Parent: email מהטננט
        const { data, error } = await sb
          .schema(tenantSchema)
          .from('parents')
          .select('uid,email,notify,is_active')
          .eq('uid', uid)
          .maybeSingle();

        if (error) return void res.status(500).json({ error: 'DB error', message: error.message });
        if (!data) return void res.status(404).json({ error: 'Parent not found in tenant', tenantSchema });

        if (data.is_active === false) {
          return void res.status(200).json({ sent: false, channel: 'email', reason: 'parent_inactive' });
        }

        notify = data.notify ?? {};
        toEmail = toOverride || data.email || null;
      } else {
        // Instructor: notify מהטננט, email מ-public.users
        const { data, error } = await sb
          .schema(tenantSchema)
          .from('instructors')
          .select('uid,notify')
          .eq('uid', uid)
          .maybeSingle();

        if (error) return void res.status(500).json({ error: 'DB error', message: error.message });
        if (!data) return void res.status(404).json({ error: 'Instructor not found in tenant', tenantSchema });

        notify = data.notify ?? {};

        const { data: urow, error: uerr } = await sb
          .schema('public')
          .from('users')
          .select('uid,email')
          .eq('uid', uid)
          .maybeSingle();

        if (uerr) return void res.status(500).json({ error: 'DB error', message: uerr.message });

        toEmail = toOverride || urow?.email || null;
      }

      // בדיקת העדפות
      const allow = isNotifyAllowed(notify, category);
      if (!forceEmail && !allow.ok) {
        return void res.status(200).json({
          sent: false,
          channel: 'email',
          reason: allow.reason,
          tenantSchema,
          userType,
          uid,
        });
      }

      if (!toEmail) {
        return void res.status(200).json({
          sent: false,
          channel: 'email',
          reason: userType === 'parent' ? 'missing_parent_email' : 'missing_users_email',
          tenantSchema,
          userType,
          uid,
        });
      }

      // קריאה ל-sendEmailGmail שלך
      const payload: any = {
        tenantSchema,
        to: [toEmail],
        subject,
        html: html || undefined,
        text: text || undefined,
      };
console.log("PAYLOAD : " + payload); 
      const r = await fetch(SEND_EMAIL_GMAIL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // תואם ל-isInternalCall ב-sendEmailGmail
          'X-Internal-Secret': internalSecret,
        },
        body: JSON.stringify(payload),
      });

      const json: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        return void res.status(500).json({
          error: 'sendEmailGmail failed',
          message: json?.message || json?.error || r.statusText,
          status: r.status,
        });
      }

      return void res.status(200).json({
        sent: true,
        channel: 'email',
        tenantSchema,
        userType,
        uid,
        to: toEmail,
        category: category || null,
        providerResult: json,
      });
    } catch (e: any) {
      const code = e?.code;
      const msg = e?.message || String(e);

      if (code === 'unauthenticated') {
        return void res.status(401).json({ error: 'unauthenticated', message: msg });
      }

      console.error('notifyUser error', e);
      return void res.status(500).json({ error: 'Internal error', message: msg });
    }
  }
);

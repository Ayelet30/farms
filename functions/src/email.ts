
import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import { sendEmailCore } from './gmail/email-core';
import {
  SUPABASE_URL_S,
  SUPABASE_KEY_S,
  GMAIL_MASTER_KEY_S,
} from './gmail/email-core';



if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
 const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

/** CORS */
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

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function normStr(x: any, max = 5000) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function asArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String);
  return [String(x)];
}

function looksLikeEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function requireAuth(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
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


export const sendEmailGmail = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      GMAIL_MASTER_KEY_S,
      INTERNAL_CALL_SECRET_S,
    ],
  },
  async (req, res) => {
    if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      // auth / internal
      let decoded: any = null;
      if (!isInternalCall(req)) {
        decoded = await requireAuth(req);
      } else {
        decoded = { uid: 'INTERNAL' };
      }

      const body = req.body || {};

      const tenantSchema = normStr(body.tenantSchema, 120);
      if (!tenantSchema) return void res.status(400).json({ error: 'Missing "tenantSchema"' });

const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
      if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

      const to = asArray(body.to).map(s => s.trim()).filter(Boolean);
      const cc = asArray(body.cc).map(s => s.trim()).filter(Boolean);
      const bcc = asArray(body.bcc).map(s => s.trim()).filter(Boolean);

      const subject = normStr(body.subject, 200);
      const text = normStr(body.text, 20000);
      const html = normStr(body.html, 80000);
      const replyTo = normStr(body.replyTo, 200) || undefined;

      if (!to.length) return void res.status(400).json({ error: 'Missing "to"' });
      if (!subject) return void res.status(400).json({ error: 'Missing "subject"' });
      if (!text && !html) return void res.status(400).json({ error: 'Provide "text" or "html"' });

      if (![...to, ...cc, ...bcc].every(looksLikeEmail)) {
        return void res.status(400).json({ error: 'Invalid email in to/cc/bcc' });
      }
      if (replyTo && !looksLikeEmail(replyTo)) {
        return void res.status(400).json({ error: 'Invalid replyTo' });
      }

      const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
      if (rawAtt.length > 5) return void res.status(400).json({ error: 'Too many attachments (max 5)' });

      // ✅ call core
      const result = await sendEmailCore({
        tenantSchema,
        to,
        cc,
        bcc,
        subject,
        text: text || undefined,
        html: html || undefined,
        replyTo,
        attachments: rawAtt, // מגיע עם contentBase64 מהקליינט
        fromName: 'Smart Farm',
      });
console.log("RESULT:" + result +"!!!!!!111"); 
      return void res.status(200).json({
        ...result,
        sentBy: decoded.uid,
      });
    } catch (e: any) {
      console.error('sendEmailGmail error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

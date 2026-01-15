import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

const GMAIL_CLIENT_ID_S = defineSecret('GMAIL_CLIENT_ID');
const GMAIL_CLIENT_SECRET_S = defineSecret('GMAIL_CLIENT_SECRET');
const GMAIL_REFRESH_TOKEN_S = defineSecret('GMAIL_REFRESH_TOKEN');
const GMAIL_SENDER_S = defineSecret('GMAIL_SENDER');

const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'http://localhost:4200',
]);

function cors(req: any, res: any) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

const envOrSecret = (s: ReturnType<typeof defineSecret>, name: string) =>
  s.value() || process.env[name];

function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key, { db: { schema: schema || 'public' } }) as SupabaseClient;
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

// ===== MIME helpers (כולל קבצים מצורפים) =====
function toBase64Url(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRawEmail(args: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; contentType?: string; content: Buffer }>;
}) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const headers: string[] = [
    `From: ${args.from}`,
    `To: ${args.to.join(', ')}`,
    args.cc?.length ? `Cc: ${args.cc.join(', ')}` : '',
    args.bcc?.length ? `Bcc: ${args.bcc.join(', ')}` : '',
    `Subject: ${args.subject}`,
    args.replyTo ? `Reply-To: ${args.replyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const hasAttachments = (args.attachments?.length || 0) > 0;

  if (!hasAttachments) {
    // בלי מצורפים: text או html
    if (args.html) {
      headers.push('Content-Type: text/html; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + args.html, 'utf8'));
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (args.text || ''), 'utf8'));
    }
  }

  // עם מצורפים: multipart/mixed + body + attachments
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts: string[] = [];
  const bodyContent =
    args.html
      ? `Content-Type: text/html; charset="UTF-8"\r\n\r\n${args.html}`
      : `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${args.text || ''}`;

  parts.push(`--${boundary}\r\n${bodyContent}\r\n`);

  for (const a of args.attachments || []) {
    const ct = a.contentType || 'application/octet-stream';
    const b64 = a.content.toString('base64');
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${ct}; name="${a.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${a.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64}\r\n`
    );
  }

  parts.push(`--${boundary}--`);

  const raw = headers.join('\r\n') + '\r\n\r\n' + parts.join('');
  return toBase64Url(Buffer.from(raw, 'utf8'));
}

async function sendViaGmailApi(payload: {
  fromEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; contentType?: string; content: Buffer }>;
}) {
  const clientId = envOrSecret(GMAIL_CLIENT_ID_S, 'GMAIL_CLIENT_ID');
  const clientSecret = envOrSecret(GMAIL_CLIENT_SECRET_S, 'GMAIL_CLIENT_SECRET');
  const refreshToken = envOrSecret(GMAIL_REFRESH_TOKEN_S, 'GMAIL_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Gmail OAuth secrets (CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN)');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const raw = buildRawEmail({
    from: `Smart Farm <${payload.fromEmail}>`,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    replyTo: payload.replyTo,
    attachments: payload.attachments,
  });

  const r = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return r.data; // כולל id/threadId וכו'
}

/**
 * Body schema:
 * {
 *   tenantSchema: string,
 *   to: string | string[],
 *   subject: string,
 *   text?: string,
 *   html?: string,
 *   cc?: string | string[],
 *   bcc?: string | string[],
 *   replyTo?: string,
 *   attachments?: Array<{ filename: string, contentBase64: string, contentType?: string }>
 * }
 */
export const sendEmailGmail = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      GMAIL_CLIENT_ID_S,
      GMAIL_CLIENT_SECRET_S,
      GMAIL_REFRESH_TOKEN_S,
      GMAIL_SENDER_S,
    ],
  },
  async (req, res) => {
    try {
      if (cors(req, res)) return;
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      const decoded = await requireAuth(req);

      const body = req.body || {};
      const tenantSchema = normStr(body.tenantSchema, 120);
      if (!tenantSchema) return void res.status(400).json({ error: 'Missing "tenantSchema"' });

      // אם תרצי בעתיד: אפשר עדיין לקרוא מה-DB מי השולח,
      // כרגע: משתמשים בסוד GMAIL_SENDER (מייל קבוע לשולח)
      const sender = normStr(envOrSecret(GMAIL_SENDER_S, 'GMAIL_SENDER'), 200);
      if (!sender || !looksLikeEmail(sender)) {
        return void res.status(500).json({ error: 'Invalid/missing GMAIL_SENDER secret' });
      }

      // ולידציות לתוכן המייל
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

      // מצורפים
      const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
      if (rawAtt.length > 5) return void res.status(400).json({ error: 'Too many attachments (max 5)' });

      const attachments = rawAtt.map((a: any) => {
        const filename = normStr(a?.filename, 120) || 'file';
        const contentBase64 = String(a?.contentBase64 || '');
        if (!contentBase64) throw new Error('Attachment missing contentBase64');
        if (contentBase64.length > 4_000_000) throw new Error(`Attachment too large: ${filename}`);
        return {
          filename,
          content: Buffer.from(contentBase64, 'base64'),
          contentType: normStr(a?.contentType, 120) || undefined,
        };
      });

      // (אופציונלי) נגיעה ב-Supabase כדי לשמור לוג/אודיט לפי tenant
      // const sbTenant = getSupabaseForTenant(tenantSchema);
      // ... write log row if you want

      const data = await sendViaGmailApi({
        fromEmail: sender,
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject,
        text: text || undefined,
        html: html || undefined,
        replyTo,
        attachments: attachments.length ? attachments : undefined,
      });

      res.status(200).json({
        ok: true,
        gmailMessageId: data.id,
        threadId: data.threadId,
        sentBy: decoded.uid,
        tenant: tenantSchema,
      });
    } catch (e: any) {
      console.error('sendEmailGmail error', e);
      res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

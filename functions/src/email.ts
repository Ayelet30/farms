import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decryptRefreshToken } from './crypto-gmail';

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets (קבועים לכל פרויקט) =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const GMAIL_CLIENT_ID_S = defineSecret('GMAIL_CLIENT_ID');
const GMAIL_CLIENT_SECRET_S = defineSecret('GMAIL_CLIENT_SECRET');
const GMAIL_MASTER_KEY_S = defineSecret('GMAIL_MASTER_KEY');

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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
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

// ===== MIME helpers =====
function toBase64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    `Subject: ${encodeSubjectUtf8(args.subject)}`,
    args.replyTo ? `Reply-To: ${args.replyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const hasAttachments = (args.attachments?.length || 0) > 0;

  if (!hasAttachments) {
    if (args.html) {
      headers.push('Content-Type: text/html; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + args.html, 'utf8'));
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (args.text || ''), 'utf8'));
    }
  }

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
    // timeoutSeconds: 60, // אם תרצי להגדיל ל-2 דקות אפשר לשים 120
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      GMAIL_CLIENT_ID_S,
      GMAIL_CLIENT_SECRET_S,
      GMAIL_MASTER_KEY_S,
    ],
  },
  async (req, res) => {
    if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      const decoded = await requireAuth(req);

      const body = req.body || {};
      const tenantSchema = normStr(body.tenantSchema, 120);
      if (!tenantSchema) return void res.status(400).json({ error: 'Missing "tenantSchema"' });

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

      // קריאה מהחווה: שולח + refresh token מוצפן
      const sbTenant = getSupabaseForTenant(tenantSchema);

      const { data: fs, error: fsErr } = await sbTenant
        .from('farm_settings')
        .select('main_mail, gmail_refresh_token_enc, gmail_refresh_token_iv, gmail_refresh_token_tag')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fsErr) throw new Error(`farm_settings query failed: ${fsErr.message}`);
      if (!fs?.main_mail || !looksLikeEmail(fs.main_mail)) {
        throw new Error('farm_settings.main_mail missing/invalid');
      }
      if (!fs.gmail_refresh_token_enc || !fs.gmail_refresh_token_iv || !fs.gmail_refresh_token_tag) {
        throw new Error('Gmail refresh token not connected for this farm');
      }

      const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
      if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

      const refreshToken = decryptRefreshToken(
        fs.gmail_refresh_token_enc,
        fs.gmail_refresh_token_iv,
        fs.gmail_refresh_token_tag,
        masterKey
      );


      // מצורפים
      const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
      if (rawAtt.length > 5) return void res.status(400).json({ error: 'Too many attachments (max 5)' });

      const attachments = rawAtt.map((a: any) => {
        const filename = normStr(a?.filename, 180) || 'file';
        const contentBase64 = String(a?.contentBase64 || '');
        if (!contentBase64) throw new Error(`Attachment missing contentBase64: ${filename}`);
        if (contentBase64.length > 6_000_000) throw new Error(`Attachment too large: ${filename}`);
        return {
          filename,
          content: Buffer.from(contentBase64, 'base64'),
          contentType: normStr(a?.contentType, 120) || undefined,
        };
      });

      // Gmail OAuth
      const clientId = envOrSecret(GMAIL_CLIENT_ID_S, 'GMAIL_CLIENT_ID');
      const clientSecret = envOrSecret(GMAIL_CLIENT_SECRET_S, 'GMAIL_CLIENT_SECRET');
      if (!clientId || !clientSecret) throw new Error('Missing Gmail CLIENT_ID/CLIENT_SECRET');

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const raw = buildRawEmail({
        from: `Smart Farm <${fs.main_mail}>`,
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject,
        text: text || undefined,
        html: html || undefined,
        replyTo,
        attachments: attachments.length ? attachments : undefined,
      });

      const r = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      return void res.status(200).json({
        ok: true,
        gmailMessageId: r.data.id,
        threadId: r.data.threadId,
        tenant: tenantSchema,
        sentBy: decoded.uid,
        from: fs.main_mail,
      });
    } catch (e: any) {
      console.error('sendEmailGmail error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);
function encodeSubjectUtf8(subject: string) {
  const b64 = Buffer.from(subject, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}


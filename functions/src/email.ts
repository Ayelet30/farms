import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

const SMTP_HOST_S = defineSecret('SMTP_HOST');
const SMTP_PORT_S = defineSecret('SMTP_PORT'); // "587"

// הסודות האפשריים לסיסמאות מייל (שמות סודות אמיתיים ב-Firebase Secrets)
const SMTP_PASS_S = defineSecret('SMTP_PASS');

// אופציונלי: אם יש לך עוד חוות/דומיינים עם סיסמא אחרת
// const SMTP_PASS_FARM2_S = defineSecret('SMTP_PASS_FARM2');

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

/** ===== DB: farm_settings mail config ===== */
type FarmMailSettings = {
  main_mail: string | null;
  secret_mail_password: string | null; // לדוגמה: 'SMTP_PASS'
  // אם תרצי בהמשך גם:
  // smtp_host?: string | null;
  // smtp_port?: number | null;
};

async function loadFarmMailSettings(args: {
  sbTenant: SupabaseClient;
}): Promise<FarmMailSettings> {
  const { sbTenant } = args;

  const { data, error } = await sbTenant
    .from('farm_settings')
    .select('main_mail, secret_mail_password')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`farm_settings query failed: ${error.message}`);
  if (!data) throw new Error('No farm_settings row found');

  return {
    main_mail: (data as any).main_mail ?? null,
    secret_mail_password: (data as any).secret_mail_password ?? null,
  };
}

/** ===== Resolve secret by "key name" stored in DB ===== */
function resolveMailPasswordByKeyName(keyName: string | null | undefined): string {
  const k = String(keyName ?? '').trim();
  if (!k) throw new Error('Missing secret_mail_password in farm_settings');

  switch (k) {
    case 'SMTP_PASS': {
      const v = envOrSecret(SMTP_PASS_S, 'SMTP_PASS');
      if (!v) throw new Error('Missing secret: SMTP_PASS');
      return v;
    }
    // case 'SMTP_PASS_PSAGOT': {
    //   const v = envOrSecret(SMTP_PASS_PSAGOT_S, 'SMTP_PASS_PSAGOT');
    //   if (!v) throw new Error('Missing secret: SMTP_PASS_PSAGOT');
    //   return v;
    // }
    default:
      throw new Error(`Unknown mail secret key name: ${k}`);
  }
}


/**
 * Body schema:
 * {
 *   tenantSchema: string,            // חובה כדי לדעת מאיזה farm_settings לקרוא
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
export const sendEmail = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      SMTP_HOST_S,
      SMTP_PORT_S,
      SMTP_PASS_S,

      // אם הוספת עוד סודות למיפוי – חייבים להוסיף גם פה:
      // SMTP_PASS_FARM2_S,
    ],
  },
  async (req, res) => {
    try {
      if (cors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const decoded = await requireAuth(req);

      const body = req.body || {};
      const tenantSchema = normStr(body.tenantSchema, 120);
      if (!tenantSchema) {
        res.status(400).json({ error: 'Missing "tenantSchema"' });
        return;
      }

      // 1) טוענים הגדרות מייל מהחווה
      const sbTenant = getSupabaseForTenant(tenantSchema);
      const mailCfg = await loadFarmMailSettings({ sbTenant });

      const smtpUser = normStr(mailCfg.main_mail, 200);
      if (!smtpUser || !looksLikeEmail(smtpUser)) {
        res.status(500).json({ error: 'Invalid or missing main_mail in farm_settings' });
        return;
      }

      const smtpPass = resolveMailPasswordByKeyName(mailCfg.secret_mail_password);

      // 2) ולידציות לתוכן המייל
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

      // 3) מצורפים
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

      const host = envOrSecret(SMTP_HOST_S, 'SMTP_HOST');
      const port = Number(envOrSecret(SMTP_PORT_S, 'SMTP_PORT') || '587');
      if (!host) throw new Error('Missing SMTP_HOST');
      if (!Number.isFinite(port)) throw new Error('Invalid SMTP_PORT');


      // 4) Transporter לפי DB (user/pass) + secrets (host/port)
      const transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const from = `Smart Farm <${smtpUser}>`;

      const info = await transporter.sendMail({
        from,
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject,
        text: text || undefined,
        html: html || undefined,
        replyTo,
        attachments: attachments.length ? attachments : undefined,
        headers: {
          'X-App': 'smart-farm',
          'X-Sent-By': decoded.uid,
          'X-Tenant': tenantSchema,
        },
      });

      res.status(200).json({ ok: true, messageId: info.messageId });
    } catch (e: any) {
      console.error('sendEmail error', e);
      res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

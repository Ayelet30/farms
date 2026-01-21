// functions/src/gmail/email-core.ts
import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { decryptRefreshToken } from './crypto-gmail';
import { buildRawEmail, GmailAttachment } from './mime';


// functions/src/gmail/email-core.ts
export const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
export const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
export const GMAIL_CLIENT_ID_S = defineSecret('GMAIL_CLIENT_ID');
export const GMAIL_CLIENT_SECRET_S = defineSecret('GMAIL_CLIENT_SECRET');
export const GMAIL_MASTER_KEY_S = defineSecret('GMAIL_MASTER_KEY');

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key, { db: { schema: schema || 'public' } }) as SupabaseClient;
}

function asArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String);
  return [String(x)];
}

function normStr(x: any, max = 5000) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function looksLikeEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export type SendEmailCoreArgs = {
  tenantSchema: string;

  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;

  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;

  attachments?: Array<{
    filename: string;
    contentType?: string;
    contentBase64?: string;  // אם מגיע מלקוח
    content?: Buffer;        // אם מגיע משרת
  }>;

  // אופציונלי: שם תצוגה
  fromName?: string; // ברירת מחדל: "Smart Farm"
};

export async function sendEmailCore(args: SendEmailCoreArgs) {
console.log("sendEmailCore called", { tenantSchema: args.tenantSchema, toCount: Array.isArray(args.to) ? args.to.length : 1 });
  const tenantSchema = normStr(args.tenantSchema, 120);
  if (!tenantSchema) throw new Error('Missing tenantSchema');

  const to = asArray(args.to).map(s => s.trim()).filter(Boolean);
  const cc = asArray(args.cc).map(s => s.trim()).filter(Boolean);
  const bcc = asArray(args.bcc).map(s => s.trim()).filter(Boolean);

  const subject = normStr(args.subject, 200);
  const text = normStr(args.text, 20000);
  const html = normStr(args.html, 80000);
  const replyTo = normStr(args.replyTo, 200) || undefined;

  if (!to.length) throw new Error('Missing "to"');
  if (!subject) throw new Error('Missing "subject"');
  if (!text && !html) throw new Error('Provide "text" or "html"');

  if (![...to, ...cc, ...bcc].every(looksLikeEmail)) throw new Error('Invalid email in to/cc/bcc');
  if (replyTo && !looksLikeEmail(replyTo)) throw new Error('Invalid replyTo');

  // ===== farm_settings =====
  const sbTenant = getSupabaseForTenant(tenantSchema);
  const { data: fs, error: fsErr } = await sbTenant
    .from('farm_settings')
    .select('main_mail, gmail_refresh_token_enc, gmail_refresh_token_iv, gmail_refresh_token_tag')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
console.log("farm_settings:", {
  hasRow: !!fs,
  main_mail: fs?.main_mail,
  hasEnc: !!fs?.gmail_refresh_token_enc,
  hasIv: !!fs?.gmail_refresh_token_iv,
  hasTag: !!fs?.gmail_refresh_token_tag,
  fsErr: fsErr?.message,
});

  if (fsErr) throw new Error(`farm_settings query failed: ${fsErr.message}`);
  if (!fs?.main_mail || !looksLikeEmail(fs.main_mail)) throw new Error('farm_settings.main_mail missing/invalid');
  if (!fs.gmail_refresh_token_enc || !fs.gmail_refresh_token_iv || !fs.gmail_refresh_token_tag) {
    throw new Error('Gmail refresh token not connected for this farm');
  }
console.log("GMAIL_MASTER_KEY length (core):", (GMAIL_MASTER_KEY_S.value() || "").length);

  const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
  if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

  const refreshToken = decryptRefreshToken(
    fs.gmail_refresh_token_enc,
    fs.gmail_refresh_token_iv,
    fs.gmail_refresh_token_tag,
    masterKey
  );

  // ===== attachments =====
  const rawAtt = Array.isArray(args.attachments) ? args.attachments : [];
  if (rawAtt.length > 5) throw new Error('Too many attachments (max 5)');

  const attachments: GmailAttachment[] = rawAtt.map((a: any) => {
    const filename = normStr(a?.filename, 180) || 'file';
    const contentType = normStr(a?.contentType, 120) || undefined;

    let content: Buffer | null = null;
    if (a?.content && Buffer.isBuffer(a.content)) {
      content = a.content;
    } else if (a?.contentBase64) {
      const s = String(a.contentBase64);
      if (s.length > 6_000_000) throw new Error(`Attachment too large: ${filename}`);
      content = Buffer.from(s, 'base64');
    }

    if (!content) throw new Error(`Attachment missing content: ${filename}`);

    return { filename, contentType, content };
  });

  // ===== Gmail OAuth =====
  const clientId = envOrSecret(GMAIL_CLIENT_ID_S, 'GMAIL_CLIENT_ID');
  const clientSecret = envOrSecret(GMAIL_CLIENT_SECRET_S, 'GMAIL_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Missing Gmail CLIENT_ID/CLIENT_SECRET');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const fromName = (args.fromName && normStr(args.fromName, 80)) || 'Smart Farm';

  const raw = buildRawEmail({
    from: `${fromName} <${fs.main_mail}>`,
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

  return {
    ok: true,
    gmailMessageId: r.data.id,
    threadId: r.data.threadId,
    tenant: tenantSchema,
    from: fs.main_mail,
  };
}

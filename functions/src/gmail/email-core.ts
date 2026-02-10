import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { decryptRefreshToken } from './crypto-gmail';
import { buildRawEmail, GmailAttachment } from './mime';

export const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
export const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
export const GMAIL_MASTER_KEY_S = defineSecret('GMAIL_MASTER_KEY');

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function getSupabase(schema: string): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');

  return createClient(url, key, {
    db: { schema },
    auth: { persistSession: false },
  }) as SupabaseClient;
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

type GmailIdentityRow = {
  tenant_schema: string;
  sender_email: string | null;

  gmail_refresh_token_enc: string | null;
  gmail_refresh_token_iv: string | null;
  gmail_refresh_token_tag: string | null;

  gmail_client_id: string;
  gmail_client_secret_enc: string;
  gmail_client_secret_iv: string;
  gmail_client_secret_tag: string;

  redirect_uri: string | null;
};

export type SendEmailCoreArgs = {
  tenantSchema: string;

  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;

  subject: string;
  text?: string;
  html?: string;

  /** אם לא תשלחי replyTo – התשובות יחזרו ל-From (sender_email) */
  replyTo?: string;

  attachments?: Array<{
    filename: string;
    contentType?: string;
    contentBase64?: string;
    content?: Buffer;
  }>;

  fromName?: string;
};

export async function sendEmailCore(args: SendEmailCoreArgs) {
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

  const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
  if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

  // 1) identity (public) => sender_email + refresh token + client credentials
  const sbPublic = getSupabase('public');
  const { data: ident, error: identErr } = await sbPublic
    .from('gmail_identities')
    .select(`
      tenant_schema,
      sender_email,
      gmail_refresh_token_enc,
      gmail_refresh_token_iv,
      gmail_refresh_token_tag,
      gmail_client_id,
      gmail_client_secret_enc,
      gmail_client_secret_iv,
      gmail_client_secret_tag,
      redirect_uri
    `)
    .eq('tenant_schema', tenantSchema)
    .maybeSingle<GmailIdentityRow>();

  if (identErr) throw new Error(`gmail_identities query failed: ${identErr.message}`);
  if (!ident) throw new Error(`Missing gmail identity for tenant: ${tenantSchema}`);

  const senderEmail = normStr(ident.sender_email, 200);
  if (!senderEmail || !looksLikeEmail(senderEmail)) throw new Error('gmail_identities.sender_email missing/invalid');

  if (!ident.gmail_refresh_token_enc || !ident.gmail_refresh_token_iv || !ident.gmail_refresh_token_tag) {
    throw new Error('Gmail refresh token not connected for this farm');
  }

  const refreshToken = decryptRefreshToken(
    ident.gmail_refresh_token_enc,
    ident.gmail_refresh_token_iv,
    ident.gmail_refresh_token_tag,
    masterKey
  );

  const clientId = normStr(ident.gmail_client_id, 500);
  if (!clientId) throw new Error('gmail_identities.gmail_client_id missing');

  const clientSecret = decryptRefreshToken(
    ident.gmail_client_secret_enc,
    ident.gmail_client_secret_iv,
    ident.gmail_client_secret_tag,
    masterKey
  );

  // 2) attachments
  const rawAtt = Array.isArray(args.attachments) ? args.attachments : [];
  if (rawAtt.length > 5) throw new Error('Too many attachments (max 5)');

  const attachments: GmailAttachment[] = rawAtt.map((a: any) => {
    const filename = normStr(a?.filename, 180) || 'file';
    const contentType = normStr(a?.contentType, 120) || undefined;

    let content: Buffer | null = null;

    if (a?.content && Buffer.isBuffer(a.content)) content = a.content;
    else if (a?.contentBase64) {
      const s = String(a.contentBase64);
      if (s.length > 6_000_000) throw new Error(`Attachment too large: ${filename}`);
      content = Buffer.from(s, 'base64');
    }

    if (!content) throw new Error(`Attachment missing content: ${filename}`);
    return { filename, contentType, content };
  });

  // 3) Gmail OAuth + send
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, ident.redirect_uri || undefined);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const fromName = (args.fromName && normStr(args.fromName, 80)) || 'Smart Farm';

  const raw = buildRawEmail({
    from: `${fromName} <${senderEmail}>`,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text: text || undefined,
    html: html || undefined,
    replyTo,
    attachments: attachments.length ? attachments : undefined,
  });

  const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

  return {
    ok: true,
    gmailMessageId: r.data.id,
    threadId: r.data.threadId,
    tenant: tenantSchema,
    from: senderEmail,
  };
}

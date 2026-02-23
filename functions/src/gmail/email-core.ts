import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { buildRawEmail, GmailAttachment } from './mime';

/** ===== Secrets ===== */
export const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
export const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

export const GMAIL_REFRESH_TOKEN_S = defineSecret('GMAIL_REFRESH_TOKEN');
export const GMAIL_CLIENT_ID_S = defineSecret('GMAIL_CLIENT_ID');
export const GMAIL_CLIENT_SECRET_S = defineSecret('GMAIL_CLIENT_SECRET');
export const GMAIL_SENDER_EMAIL_S = defineSecret('GMAIL_SENDER');


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

async function getFarmPrimaryEmail(tenantSchema: string): Promise<string | undefined> {
  // קורא מתוך הסכמה של החווה עצמה
  const sbTenant = getSupabase(tenantSchema);

  const { data, error } = await sbTenant
    .from('farm_settings')
    .select('main_mail')
    .limit(1)
    .maybeSingle<{ main_mail: string | null }>();

  if (error) {
    // אם תרצי אפשר להחמיר ל-throw, אבל עדיף לא להפיל שליחת מייל
    console.warn(`farm_settings.main_mail query failed for ${tenantSchema}: ${error.message}`);
    return undefined;
  }

  const em = normStr(data?.main_mail, 200);
  if (em && looksLikeEmail(em)) return em;

  return undefined;
}


export type SendEmailCoreArgs = {
  tenantSchema: string;
  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  subject: string;
  text?: string;
  html?: string;

  /** אם לא תשלחי replyTo – ננסה להביא מה־DB את האימייל הראשי של החווה */
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

  if (!to.length) throw new Error('Missing "to"');
  if (!subject) throw new Error('Missing "subject"');
  if (!text && !html) throw new Error('Provide "text" or "html"');
  if (![...to, ...cc, ...bcc].every(looksLikeEmail)) throw new Error('Invalid email in to/cc/bcc');

  // Reply-To: או מהבקשה, או מה־DB לפי החווה
  let replyTo = normStr(args.replyTo, 200) || '';
  if (replyTo && !looksLikeEmail(replyTo)) throw new Error('Invalid replyTo');
  if (!replyTo) {
    const farmEmail = await getFarmPrimaryEmail(tenantSchema);
    if (farmEmail) replyTo = farmEmail;
  }
  const replyToFinal = replyTo || undefined;

  // ===== OAuth (Secrets בלבד) =====
  const refreshToken = normStr(envOrSecret(GMAIL_REFRESH_TOKEN_S, 'GMAIL_REFRESH_TOKEN'), 5000);
  const clientId = normStr(envOrSecret(GMAIL_CLIENT_ID_S, 'GMAIL_CLIENT_ID'), 2000);
  const clientSecret = normStr(envOrSecret(GMAIL_CLIENT_SECRET_S, 'GMAIL_CLIENT_SECRET'), 2000);

  if (!refreshToken) throw new Error('Missing GMAIL_REFRESH_TOKEN secret');
  if (!clientId) throw new Error('Missing GMAIL_CLIENT_ID secret');
  if (!clientSecret) throw new Error('Missing GMAIL_CLIENT_SECRET secret');

  // ===== attachments =====
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

  // ===== Gmail send =====
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // שולח “מאותו אחד”: ניקח את המייל של החשבון המחובר בפועל
  const senderEmail = normStr(envOrSecret(GMAIL_SENDER_EMAIL_S, 'GMAIL_SENDER_EMAIL'), 200);
if (!senderEmail || !looksLikeEmail(senderEmail)) {
  throw new Error('Missing/invalid GMAIL_SENDER_EMAIL secret');
}

  if (!senderEmail || !looksLikeEmail(senderEmail)) {
    throw new Error('Could not determine sender email from Gmail profile');
  }

  const fromName = (args.fromName && normStr(args.fromName, 80)) || 'Smart Farm';

  const raw = buildRawEmail({
    from: `${fromName} <${senderEmail}>`,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text: text || undefined,
    html: html || undefined,
    replyTo: replyToFinal,
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
    from: senderEmail,
    replyTo: replyToFinal || null,
  };
}

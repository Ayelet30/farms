import type { SupabaseClient } from '@supabase/supabase-js';
import fetch from "node-fetch";

type GmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};

export async function sendInvoiceEmailViaGmailCF(params: {
  sb: SupabaseClient;
  bucket: string;
  path: string;

  to: string;
  parentName: string;
  farmName: string;
  documentNumber?: string | null;

  tenantSchema: string;

  // URL של הפונקציה sendEmailGmail
  sendEmailGmailUrl: string;

  // INTERNAL_CALL_SECRET כדי לדלג על verifyIdToken
  internalCallSecret: string;

  // אופציונלי:
  replyTo?: string | null;
}) {
  const {
    sb,
    bucket,
    path,
    to,
    parentName,
    farmName,
    documentNumber,
    tenantSchema,
    sendEmailGmailUrl,
    internalCallSecret,
    replyTo,
  } = params;

  // 1) הורדת ה-PDF מה-Storage
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`Failed to download invoice PDF: ${error.message}`);
  if (!data) throw new Error('Invoice PDF is empty');

  const buffer = Buffer.from(await data.arrayBuffer());

  // 2) base64 נקי
  const contentBase64 = buffer.toString('base64');

  // 3) בניית מייל
  const subject = `חשבונית ${documentNumber ?? ''}`.trim();
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif">
      <p>שלום ${escapeHtml(parentName)},</p>
      <p>מצורפת החשבונית עבור התשלום שבוצע.</p>
      <p>תודה,<br/>חוות ${escapeHtml(farmName)}</p>
    </div>
  `.trim();

  const attachments: GmailAttachment[] = [
    {
      filename: `invoice-${documentNumber ?? 'payment'}.pdf`,
      contentType: 'application/pdf',
      contentBase64,
    },
  ];

  const payload: any = {
    tenantSchema,
    to: [to],
    subject,
    html,
    attachments,
  };

  if (replyTo?.trim()) payload.replyTo = replyTo.trim();

  const resp = await fetch(sendEmailGmailUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': internalCallSecret,
    },
    body: JSON.stringify(payload),
  });

const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`sendEmailGmail failed: ${json?.message || json?.error || resp.statusText}`);
  }

  return json;
}

function escapeHtml(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

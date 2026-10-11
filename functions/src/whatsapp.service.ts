import twilio from 'twilio';
import { defineSecret } from 'firebase-functions/params';

export const TWILIO_ACCOUNT_SID_S = defineSecret('TWILIO_ACCOUNT_SID');
export const TWILIO_AUTH_TOKEN_S = defineSecret('TWILIO_AUTH_TOKEN');

const TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';

function normalizeIsraeliPhone(rawPhone: string): string {
  const cleaned = String(rawPhone || '').trim().replace(/[\s-]/g, '');

  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('972')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+972${cleaned.slice(1)}`;

  return cleaned;
}

export async function sendWhatsappMessage(params: {
  toPhone: string;
  message: string;
}) {
  const accountSid = TWILIO_ACCOUNT_SID_S.value() || process.env.TWILIO_ACCOUNT_SID;
  const authToken = TWILIO_AUTH_TOKEN_S.value() || process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid) throw new Error('Missing TWILIO_ACCOUNT_SID');
  if (!authToken) throw new Error('Missing TWILIO_AUTH_TOKEN');

  const client = twilio(accountSid, authToken);

  const to = `whatsapp:${normalizeIsraeliPhone(params.toPhone)}`;

  return client.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to,
    body: params.message,
  });
}
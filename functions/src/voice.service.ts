import twilio from 'twilio';
import { defineSecret } from 'firebase-functions/params';
import {
  TWILIO_ACCOUNT_SID_S,
  TWILIO_AUTH_TOKEN_S,
} from './whatsapp.service';

export const TWILIO_VOICE_FROM_S = defineSecret('TWILIO_VOICE_FROM');

function normalizeIsraeliPhone(rawPhone: string): string {
  const cleaned = String(rawPhone || '').trim().replace(/[\s-]/g, '');

  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('972')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+972${cleaned.slice(1)}`;

  return cleaned;
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function sendVoiceMessage(params: {
  toPhone: string;
  message: string;
}) {
  const accountSid = TWILIO_ACCOUNT_SID_S.value() || process.env.TWILIO_ACCOUNT_SID;
  const authToken = TWILIO_AUTH_TOKEN_S.value() || process.env.TWILIO_AUTH_TOKEN;
  const voiceFrom = TWILIO_VOICE_FROM_S.value() || process.env.TWILIO_VOICE_FROM;

  if (!accountSid) throw new Error('Missing TWILIO_ACCOUNT_SID');
  if (!authToken) throw new Error('Missing TWILIO_AUTH_TOKEN');
  if (!voiceFrom) throw new Error('Missing TWILIO_VOICE_FROM');

  const client = twilio(accountSid, authToken);

  const twiml = `
<Response>
  <Say language="he-IL">${escapeXml(params.message)}</Say>
</Response>`;

  return client.calls.create({
    from: voiceFrom,
    to: normalizeIsraeliPhone(params.toPhone),
    twiml,
  });
}
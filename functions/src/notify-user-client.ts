import fetch from 'node-fetch';
import { defineSecret } from 'firebase-functions/params';

export const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

const NOTIFY_USER_URL =
  'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifyUser';

export async function notifyUserInternal(payload: {
  tenantSchema: string;
  userType: 'parent' | 'instructor';
  uid: string;
  subject: string;
  html?: string;
  text?: string;
  category?: string | null;
  forceEmail?: boolean;
}) {
  const internalSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
  if (!internalSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

  const r = await fetch(NOTIFY_USER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
    },
    body: JSON.stringify(payload),
  });

  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`notifyUser failed: ${json?.message || json?.error || r.statusText}`);
  }
  return json;
}

import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { encryptRefreshToken } from './gmail/crypto-gmail';

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const GMAIL_MASTER_KEY_S = defineSecret('GMAIL_MASTER_KEY');

const envOrSecret = (s: ReturnType<typeof defineSecret>, name: string) =>
  s.value() || process.env[name];

function normStr(x: unknown, max = 5000) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function looksLikeEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function requireAuth(req: { headers: Record<string, any> }) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
}

function getSupabasePublic(): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');

  return createClient(url, key, {
    db: { schema: 'public' },
    auth: { persistSession: false },
  }) as SupabaseClient;
}

function assertIsAdmin(decoded: any) {
  const allowed = new Set(['ayelethury@gmail.com']);
  if (!allowed.has(decoded?.email)) throw new HttpsError('permission-denied', 'Admin only');
}

/** ===== CORS ===== */
const ALLOWED_ORIGINS = new Set<string>([
  'http://localhost:4200',
  'https://localhost:4200',
  'https://smart-farm.org',
  'https://www.smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
]);

type ReqLike = { method: string; headers: Record<string, any> };
type ResLike = {
  setHeader: (k: string, v: string) => void;
  status: (c: number) => any;
  end: () => void;
  json: (b: any) => void;
};

function applyCors(req: ReqLike, res: ResLike): boolean {
  const origin = String(req.headers.origin || '');

  res.setHeader('Vary', 'Origin');

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

type GmailIdentRow = {
  tenant_schema: string;
  sender_email: string | null;

  gmail_client_id: string;
  gmail_client_secret_enc: string;
  gmail_client_secret_iv: string;
  gmail_client_secret_tag: string;

  gmail_refresh_token_enc: string | null;
  gmail_refresh_token_iv: string | null;
  gmail_refresh_token_tag: string | null;

  redirect_uri: string | null;
};

export const connectGmailForFarm = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, GMAIL_MASTER_KEY_S],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (applyCors(req as any, res as any)) return;

    try {
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      const decoded = await requireAuth(req as any);
      assertIsAdmin(decoded);

      const body = (req as any).body || {};

      const tenantSchema = normStr(body.tenantSchema, 120);

      // חובה: refreshToken כדי "לרענן" חיבור
      const refreshToken = normStr(body.refreshToken, 8000);

      // מומלץ מאוד: senderEmail (מאיזה מייל שולחים)
      const senderEmail = normStr(body.senderEmail, 200);

      // אופציונלי: אם לא שולחים — נשמור הקיים
      const gmailClientIdInput = normStr(body.gmailClientId, 400);
      const gmailClientSecretInput = normStr(body.gmailClientSecret, 8000);

      const redirectUri = normStr(body.redirectUri, 800);

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!refreshToken) return void res.status(400).json({ error: 'Missing refreshToken' });

      if (senderEmail && !looksLikeEmail(senderEmail)) {
        return void res.status(400).json({ error: 'Invalid senderEmail' });
      }

      const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
      if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

      const sbPublic = getSupabasePublic();

      // אם לא נשלח clientId/secret – נשתמש בקיים (אם יש)
      let existing: GmailIdentRow | null = null;

      const { data: ex, error: exErr } = await sbPublic
        .from('gmail_identities')
        .select(`
          tenant_schema,
          sender_email,
          gmail_client_id,
          gmail_client_secret_enc,
          gmail_client_secret_iv,
          gmail_client_secret_tag,
          gmail_refresh_token_enc,
          gmail_refresh_token_iv,
          gmail_refresh_token_tag,
          redirect_uri
        `)
        .eq('tenant_schema', tenantSchema)
        .maybeSingle();

      if (exErr) throw new Error(`gmail_identities query failed: ${exErr.message}`);
      if (ex) existing = ex as GmailIdentRow;

      const gmailClientId =
        gmailClientIdInput || existing?.gmail_client_id || '';
      const gmailClientSecret =
        gmailClientSecretInput || ''; // אם לא הוזן, נשאיר מוצפן קיים

      if (!gmailClientId) {
        return void res.status(400).json({ error: 'Missing gmailClientId (no existing value found)' });
      }

      // encrypt refresh token
      const encRt = encryptRefreshToken(refreshToken, masterKey);

      // client secret: אם סופק חדש → להצפין; אחרת לשמור הקיים
      let secretEnc = existing?.gmail_client_secret_enc || '';
      let secretIv = existing?.gmail_client_secret_iv || '';
      let secretTag = existing?.gmail_client_secret_tag || '';

      if (gmailClientSecret) {
        const encSecret = encryptRefreshToken(gmailClientSecret, masterKey);
        secretEnc = encSecret.encBase64;
        secretIv = encSecret.ivBase64;
        secretTag = encSecret.tagBase64;
      }

      if (!secretEnc || !secretIv || !secretTag) {
        return void res.status(400).json({
          error: 'Missing gmailClientSecret (no existing encrypted secret found)',
        });
      }

      const patch: any = {
        tenant_schema: tenantSchema,

        sender_email: senderEmail || existing?.sender_email || null,

        gmail_client_id: gmailClientId,
        gmail_client_secret_enc: secretEnc,
        gmail_client_secret_iv: secretIv,
        gmail_client_secret_tag: secretTag,

        gmail_refresh_token_enc: encRt.encBase64,
        gmail_refresh_token_iv: encRt.ivBase64,
        gmail_refresh_token_tag: encRt.tagBase64,

        redirect_uri: redirectUri || existing?.redirect_uri || null,
        updated_at: new Date().toISOString(),
      };

      // שומר גם sender_email חובה מעשית לשליחה — אם עדיין אין:
      if (!patch.sender_email || !looksLikeEmail(String(patch.sender_email))) {
        return void res.status(400).json({ error: 'senderEmail is required (or existing sender_email must exist)' });
      }

      const { error: upErr } = await sbPublic
        .from('gmail_identities')
        .upsert(patch, { onConflict: 'tenant_schema' });

      if (upErr) throw new Error(`gmail_identities upsert failed: ${upErr.message}`);

      return void res.status(200).json({
        ok: true,
        tenantSchema,
        updated: true,
        identityUpdated: true,
        usedExistingClientSecret: !gmailClientSecret,
        usedExistingClientId: !gmailClientIdInput,
      });
    } catch (e: any) {
      console.error('connectGmailForFarm error', e);
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

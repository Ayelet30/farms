import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { encryptRefreshToken } from './crypto-gmail';

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

function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');

  return createClient(url, key, {
    db: { schema: schema || 'public' },
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
type ResLike = { setHeader: (k: string, v: string) => void; status: (c: number) => any; end: () => void };

function applyCors(req: ReqLike, res: ResLike): boolean {
  const origin = String(req.headers.origin || '');

  // תמיד Vary כדי לא להיתקע עם cache
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

export const connectGmailForFarm = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, GMAIL_MASTER_KEY_S],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    // ✅ CORS תמיד ראשון
    if (applyCors(req as any, res as any)) return;

    try {
      if (req.method !== 'POST') return void res.status(405).json({ error: 'Method not allowed' });

      const decoded = await requireAuth(req as any);
      assertIsAdmin(decoded);

      const body = (req as any).body || {};
      const tenantSchema = normStr(body.tenantSchema, 120);
      const refreshToken = normStr(body.refreshToken, 5000);
      const senderEmail = normStr(body.senderEmail, 200);

      if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
      if (!refreshToken) return void res.status(400).json({ error: 'Missing refreshToken' });
      if (senderEmail && !looksLikeEmail(senderEmail)) {
        return void res.status(400).json({ error: 'Invalid senderEmail' });
      }

      const masterKey = envOrSecret(GMAIL_MASTER_KEY_S, 'GMAIL_MASTER_KEY');
      if (!masterKey) throw new Error('Missing GMAIL_MASTER_KEY');

      const enc = encryptRefreshToken(refreshToken, masterKey);
      const sbTenant = getSupabaseForTenant(tenantSchema);

      const { data: current, error: qErr } = await sbTenant
        .from('farm_settings')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (qErr) throw new Error(`farm_settings query failed: ${qErr.message}`);
      if (!current?.id) throw new Error('No farm_settings row found (need one row to update)');

      const patch: any = {
        gmail_refresh_token_enc: enc.encBase64,
        gmail_refresh_token_iv: enc.ivBase64,
        gmail_refresh_token_tag: enc.tagBase64,
        updated_at: new Date().toISOString(),
      };
      if (senderEmail) patch.main_mail = senderEmail;

      const { error: uErr } = await sbTenant.from('farm_settings').update(patch).eq('id', current.id);
      if (uErr) throw new Error(`farm_settings update failed: ${uErr.message}`);

      return void res.status(200).json({ ok: true, tenantSchema, updated: true });
    } catch (e: any) {
      console.error('connectGmailForFarm error', e);
      // ✅ חשוב: לא לשבור CORS, הכותרות כבר הוגדרו
      return void res.status(500).json({ error: 'Internal error', message: e?.message || String(e) });
    }
  }
);

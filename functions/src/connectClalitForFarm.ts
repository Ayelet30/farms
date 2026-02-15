import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

if (!admin.apps.length) admin.initializeApp();

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const INTEGRATIONS_MASTER_KEY = defineSecret('INTEGRATIONS_MASTER_KEY');

function supabaseForSchema(schema: string) {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
    db: { schema },
    auth: { persistSession: false },
  });
}

async function requireAuth(req: any) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Bearer token');
  return admin.auth().verifyIdToken(m[1]);
}

function assertIsAdmin(decoded: any) {
  const allowed = new Set(['ayelethury@gmail.com']);
  if (!allowed.has(decoded?.email)) throw new HttpsError('permission-denied', 'Admin only');
}

function getMasterKey(): Buffer {
  const b = Buffer.from(INTEGRATIONS_MASTER_KEY.value(), 'base64');
  if (b.length !== 32) throw new Error('MASTER_KEY must be 32 bytes (base64)');
  return b;
}

function encryptGcm(val: string) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(val, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, data: enc };
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

function bufToByteaHex(b: Buffer) {
  return `\\x${b.toString('hex')}`; // חשוב: \\x כדי שב-JSON יישלח \x
}


export const connectClalitForFarm = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY, INTEGRATIONS_MASTER_KEY],
    timeoutSeconds: 60,
  },
  async (req, res): Promise<void> => {
    if (applyCors(req as any, res as any)) return;
    try {
      if (req.method !== 'POST') {
        return void res.status(405).json({ error: 'POST only' });
      }

      const decoded = await requireAuth(req);
      assertIsAdmin(decoded);

      const body = req.body || {};
      const schema = String(body.schema || '').trim();

      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      const supplierId = String(body.supplierId || '').trim();
      const endpoint = String(body.endpoint || '').trim();

      if (!schema) return void res.status(400).json({ error: 'Missing schema' });
      if (!username) return void res.status(400).json({ error: 'Missing username' });
      if (!password) return void res.status(400).json({ error: 'Missing password' });
      if (!supplierId) return void res.status(400).json({ error: 'Missing supplierId' });
      if (!endpoint) return void res.status(400).json({ error: 'Missing endpoint' });

      const sb = supabaseForSchema(schema);

      const entries: Array<[string, string]> = [
        ['USERNAME', username],
        ['PASSWORD', password],
        ['SUPPLIER_ID', supplierId],
        ['ENDPOINT', endpoint],
      ];

      for (const [keyName, value] of entries) {
        const enc = encryptGcm(value);

      const { error } = await sb.rpc('upsert_integration_secret', {
        p_provider: 'CLALIT',
        p_key_name: keyName,
        p_enc_iv: bufToByteaHex(enc.iv),
        p_enc_tag: bufToByteaHex(enc.tag),
        p_enc_data: bufToByteaHex(enc.data),
        p_note: null,
      });


        if (error) {
          return void res.status(500).json({ error: `DB rpc failed: ${error.message}` });
        }
      }

      return void res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error('connectClalitForFarm error', e);
      return void res.status(500).json({
        error: 'Internal error',
        message: e?.message || String(e),
      });
    }
  }
);

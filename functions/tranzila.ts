// functions/src/index.ts
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

// ===== Global options =====
setGlobalOptions({
  region: 'us-central1',
});

// ===== Local env for emulator only =====
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const TRANZILA_SUPPLIER_S = defineSecret('TRANZILA_SUPPLIER');
const TRANZILA_PASSWORD_S = defineSecret('TRANZILA_PASSWORD');
const PUBLIC_BASE_URL_S = defineSecret('PUBLIC_BASE_URL');
const TRANZILA_APP_KEY_S = defineSecret('TRANZILA_APP_KEY');
const TRANZILA_SECRET_S = defineSecret('TRANZILA_SECRET');
const TRANZILA_TERMINAL_NAME_S = defineSecret('TRANZILA_TERMINAL_NAME');
const TRANZILA_PW_S = defineSecret('TRANZILA_PW');


// Helper: prefer secret at runtime (Cloud), else process.env (local)
const envOrSecret = (s: ReturnType<typeof defineSecret>, name: string) =>
  s.value() || process.env[name];

// ===== Supabase client factory (per-request) =====
function getSupabase(): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

// ===== Utils =====
function toTranzilaCurrency(code?: string): string {
  if (!code || code.toUpperCase() === 'ILS') return '1'; // ILS = 1
  return '1';
}

function withMaybeFarm<T extends Record<string, any>>(base: T, farmId?: string) {
  return farmId ? { ...base, farm_id: farmId } : base;
}

function buildUrl(baseRaw: string, path: string) {
  const base = /^https?:\/\//i.test(baseRaw.trim())
    ? baseRaw.trim()
    : `https://${baseRaw.trim()}`;
  const p =
    typeof path === 'string' && path.trim().startsWith('/')
      ? path.trim()
      : '/';
  return new URL(p, base).toString();
}

/** Common CORS / OPTIONS handler */
function handleCors(req: any, res: any): boolean {
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.status(204).send('');
    return true;
  }
  res.set('Access-Control-Allow-Origin', '*');
  return false;
}

// ===================================================================
// createHostedPaymentUrl (HPP ל-tokenization חיצוני)
// ===================================================================
export const createHostedPaymentUrl = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, TRANZILA_SUPPLIER_S, TRANZILA_PASSWORD_S, PUBLIC_BASE_URL_S],
  },
  async (req, res): Promise<void> => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const {
        uid,
        email,
        farmId,
        amountAgorot,
        orderId,
        successPath,
        failPath,
      } = req.body as {
        uid: string;
        email: string;
        farmId?: string;
        amountAgorot: number;
        orderId: string;
        successPath?: string;
        failPath?: string;
      };

      if (!uid || !email || !orderId || amountAgorot == null) {
        res
          .status(400)
          .json({ error: 'missing fields (uid/email/orderId/amountAgorot)' });
        return;
      }
      const amount = Number(amountAgorot);
      if (!Number.isFinite(amount) || amount < 0) {
        res
          .status(400)
          .json({ error: 'amountAgorot must be a non-negative number' });
        return;
      }

      const supplier =
        envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
        process.env.TRANZILA_SUPPLIER_ID;
      const baseRaw = envOrSecret(PUBLIC_BASE_URL_S, 'PUBLIC_BASE_URL');
      if (!supplier) {
        res.status(500).json({ error: 'Missing TRANZILA_SUPPLIER(_ID)' });
        return;
      }
      if (!baseRaw) {
        res.status(500).json({ error: 'Missing PUBLIC_BASE_URL' });
        return;
      }

      const successUrl = buildUrl(baseRaw, successPath ?? '/billing/success');
      const errorUrl = buildUrl(baseRaw, failPath ?? '/billing/error');
      const sumNis = (amount / 100).toFixed(2);

      const hpp = new URL(
        `https://direct.tranzila.com/${supplier}/tranDirect.asp`,
      );
      const params = new URLSearchParams({
        supplier,
        sum: sumNis,
        currency: '1',
        orderid: String(orderId),
        contact: email,
        email,
        cred_type: '1', // tokenize
        tranmode: 'AK',
        success_url: successUrl,
        error_url: errorUrl,
        custom_uid: uid,
        ...(farmId ? { custom_farm: farmId } : {}),
      });
      hpp.search = params.toString();

      res.json({ url: hpp.toString() });
      return;
    } catch (e: any) {
      console.error('[createHostedPaymentUrl] error:', e);
      res
        .status(500)
        .json({ error: e?.message ?? 'internal error' });
    }
  },
);

// ===================================================================
// tranzilaReturn – קבלת הטוקן מחזרת HPP
// ===================================================================
export const tranzilaReturn = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, TRANZILA_SUPPLIER_S, TRANZILA_PASSWORD_S, PUBLIC_BASE_URL_S],
  },
  async (req, res): Promise<void> => {
    const sb = getSupabase();
    try {
      if (handleCors(req, res)) return;

      const { orderid, custom_uid, custom_farm } =
        req.query as Record<string, string | undefined>;
      if (!orderid || !custom_uid) {
        res.status(400).send('Missing orderid/custom_uid');
        return;
      }

      const supplier =
        envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
        process.env.TRANZILA_SUPPLIER_ID;
      const password = envOrSecret(TRANZILA_PASSWORD_S, 'TRANZILA_PASSWORD');
      const appBase = envOrSecret(PUBLIC_BASE_URL_S, 'PUBLIC_BASE_URL');
      if (!supplier || !password || !appBase) {
        res
          .status(500)
          .send('Missing TRANZILA_SUPPLIER/PASSWORD or PUBLIC_BASE_URL');
        return;
      }

      const qUrl = new URL(
        'https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi',
      );
      const qParams = new URLSearchParams({
        supplier,
        password,
        tranmode: 'Q',
        orderid: String(orderid),
      });
      const r = await fetch(qUrl.toString(), { method: 'POST', body: qParams });
      const text = await r.text();

      const kv: Record<string, string> = Object.fromEntries(
        text.split('&').map((p) => {
          const [k, v] = p.split('=');
          return [k, v ?? ''];
        }),
      );

      const token = kv['TranzilaTK'];
      const last4 = kv['ccno']?.slice(-4) ?? null;
      const brand = kv['cardtype'] ?? null;

      if (!token) {
        console.error('[tranzilaReturn] no token in response:', text);
        res.status(400).send('Token not found');
        return;
      }

      const parentUid = String(custom_uid);
      const farmId = custom_farm ? String(custom_farm) : undefined;

      const insertObj = withMaybeFarm(
        {
          parent_uid: parentUid,
          tranzila_token: token,
          tranzila_supplier: supplier,
          last4,
          brand,
          active: true,
        },
        farmId,
      );

      const { error: insErr } = await sb
        .from('payment_profiles')
        .insert(insertObj as any);
      if (insErr) console.error('[tranzilaReturn] insert error:', insErr);

      const successUrl = buildUrl(
        appBase,
        `/billing/success?orderid=${encodeURIComponent(String(orderid))}`,
      );
      res.redirect(302, successUrl);
    } catch (e: any) {
      console.error('[tranzilaReturn] error:', e);
      res.status(500).send('Failed to capture token');
    }
  },
);

// ===================================================================
// chargeByToken – חיוב לפי טוקן ששמור ב-DB
// ===================================================================
export const chargeByToken = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, TRANZILA_SUPPLIER_S, TRANZILA_PASSWORD_S],
  },
  async (req, res): Promise<void> => {
    const sb = getSupabase();
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { parentUid, amountAgorot, currency, farmId } = req.body as {
        parentUid: string;
        amountAgorot: number;
        currency?: string;
        farmId?: string;
      };

      if (!parentUid || amountAgorot == null) {
        res
          .status(400)
          .json({ error: 'missing fields (parentUid/amountAgorot)' });
        return;
      }

      const q = sb
        .from('payment_profiles')
        .select('*')
        .eq('parent_uid', parentUid)
        .eq('active', true)
        .limit(1);
      if (farmId) q.eq('farm_id', farmId);
      const { data: profiles, error } = await q;
      if (error) {
        console.error('[chargeByToken] profile query error:', error);
        res.status(500).json({ error: 'profile query failed' });
        return;
      }
      if (!profiles?.length) {
        res.status(404).json({ error: 'No active token' });
        return;
      }

      const { tranzila_token, tranzila_supplier } = profiles[0] as any;

      const supplier = String(
        tranzila_supplier ||
          envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
          process.env.TRANZILA_SUPPLIER_ID ||
          '',
      );
      const password = envOrSecret(TRANZILA_PASSWORD_S, 'TRANZILA_PASSWORD');
      if (!supplier || !password) {
        res
          .status(500)
          .json({ error: 'Missing TRANZILA_SUPPLIER/PASSWORD' });
        return;
      }

      const sum = (Number(amountAgorot) / 100).toFixed(2);
      const tranzilaCurrency = toTranzilaCurrency(currency);

      const url = new URL(
        'https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi',
      );
      const body = new URLSearchParams({
        supplier,
        password,
        sum,
        currency: tranzilaCurrency,
        tranmode: 'V',
        cred_type: '8',
        TranzilaTK: String(tranzila_token),
      });

      const resp = await fetch(url.toString(), { method: 'POST', body });
      const text = await resp.text();
      const kv: Record<string, string> = Object.fromEntries(
        text.split('&').map((p) => {
          const [k, v] = p.split('=');
          return [k, v ?? ''];
        }),
      );

      const success = kv['Response'] === '000';
      const providerId =
        kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

      const chargeInsert = withMaybeFarm(
        {
          subscription_id: null,
          parent_uid: parentUid,
          amount_agorot: amountAgorot,
          currency: (currency ?? 'ILS').toUpperCase(),
          provider_id: providerId,
          status: success ? 'succeeded' : 'failed',
          error_message: success ? null : text,
        },
        farmId,
      );

      await sb.from('charges').insert(chargeInsert as any);

      res.json({ ok: success, providerRaw: kv });
    } catch (e: any) {
      console.error('[chargeByToken] error:', e);
      res
        .status(500)
        .json({ error: e?.message ?? 'internal error' });
    }
  },
);

// ===================================================================
// cronMonthlyCharges – חיובים חודשיים אוטומטיים
// ===================================================================
export const cronMonthlyCharges = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Etc/UTC',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, TRANZILA_SUPPLIER_S, TRANZILA_PASSWORD_S],
  },
  async () => {
    const sb = getSupabase();
    try {
      const now = new Date().toISOString();
      const { data: due, error } = await sb
        .from('subscriptions')
        .select('*')
        .eq('active', true)
        .lte('next_charge_at', now);

      if (error) {
        console.error('[cronMonthlyCharges] select error:', error);
        return;
      }
      if (!due?.length) {
        console.log('[cronMonthlyCharges] nothing due');
        return;
      }

      for (const sub of due) {
        try {
          const {
            parent_uid,
            amount_agorot,
            currency,
            id,
            interval_months,
            farm_id,
          } = sub as any;

          const q = sb
            .from('payment_profiles')
            .select('*')
            .eq('parent_uid', parent_uid)
            .eq('active', true)
            .limit(1);
          if (farm_id) q.eq('farm_id', farm_id);
          const { data: profiles } = await q;
          if (!profiles?.length) {
            console.warn(
              `[cronMonthlyCharges] no token for uid=${parent_uid} farm=${
                farm_id ?? '-'
              }`,
            );
            continue;
          }

          const { tranzila_token, tranzila_supplier } = profiles[0] as any;
          const supplier = String(
            tranzila_supplier ||
              envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
              process.env.TRANZILA_SUPPLIER_ID ||
              '',
          );
          const password = envOrSecret(
            TRANZILA_PASSWORD_S,
            'TRANZILA_PASSWORD',
          );
          const sum = (Number(amount_agorot) / 100).toFixed(2);
          const tranzilaCurrency = toTranzilaCurrency(currency);

          const url = new URL(
            'https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi',
          );
          const body = new URLSearchParams();
          body.set('supplier', supplier);
          body.set('password', password!);
          body.set('sum', sum);
          body.set('currency', tranzilaCurrency);
          body.set('tranmode', 'V');
          body.set('cred_type', '8');
          body.set('TranzilaTK', String(tranzila_token));

          const resp = await fetch(url.toString(), { method: 'POST', body });
          const text = await resp.text();
          const kv: Record<string, string> = Object.fromEntries(
            text.split('&').map((p) => {
              const [k, v] = p.split('=');
              return [k, v ?? ''];
            }),
          );

          const success = kv['Response'] === '000';
          const providerId =
            kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

          const insertCharge = withMaybeFarm(
            {
              subscription_id: id,
              parent_uid,
              amount_agorot: amount_agorot,
              currency: (currency ?? 'ILS').toUpperCase(),
              provider_id: providerId,
              status: success ? 'succeeded' : 'failed',
              error_message: success ? null : text,
            },
            farm_id,
          );

          await sb.from('charges').insert(insertCharge as any);

          const next = new Date();
          next.setMonth(next.getMonth() + (interval_months ?? 1));
          await sb
            .from('subscriptions')
            .update({ next_charge_at: next.toISOString() })
            .eq('id', id);
        } catch (inner) {
          console.error('[cronMonthlyCharges] single sub error:', inner);
        }
      }

      console.log('[cronMonthlyCharges] processed:', due.length);
    } catch (e: any) {
      console.error('[cronMonthlyCharges] error:', e);
    }
  },
);

// ===================================================================
// Helper משותף ל-API v2 (standing order + handshake Hosted Fields)
// ===================================================================
function buildTranzilaAuth() {
  const appKey = envOrSecret(TRANZILA_APP_KEY_S, 'TRANZILA_APP_KEY');
  const secret = envOrSecret(TRANZILA_SECRET_S, 'TRANZILA_SECRET');
  if (!appKey || !secret) throw new Error('Missing Tranzila API keys');

  const requestTime = Date.now().toString();
  const nonce = crypto.randomBytes(20).toString('hex'); // 40 hex

  const message = `${secret}${requestTime}${nonce}`;
  const accessToken = crypto
    .createHmac('sha256', appKey)
    .update(message)
    .digest('base64');

  return { appKey, requestTime, nonce, accessToken };
}

// ===================================================================
// createTranzilaStandingOrder – יצירת הוראת קבע ב-API v2
// ===================================================================
export const createTranzilaStandingOrder = onRequest(
  {
    invoker: 'public',
    secrets: [TRANZILA_APP_KEY_S, TRANZILA_SECRET_S],
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const bodyFromClient = req.body as any;
      console.log(
        '[createTranzilaStandingOrder] incoming body:',
        bodyFromClient,
      );

      const { appKey, requestTime, nonce, accessToken } = buildTranzilaAuth();
      const apiUrl = 'https://api.tranzila.com/v2/sto/create';

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-tranzila-api-app-key': appKey,
          'X-tranzila-api-request-time': requestTime,
          'X-tranzila-api-nonce': nonce,
          'X-tranzila-api-access-token': accessToken,
        },
        body: JSON.stringify(bodyFromClient),
      });

      const text = await resp.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      console.log(
        '[createTranzilaStandingOrder] status =',
        resp.status,
        'body =',
        text,
      );

      if (!resp.ok) {
        res.status(resp.status).json({
          ok: false,
          error: 'Tranzila API error',
          status: resp.status,
          body: json ?? text,
        });
        return;
      }

      res.json({
        ok: true,
        tranzila: json ?? text,
      });
    } catch (e: any) {
      console.error('[createTranzilaStandingOrder] error:', e);
      res
        .status(500)
        .json({ ok: false, error: e?.message ?? 'internal error' });
    }
  },
);

// ===================================================================
// tranzilaHandshakeHttp – Handshake v1 שמחזיר thtk ל-Hosted Fields
// ===================================================================
export const tranzilaHandshakeHttp = onRequest(
  {
    invoker: 'public',
    secrets: [TRANZILA_TERMINAL_NAME_S, TRANZILA_PASSWORD_S, TRANZILA_PW_S],
  },
  async (req, res): Promise<void> => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'GET') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const supplier =
        envOrSecret(TRANZILA_TERMINAL_NAME_S, 'TRANZILA_TERMINAL_NAME') ||
        process.env.TRANZILA_TERMINAL_NAME;
      const password = envOrSecret(TRANZILA_PW_S, 'TRANZILA_PW');

      console.log('[tranzilaHandshakeHttp] supplier=', supplier);
      console.log('[tranzilaHandshakeHttp] password=', password);


      if (!supplier || !password) {
        res
          .status(500)
          .json({ ok: false, error: 'Missing TRANZILA_SUPPLIER/PASSWORD' });
        return;
      }

      // סכום לבדיקה – אפשר 1 (ש"ח אחד) או מה שתבחרי
      const sum = '1';

      const url = new URL('https://api.tranzila.com/v1/handshake/create');
      url.searchParams.set('supplier', supplier);
      url.searchParams.set('sum', sum);
      url.searchParams.set('TranzilaPW', password);

      console.log('[tranzilaHandshakeHttp] calling', url.toString());

      const resp = await fetch(url.toString(), { method: 'GET' });
      const text = await resp.text();

      console.log(
        '[tranzilaHandshakeHttp] status =',
        resp.status,
        'body =',
        text,
      );

      // התשובה מגיעה כ-query string, למשל:
      // "thtk=XXXX&Response=000&..."
      const kv: Record<string, string> = Object.fromEntries(
        text.split('&').map((p) => {
          const [k, v] = p.split('=');
          return [k, v ?? ''];
        }),
      );

      const thtk = kv['thtk'];

      if (!resp.ok || !thtk) {
        res.status(resp.status || 500).json({
          ok: false,
          error: 'Failed to get thtk from Tranzila',
          body: kv,
        });
        return;
      }

      // מה שאנחנו צריכים ל-Hosted Fields בצד ה-Client
      res.json({ thtk });
    } catch (err: any) {
      console.error('[tranzilaHandshakeHttp] error:', err);
      res
        .status(500)
        .json({ ok: false, error: err?.message || 'internal error' });
    }
  },
);

type RecordPaymentArgs = {
  sb: SupabaseClient;
  tenantSchema: string;                 // ← שם הסכימה: bereshit_farm וכו'
  parentUid?: string | null;
  amountAgorot: number;
  currency?: string;
  method: 'one_time' | 'subscription';
  tx: {
    transaction_id?: string;
    amount?: string;
    token?: string;
    card_type_name?: string;
    credit_card_last_4_digits?: string;
  };
  subscriptionId?: string | null;
};

async function recordPaymentInDb(args: RecordPaymentArgs) {
  const {
    sb,
    tenantSchema,
    parentUid,
    amountAgorot,
    currency,
    method,
    tx,
    subscriptionId,
  } = args;

  const amountNis = Number(amountAgorot) / 100;
  const today = new Date().toISOString().slice(0, 10);

  // לעבוד ישירות על סכימת החווה
  const sbTenant = sb.schema(tenantSchema);

  // 1) payments – בלי farm_id, כי הטבלה כבר בתוך הסכימה של החווה
  const paymentRow = {
    parent_uid: parentUid ?? null,   // באנונימי זה יכול להיות null
    amount: amountNis,
    date: today,
    method,
    invoice_url: null,
  };

  const { error: payErr } = await sbTenant
    .from('payments')
    .insert(paymentRow as any);

  if (payErr) {
    console.error('[recordPaymentInDb] payments insert error:', payErr);
    throw new Error('failed to insert into payments');
  }

  // 2) payment_profiles – גם הם בתוך סכימת החווה
  if (tx.token) {
    const profileRow = {
      parent_uid: parentUid ?? null,
      brand: tx.card_type_name ?? null,
      last4: tx.credit_card_last_4_digits ?? null,
      token_ref: tx.token,
      active: true,
      is_default: true,
    };

    const { error: profErr } = await sbTenant
      .from('payment_profiles')
      .insert(profileRow as any);

    if (profErr) {
      console.error('[recordPaymentInDb] payment_profiles insert error:', profErr);
    }
  }

  // 3) אם זה מנוי – וגם טבלת charges היא בתוך סכימת החווה
  if (subscriptionId) {
    const chargeRow = {
      subscription_id: subscriptionId,
      parent_uid: parentUid ?? null,
      amount_agorot: amountAgorot,
      currency: (currency ?? 'ILS').toUpperCase(),
      provider_id: tx.transaction_id ?? null,
      status: 'succeeded',
      error_message: null,
    };

    const { error: chargeErr } = await sbTenant
      .from('charges')
      .insert(chargeRow as any);

    if (chargeErr) {
      console.error('[recordPaymentInDb] charges insert error:', chargeErr);
    }
  }
}


export const recordOneTimePayment = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (req, res): Promise<void> => {
    const sb = getSupabase();
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { parentUid, tenantSchema, amountAgorot, tx } = req.body as {
        parentUid?: string | null;
        tenantSchema: string;
        amountAgorot: number;
        tx: any;
      };

      if (!tenantSchema || amountAgorot == null || !tx) {
        res.status(400).json({
          ok: false,
          error: 'missing tenantSchema/amountAgorot/tx',
        });
        return;
      }

      await recordPaymentInDb({
        sb,
        tenantSchema,
        parentUid: parentUid ?? null,
        amountAgorot,
        currency: 'ILS',
        method: 'one_time',
        tx,
        subscriptionId: null,
      });

      res.json({ ok: true });
    } catch (e: any) {
      console.error('[recordOneTimePayment] error:', e);
      res
        .status(500)
        .json({ ok: false, error: e?.message ?? 'internal error' });
    }
  },
);







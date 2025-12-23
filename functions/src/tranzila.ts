// functions/src/index.ts
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

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

const mailTransport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, 
  auth: {
    user: "ayelethury@gmail.com", 
    pass: "jlmb ezch pkrs ifce",
  }  ,
});


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

export function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');

  return createClient(url, key, {
    db: { schema: schema || 'public' },
  }) as SupabaseClient;
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
      const tenantSchema = req.body.tenantSchema || null;
      const sumNis = (amount / 100).toFixed(2);

      const hpp = new URL(
        `https://direct.tranzila.com/${supplier}/tranDirect.asp`,
      );
      const params = new URLSearchParams({
      supplier,
      sum: sumNis,
      currency: '1',
      orderid: String(orderId),

      tranmode: 'AK',
      cred_type: '1',          // tokenization

      contact: email,
      email,

      success_url: successUrl,
      error_url: errorUrl,

      custom_uid: uid,
      custom_schema: tenantSchema,
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
  async (req, res) => {
    try {
      if (handleCors(req, res)) return;

      const { orderid, custom_uid, custom_schema } =
        req.query as Record<string, string | undefined>;

      if (!orderid || !custom_uid || !custom_schema) {
        res.status(400).send('Missing orderid/custom_uid/custom_schema');
        return;
      }

      const supplier =
        envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
        process.env.TRANZILA_SUPPLIER_ID;
      const password = envOrSecret(TRANZILA_PASSWORD_S, 'TRANZILA_PASSWORD');
      const appBase = envOrSecret(PUBLIC_BASE_URL_S, 'PUBLIC_BASE_URL');

      if (!supplier || !password || !appBase) {
        res.status(500).send('Missing supplier/password/public base');
        return;
      }

      // 1) Query לטרנזילה לקבלת הטוקן
      const qUrl = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
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
        console.error('[tranzilaReturn] token missing. raw=', text);
        res.status(400).send('Token not found');
        return;
      }

      const schema = String(custom_schema);
      const parentUid = String(custom_uid);

      const sbTenant = getSupabaseForTenant(schema);

      // 2) האם כבר יש default פעיל?
      const { data: existingDefault, error: defErr } = await sbTenant
        .from('payment_profiles')
        .select('id')
        .eq('parent_uid', parentUid)
        .eq('active', true)
        .eq('is_default', true)
        .limit(1);

      if (defErr) {
        console.error('[tranzilaReturn] default query error:', defErr);
      }

      const shouldBeDefault = !(existingDefault?.length);

      // 3) שמירה
      const { error: insErr } = await sbTenant.from('payment_profiles').insert({
        parent_uid: parentUid,
        token_ref: String(token),
        last4,
        brand,
        active: true,
        is_default: shouldBeDefault,
      });

      if (insErr) {
        console.error('[tranzilaReturn] insert error:', insErr);
        res.status(500).send('Failed to save token');
        return;
      }

      // 4) Redirect חזרה
      res.redirect(302, buildUrl(appBase, '/billing/success'));
    } catch (e: any) {
      console.error('[tranzilaReturn] error:', e);
      res.status(500).send('Failed');
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
  async (req, res) => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }


      const { tenantSchema, chargeId } = req.body as { tenantSchema: string; chargeId: string };
      if (!tenantSchema || !chargeId) {
        res.status(400).json({ ok: false, error: 'missing tenantSchema/chargeId' });
        return;
      }

      const sb = getSupabaseForTenant(tenantSchema);

      // 1) שליפת החיוב
      const { data: ch, error: chErr } = await sb
        .from('charges')
        .select('id,parent_uid,amount_agorot,currency,status,billing_month,description')
        .eq('id', chargeId)
        .single();

      if (chErr || !ch){
         res.status(404).json({ ok: false, error: 'charge not found' });
         return;
      }

      // (לא חובה אבל מומלץ) לא לסלוק אם כבר succeeded
      if (String(ch.status) === 'succeeded') {
        res.json({ ok: true, skipped: true, reason: 'already_succeeded' });
        return;
      }

      // 2) פרופיל ברירת מחדל פעיל
      const { data: prof, error: pErr } = await sb
        .from('payment_profiles')
        .select('id,token_ref')
        .eq('parent_uid', ch.parent_uid)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pErr || !prof?.token_ref) {
        // עדכון סטטוס “failed” או “no_token” לבחירתך
        await sb.from('charges').update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        }).eq('id', chargeId);

        res.status(404).json({ ok: false, error: 'no active token' });
        return;
      }

      // 3) סליקה מול טרנזילה
      const supplier =
        envOrSecret(TRANZILA_SUPPLIER_S, 'TRANZILA_SUPPLIER') ||
        process.env.TRANZILA_SUPPLIER_ID;
      const password = envOrSecret(TRANZILA_PASSWORD_S, 'TRANZILA_PASSWORD');

      if (!supplier || !password) {
        res.status(500).json({ ok: false, error: 'Missing supplier/password' });
        return;
      }

      const sum = (Number(ch.amount_agorot) / 100).toFixed(2);
      const url = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');

      const body = new URLSearchParams({
        supplier: String(supplier),
        password: String(password),
        sum,
        currency: '1',        // ILS
        tranmode: 'V',
        cred_type: '8',       // token
        TranzilaTK: String(prof.token_ref),
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
      const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

      // 4) עדכון שורת charge
      await sb.from('charges').update({
        status: success ? 'succeeded' : 'failed',
        provider_id: providerId,
        profile_id: prof.id,
        updated_at: new Date().toISOString(),
      }).eq('id', chargeId);

      res.json({ ok: success, provider_id: providerId, raw: kv });
      return;
    } catch (e: any) {
      console.error('[chargeByToken] error:', e);
      res.status(500).json({ ok: false, error: e?.message ?? 'internal error' });
    }
  },
);

export const savePaymentProfileFromTx = onRequest(
  { invoker: 'public', secrets: [SUPABASE_URL_S, SUPABASE_KEY_S] },
  async (req, res): Promise<void> => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const { tenantSchema, parentUid, tx } = req.body as {
        tenantSchema?: string | null;
        parentUid: string;
        tx: any;
      };

      if (!parentUid || !tx?.token) {
        res.status(400).json({ ok:false, error:'missing parentUid/tx.token' });
        return;
      }

      const sb = getSupabaseForTenant(tenantSchema);

      // האם יש default פעיל?
      const { data: existingDefault } = await sb
        .from('payment_profiles')
        .select('id')
        .eq('parent_uid', parentUid)
        .eq('active', true)
        .eq('is_default', true)
        .limit(1);

      const shouldBeDefault = !(existingDefault?.length);

      const last4 = tx.credit_card_last_4_digits ?? tx.last4 ?? null;
      const brand = tx.card_type_name ?? tx.brand ?? null;

      const { data: inserted, error } = await sb
        .from('payment_profiles')
        .insert({
          parent_uid: parentUid,
          token_ref: String(tx.token),
          last4,
          brand,
          active: true,
          is_default: shouldBeDefault,
        })
        .select('id')
        .single();

      if (error) { res.status(500).json({ ok:false, error:error.message }); return; }

      res.json({ ok:true, profileId: inserted.id });
    } catch (e:any) {
      console.error('[savePaymentProfileFromTx] error', e);
      res.status(500).json({ ok:false, error: e?.message ?? 'internal error' });
    }
  }
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
  tenantSchema: string;       // 👈 להוסיף
  parentUid: string | null;
  farmId?: string;
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

  const sbTenant = sb; // כי יצרת אותו כבר עם schema=tenantSchema ב-getSupabaseForTenant

  const paymentRow = {
    parent_uid: parentUid ?? null,
    amount: amountNis,
    date: today,
    method,
    invoice_url: null,
  };

  const { data: inserted, error: payErr } = await sbTenant
    .from('payments')
    .insert(paymentRow as any)
    .select('id')
    .single();

  if (payErr) {
    console.error('[recordPaymentInDb] payments insert error:', payErr);
    throw new Error(payErr.message);
  }

  const paymentId = inserted.id as string;

  // ... payment_profiles + charges כמו שכבר כתבת ...

  return paymentId; // 👈 מחזירים את המזהה
}




// ===================================================================
// recordOneTimePayment – רישום תשלום חד-פעמי ב-DB
// ===================================================================


export const recordOneTimePayment = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (req, res): Promise<void> => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { parentUid, tenantSchema, amountAgorot, tx, email, fullName } = req.body as {
        parentUid?: string | null;
        tenantSchema?: string | null;
        amountAgorot: number;
        tx: any;
        email?: string | null;
        fullName?: string | null;
      };

      if (amountAgorot == null || !tx) {
        res.status(400).json({ ok: false, error: 'missing amountAgorot/tx' });
        return;
      }

      console.log('[recordOneTimePayment] body =', {
        parentUid,
        tenantSchema,
        amountAgorot,
        hasTx: !!tx,
        email,
        fullName,
      });

      const sb = getSupabaseForTenant(tenantSchema);

      const paymentId = await recordPaymentInDb({
        sb,
        tenantSchema: tenantSchema || 'bereshit_farm',
        parentUid: parentUid ?? null,
        farmId: undefined,
        amountAgorot,
        currency: 'ILS',
        method: 'one_time',
        tx,
        subscriptionId: null,
      });

      // אחרי שהשורה נשמרה – מנפיקים קבלה ושולחים מייל
      if (email) {
        await generateAndSendReceipt({
          sb,
          tenantSchema,
          paymentId,
          email,
          fullName: fullName || null,
          amountAgorot,
          tx,
        });
      }

      res.json({ ok: true });
    } catch (e: any) {
      console.error('[recordOneTimePayment] error:', e);
      res.status(500).json({ ok: false, error: e?.message ?? 'internal error' });
    }
  },
);

async function generateAndSendReceipt(args: {
  sb: SupabaseClient;
  tenantSchema?: string | null;
  paymentId: string;
  email: string;
  fullName: string | null;
  amountAgorot: number;
  tx: any;
}) {
  const { sb, tenantSchema, paymentId, email, fullName, amountAgorot, tx } = args;

  const amountNis = (amountAgorot / 100).toFixed(2);
  const dateStr = new Date().toLocaleDateString('he-IL');

  // 1) יצירת PDF בזיכרון
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).text('קבלה על תשלום', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`תאריך: ${dateStr}`);
  doc.text(`מספר תשלום: ${paymentId}`);
  if (fullName) doc.text(`שם לקוח: ${fullName}`);
  doc.text(`אימייל: ${email}`);
  doc.moveDown();

  doc.text(`סכום: ${amountNis} ₪`);
  doc.text(`אמצעי תשלום: כרטיס אשראי`);
  if (tx?.transaction_id) {
    doc.text(`אסמכתא: ${tx.transaction_id}`);
  }
  if (tx?.credit_card_last_4_digits) {
    doc.text(`4 ספרות אחרונות: **** ${tx.credit_card_last_4_digits}`);
  }

  doc.end();
  const pdfBuffer = await pdfPromise;

  // 2) העלאה ל-Supabase Storage לבאקט: bereshit-payments-invoices
  const BUCKET_NAME = 'bereshit-payments-invoices';
  const filePath = `receipts/${tenantSchema || 'public'}/${paymentId}.pdf`;

  console.log('[generateAndSendReceipt] uploading to Supabase', {
    bucket: BUCKET_NAME,
    filePath,
  });

  const { error: uploadErr } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) {
    console.error('[generateAndSendReceipt] upload error:', uploadErr);
    throw new Error(uploadErr.message);
  }

  // 3) URL פומבי מהבאקט (כמו בקוד של instructor-image)
  const { data: publicData } = sb.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  const url = (publicData as any).publicUrl + '?v=' + Date.now();

  // 4) עדכון ה־URL ב-DB
  await sb
    .from('payments')
    .update({ invoice_url: url })
    .eq('id', paymentId);

  // 5) שליחת המייל עם הקבלה
  const subject = 'קבלה על תשלום';
  const html = `
    <div dir="rtl">
      <p>שלום ${fullName || ''},</p>
      <p>תודה על התשלום.</p>
      <p><strong>סכום:</strong> ${amountNis} ₪</p>
      <p><strong>תאריך:</strong> ${dateStr}</p>
      <p><strong>מספר תשלום:</strong> ${paymentId}</p>
      <p>מצורפת קבלה בקובץ PDF.</p>
    </div>
  `;

  await mailTransport.sendMail({
    to: email,
    from: '"חוות בראשית" <no-reply@smart-farm>',
    subject,
    html,
    attachments: [
      {
        filename: `receipt-${paymentId}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  console.log('[generateAndSendReceipt] receipt sent & url saved', {
    paymentId,
    url,
  });
}

export const savePaymentMethod = onRequest(
  {
    invoker: 'public',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (req, res): Promise<void> => {
    try {
      if (handleCors(req, res)) return;

      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { parentUid, tenantSchema, token, last4, brand, expiryMonth, expiryYear } = req.body as any;

      if (!tenantSchema || !parentUid || !token) {
        res.status(400).json({ ok: false, error: 'missing tenantSchema/parentUid/token' });
        return;
      }

      const sb = getSupabaseForTenant(String(tenantSchema));

      // האם כבר יש default פעיל?
      const { data: existingDefault, error: defErr } = await sb
        .from('payment_profiles')
        .select('id')
        .eq('parent_uid', String(parentUid))
        .eq('active', true)
        .eq('is_default', true)
        .limit(1);

      if (defErr) {
        console.error('[savePaymentMethod] default query error', defErr);
      }

      const shouldBeDefault = !(existingDefault?.length);

      const expMonth = normalizeExpiryMonth(expiryMonth);
    const expYear  = normalizeExpiryYear(expiryYear);

    const { error: insErr } = await sb
      .from('payment_profiles')
      .upsert(
        {
          parent_uid: String(parentUid),
          token_ref: String(token),
          last4: last4 ?? null,
          brand: brand ?? null,
          expiry_month: expMonth,
          expiry_year: expYear,
          active: true,
          is_default: shouldBeDefault,
        },
        { onConflict: 'parent_uid,token_ref' },
      );


      if (insErr) {
        console.error('[savePaymentMethod] upsert error', insErr);
        res.status(500).json({ ok: false, error: insErr.message });
        return;
      }

      res.json({ ok: true, is_default: shouldBeDefault });
      return;
    } catch (e: any) {
      console.error('[savePaymentMethod] error', e);
      res.status(500).json({ ok: false, error: e?.message ?? 'internal error' });
      return;
    }
  },
);

function normalizeExpiryYear(y: any): number | null {
  if (y === null || y === undefined || y === '') return null;
  const n = Number(y);
  if (!Number.isFinite(n)) return null;

  // כבר שנה מלאה
  if (n >= 1000) return n;

  // YY -> YYYY (נניח 2000-2099)
  if (n >= 0 && n <= 99) return 2000 + n;

  return null;
}

function normalizeExpiryMonth(m: any): number | null {
  if (m === null || m === undefined || m === '') return null;
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 12) return null;
  return n;
}

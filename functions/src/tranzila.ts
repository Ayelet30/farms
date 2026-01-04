// functions/src/index.ts
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

// ===== Local env for emulator only =====
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

// טרנזילה - שמות סודות (את הערכים עצמם מנהלים ב-Firebase Secrets)
const TRANZILA_PASSWORD_S = defineSecret('TRANZILA_PASSWORD'); // סיסמת מסוף רגיל
const TRANZILA_PASSWORD_TOKEN_S = defineSecret('TRANZILA_PASSWORD_TOKEN'); // סיסמת מסוף טוקנים

// אם את משתמשת גם ב-APP_KEY/SECRET לחתימה (לפי הקוד שהיה אצלך)
const TRANZILA_APP_KEY_S = defineSecret('TRANZILA_APP_KEY');
const TRANZILA_SECRET_S = defineSecret('TRANZILA_SECRET');

const TRANZILA_SUPPLIER_S = defineSecret('TRANZILA_SUPPLIER');
const PUBLIC_BASE_URL_S = defineSecret('PUBLIC_BASE_URL');
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

// ===== Supabase client factory (per tenant schema) =====
export function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing Supabase credentials');

  return createClient(url, key, {
    db: { schema: schema || 'public' },
  }) as SupabaseClient;
}

// ===================================================================
// Billing Terminals: load default terminal from DB
// ===================================================================
type BillingTerminalRow = {
  id: string;
  provider: string;              // 'tranzila'
  terminal_name: string;         // מסוף רגיל (ל-hosted/tokenize וכו')
  tok_terminal_name: string;     // מסוף טוקנים (לחיוב ע"י token)
  mode: string;                  // 'prod' / 'test'
  is_default: boolean;
  active: boolean;

  // בטבלה נשמר "שם הסוד" ולא הסיסמה עצמה
  secret_key_charge: string | null;        // לדוגמה: 'TRANZILA_PASSWORD'
  secret_key_charge_token: string | null;  // לדוגמה: 'TRANZILA_PASSWORD_TOKEN'
};

async function loadDefaultBillingTerminal(args: {
  sbTenant: SupabaseClient;
  provider?: string;        // 'tranzila'
  mode?: string;            // 'prod'
}): Promise<BillingTerminalRow> {
  const { sbTenant, provider = 'tranzila', mode = 'prod' } = args;

  const { data, error } = await sbTenant
    .from('billing_terminals')
    .select(
      'id,provider,terminal_name,tok_terminal_name,display_name,mode,is_default,active,secret_key_charge,secret_key_charge_token',
    )
    .eq('provider', provider)
    .eq('mode', mode)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`billing_terminals query failed: ${error.message}`);
  if (!data) throw new Error('No active billing terminal configured');

  return data as BillingTerminalRow;
}

// ===================================================================
// Resolve secret by "key name" stored in DB (NO passwords in DB)
// ===================================================================
function resolveTranzilaSecretByKeyName(keyName: string | null | undefined): string {
  const k = String(keyName ?? '').trim();
  if (!k) throw new Error('Missing secret key name in billing_terminals');

  // פה עושים מיפוי “שם סוד” -> secret בפועל
  switch (k) {
    case 'TRANZILA_PASSWORD': {
      const v = envOrSecret(TRANZILA_PASSWORD_S, 'TRANZILA_PASSWORD');
      if (!v) throw new Error('Missing secret: TRANZILA_PASSWORD');
      return v;
    }
    case 'TRANZILA_PASSWORD_TOKEN': {
      const v = envOrSecret(TRANZILA_PASSWORD_TOKEN_S, 'TRANZILA_PASSWORD_TOKEN');
      if (!v) throw new Error('Missing secret: TRANZILA_PASSWORD_TOKEN');
      return v;
    }
    default:
      throw new Error(`Unknown secret key name: ${k}`);
  }
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

// ===================================================================
// CORS helper
// ===================================================================
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
// chargeByToken – חיוב לפי טוקן ששמור ב-DB
// ===================================================================
// ===================================================================
// Charge by token (NEW endpoint): /v1/transaction/credit_card/create
// ===================================================================
function buildTranzilaAuthV2() {
  const appKey = envOrSecret(TRANZILA_APP_KEY_S, 'TRANZILA_APP_KEY');
  const secret = envOrSecret(TRANZILA_SECRET_S, 'TRANZILA_SECRET'); // זה ה-"secret" בדוגמה שלהם
  if (!appKey || !secret) throw new Error('Missing Tranzila API keys (APP_KEY/SECRET)');

  // לפי הדוגמה: timestamp בשניות
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // nonce קבוע 40 תווים. אפשר גם לשמור קבוע בקונפיג,
  // אבל לרוב עובד גם אקראי כל בקשה כל עוד 40 תווים:
  const nonce = crypto.randomBytes(20).toString('hex'); // 40 chars

  // CryptoJS.HmacSHA256(app_key, secret + timestamp + nonce).toString(Hex)
  const key = `${secret}${timestamp}${nonce}`;
  const accessToken = crypto
    .createHmac('sha256', key)     // key = secret+timestamp+nonce
    .update(appKey)               // message = app_key
    .digest('hex');               // hex!

  return { appKey, timestamp, nonce, accessToken };
}
type TranzilaApiResponse = {
  success?: boolean;
  status?: string;
  response_code?: string;
  error_code?: number | string;
  message?: string;
  error?: string;
  error_message?: string;

  transaction_id?: string | number;
  confirmation_code?: string | number;
  index?: string | number;
};

function isObj(x: unknown): x is Record<string, any> {
  return !!x && typeof x === 'object';
}


async function chargeByToken(args: {
  terminalName: string;
  token: string;
  amountAgorot: number;
  description?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
}): Promise<{ ok: boolean; provider_id: string | null; raw: any; error?: string; }> {

  const { terminalName, token, amountAgorot, description } = args;

  const expMonth = toTranzilaExpireMonth(args.expiryMonth);
  const expYearYY = toTranzilaExpireYearYY(args.expiryYear);

  // ✅ אם טרנזילה דורשים תוקף (לפי הדוגמה שלהם) – לא להמשיך בלי זה
  if (!expMonth || expYearYY === null) {
    return {
      ok: false,
      provider_id: null,
      raw: { local_error: 'missing_expiry' },
      error: 'Missing expire_month/expire_year for token charge (Tranzila schema requires it)',
    };
  }

  const amountNis = Number(amountAgorot) / 100;
  const sum = Number.isFinite(amountNis) ? Number(amountNis.toFixed(2)) : 0;

  const url = 'https://api.tranzila.com/v1/transaction/credit_card/create';

  const body: any = {
    terminal_name: terminalName,
    txn_currency_code: 'ILS',
    txn_type: 'debit',
    payment_plan: 1,

    card_number: String(token),

    // ✅ חובה בסכימה שלהם
    expire_month: expMonth,
    expire_year: expYearYY,

    items: [
      {
        code: '1',
        name: description ? String(description).slice(0, 60) : '',
        unit_price: sum,
        type: 'I',
        units_number: 1,
        unit_type: 1,
        price_type: 'G',
        currency_code: 'ILS',
      },
    ],
  };

  const auth = buildTranzilaAuthV2();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-tranzila-api-app-key': auth.appKey,
    'X-tranzila-api-request-time': auth.timestamp,
    'X-tranzila-api-nonce': auth.nonce,
    'X-tranzila-api-access-token': auth.accessToken,
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  const ct = resp.headers.get('content-type') || '';
  const raw = ct.includes('application/json') ? await resp.json() : await resp.text();

 const json = isObj(raw) ? (raw as any) : null;
const tr = isObj(json?.transaction_result) ? (json!.transaction_result as any) : null;

// ✅ קביעת הצלחה לפי המבנה האמיתי שחוזר מטרנזילה
const ok =
  (json?.error_code === 0 && String(json?.message).toLowerCase() === 'success') ||
  (tr?.processor_response_code === '000') ||
  (Number(tr?.transaction_resource) === 0);

// ✅ מזהה עסקה
const providerId =
  (tr?.transaction_id ?? tr?.ConfirmationCode ?? tr?.auth_number ?? null) != null
    ? String(tr?.transaction_id ?? tr?.ConfirmationCode ?? tr?.auth_number)
    : null;

if (ok) return { ok: true, provider_id: providerId, raw };

// אם לא ok — להוציא הודעת שגיאה הגיונית
const errMsg =
  tr?.processor_response_code
    ? `processor_response_code=${tr.processor_response_code}`
    : (json?.error ?? json?.error_message ?? json?.message ?? 'charge failed');

return { ok: false, provider_id: providerId, raw, error: errMsg };
}



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
// Tranzila Auth (HMAC) - לפי הקוד שהיה אצלך (app_key + secret)
// ===================================================================
function buildTranzilaAuth() {
  const appKey = envOrSecret(TRANZILA_APP_KEY_S, 'TRANZILA_APP_KEY');
  const secret = envOrSecret(TRANZILA_SECRET_S, 'TRANZILA_SECRET');
  if (!appKey || !secret) throw new Error('Missing Tranzila API keys (APP_KEY/SECRET)');

  // טרנזילה רוצים UNIX בשניות
  const requestTime = Math.floor(Date.now() / 1000).toString();

  // הם כתבו "פרמטר קבוע בעל 40 תווים"
  // אפשר קבוע קונפיגורציוני (לא חובה סודי)
  const nonce =
    envOrSecret(defineSecret('TRANZILA_NONCE') as any, 'TRANZILA_NONCE') ||
    '949ea362891adfe9085057c4560ef1142cbe9893'; // 40 תווים

  if (nonce.length !== 40) throw new Error('TRANZILA_NONCE must be exactly 40 chars');

  // לפי הדוגמה: HMAC_SHA256(app_key, secret + timestamp + nonce) -> HEX
  const key = `${secret}${requestTime}${nonce}`;
  const accessToken = crypto.createHmac('sha256', key).update(appKey).digest('hex');

  return { appKey, requestTime, nonce, accessToken };
}

type TranzilaCreateDocResponse = {
  status_code: number;
  status_msg: string;
  enquiry_key?: string;
  document?: {
    id?: string;          // document_id
    number?: string;      // document number
    retrieval_key?: string;
  };
};
//חדש שהוספתי
async function tranzilaCreateDocument(args: {
  terminalName: string;
  documentDate: string; // yyyy-mm-dd
  clientName?: string | null;
  clientEmail?: string | null;
  totalNis: number;     // 100.25
  paymentMethod: number; // 1 cc, 4 bank, 10 other...
  description: string;
  txnindex?: number | null; // אם יש לך מספר עסקה מספרי
}): Promise<{ documentId: string; retrievalKey: string; documentNumber?: string | null; raw: any; }> {

  const auth = buildTranzilaAuth();

  const url = 'https://billing5.tranzila.com/api/documents_db/create_document';

  const body: any = {
    terminal_name: args.terminalName,
    document_date: args.documentDate,
    document_type: 'IR',
    document_language: 'heb',
    response_language: 'eng',
    document_currency_code: 'ILS',
    action: 1,
    vat_percent: 17,

    client_name: args.clientName ?? undefined,
    client_email: args.clientEmail ?? undefined,

    // שורה אחת של פריט — הכי פשוט ומספיק לרוב המקרים
    items: [
      {
        type: 'I',
        name: args.description.slice(0, 60),
        unit_price: Number(args.totalNis.toFixed(2)),
        units_number: 1,
        unit_type: 1,
        price_type: 'G',
        currency_code: 'ILS',
        to_doc_currency_exchange_rate: 1,
      },
    ],

    payments: [
      {
        payment_method: args.paymentMethod,
        payment_date: args.documentDate,
        amount: Number(args.totalNis.toFixed(2)),
        currency_code: 'ILS',
      },
    ],
  };

  if (args.txnindex != null) body.txnindex = args.txnindex;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-tranzila-api-app-key': auth.appKey,
    'X-tranzila-api-request-time': auth.requestTime,
    'X-tranzila-api-nonce': auth.nonce,
    'X-tranzila-api-access-token': auth.accessToken,
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await resp.json() as TranzilaCreateDocResponse;

  if (!resp.ok) throw new Error(`Tranzila create_document HTTP ${resp.status}`);

  if (raw.status_code !== 0 || !raw.document?.id || !raw.document?.retrieval_key) {
    throw new Error(`Tranzila create_document failed: ${raw.status_code} ${raw.status_msg}`);
  }

  return {
    documentId: String(raw.document.id),
    retrievalKey: String(raw.document.retrieval_key),
    documentNumber: raw.document.number ? String(raw.document.number) : null,
    raw,
  };
}

async function tranzilaFetchPdfByRetrievalKey(retrievalKey: string): Promise<Buffer> {
  const url = `https://my.tranzila.com/api/get_financial_document/${encodeURIComponent(retrievalKey)}`;

  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`Tranzila get_financial_document HTTP ${resp.status}`);

  const ct = resp.headers.get('content-type') || '';
  // בהצלחה זה אמור להיות PDF; בכשלון טרנזילה לפעמים מחזירים HTML
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);

  if (!ct.includes('pdf')) {
    // נסיון לזהות "HTML error" ולא לשמור אותו כ-PDF
    const head = buf.slice(0, 200).toString('utf8').toLowerCase();
    if (head.includes('<html') || head.includes('error')) {
      throw new Error('Tranzila returned HTML error instead of PDF (bad retrieval_key?)');
    }
  }

  return buf;
}
async function uploadInvoicePdfAndAttachUrl(args: {
  sb: SupabaseClient;
  tenantSchema: string;
  paymentId: string;
  pdfBuffer: Buffer;
}) {
  const { sb, tenantSchema, paymentId, pdfBuffer } = args;

  const BUCKET_NAME = 'bereshit-payments-invoices';
  const filePath = `invoices/${tenantSchema}/${paymentId}.pdf`;

  const { error: uploadErr } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) throw new Error(uploadErr.message);

  const { data: publicData } = sb.storage.from(BUCKET_NAME).getPublicUrl(filePath);
  const url = (publicData as any).publicUrl + '?v=' + Date.now();

  await sb.from('payments').update({
    invoice_url: url,
    invoice_status: 'ready',
    invoice_updated_at: new Date().toISOString(),
  }).eq('id', paymentId);

  return url;
}

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


      const resp = await fetch(url.toString(), { method: 'GET' });
      const text = await resp.text();

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

/** ===== Tranzila token charge attempt ===== */
async function chargeViaTranzilaToken(args: {
  supplier: string;
  password: string;
  token: string;
  amountAgorot: number;
  orderid?: string;
}): Promise<{
  ok: boolean;
  provider_id: string | null;
  raw: Record<string, string>;
  error?: string;
}> {
  const { supplier, password, token, amountAgorot, orderid } = args;

  const sum = (Number(amountAgorot) / 100).toFixed(2);

  // ✅ זה ה-URL של חיוב טוקן (CGI)
  const url = 'https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi';

  const body = new URLSearchParams({
    supplier: String(supplier),
    password: String(password),
    sum,
    currency: '1',          // ILS
    tranmode: 'V',          // חיוב
    cred_type: '8',         // token
    TranzilaTK: String(token),

    // מומלץ מאוד:
    orderid: orderid ?? `charge_${Date.now()}`,
  });

  let text = '';
  try {
    const resp = await fetch(url, { method: 'POST', body });
    text = await resp.text();

  } catch (e: any) {
    console.error('[chargeViaTranzilaToken] fetch failed', e);
    return { ok: false, provider_id: null, raw: {}, error: e?.message ?? 'fetch failed' };
  }

  const kv: Record<string, string> = Object.fromEntries(
    text.split('&').map((p) => {
      const [k, v] = p.split('=');
      return [k, v ?? ''];
    }),
  );

  const ok = kv['Response'] === '000';
  const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

  return ok
    ? { ok: true, provider_id: providerId, raw: kv }
    : { ok: false, provider_id: providerId, raw: kv, error: kv['Error'] ?? kv['message'] ?? kv['err'] ?? 'charge failed' };
}


/** ===== Receipt: PDF -> Storage -> update payments.invoice_url ===== */
async function generateAndAttachReceiptUrlOnly(args: {
  sb: SupabaseClient;
  tenantSchema: string;
  paymentId: string;
  amountAgorot: number;
  tx: any;
}) {
  const { sb, tenantSchema, paymentId, amountAgorot, tx } = args;

  const amountNis = (amountAgorot / 100).toFixed(2);
  const dateStr = new Date().toLocaleDateString('he-IL');

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (c) => chunks.push(c));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).text('קבלה על תשלום', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`תאריך: ${dateStr}`);
  doc.text(`מספר תשלום: ${paymentId}`);
  doc.moveDown();
  doc.text(`סכום: ${amountNis} ₪`);
  if (tx?.transaction_id) doc.text(`אסמכתא: ${tx.transaction_id}`);
  if (tx?.credit_card_last_4_digits)
    doc.text(`4 ספרות אחרונות: **** ${tx.credit_card_last_4_digits}`);
  if (tx?.card_type_name) doc.text(`סוג כרטיס: ${tx.card_type_name}`);

  doc.end();
  const pdfBuffer = await pdfPromise;

  const BUCKET_NAME = 'bereshit-payments-invoices';
  const filePath = `receipts/${tenantSchema}/${paymentId}.pdf`;

  const { error: uploadErr } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) throw new Error(uploadErr.message);

  const { data: publicData } = sb.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  const url = (publicData as any).publicUrl + '?v=' + Date.now();

  await sb.from('payments').update({ invoice_url: url }).eq('id', paymentId);
}

/** ===== mail to secretary on failures ===== */
async function sendSecretaryFailuresEmail(args: {
  to: string;
  tenantSchema: string;
  parentUid: string;
  failures: Array<{
    chargeId: string;
    amountAgorot: number;
    error: string;
  }>;
}) {
  const { to, tenantSchema, parentUid, failures } = args;

  const rows = failures
    .map(
      (f) => `
      <tr>
        <td>${f.chargeId}</td>
        <td>${(f.amountAgorot / 100).toFixed(2)} ₪</td>
        <td>${escapeHtml(f.error)}</td>
      </tr>
    `,
    )
    .join('');

  const html = `
    <div dir="rtl">
      <h3>כשלון סליקה – חיובים שלא הושלמו</h3>
      <p><b>חווה:</b> ${tenantSchema}</p>
      <p><b>הורה:</b> ${parentUid}</p>
      <p>ניסינו לחייב בכל הכרטיסים הפעילים ולא הצלחנו בחיובים הבאים:</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr><th>Charge ID</th><th>סכום</th><th>שגיאה</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  await mailTransport.sendMail({
    to,
    from: '"Smart-Farm Billing" <no-reply@smart-farm>',
    subject: 'כשלון סליקה – חיובים שלא הושלמו',
    html,
  });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * ===================================================================
 * chargeSelectedChargesForParent
 * ===================================================================
 * מקבל: tenantSchema, parentUid, chargeIds[], secretaryEmail
 * מחייב כל חיוב לפי token של ההורה:
 * - מנסה default -> ואז כרטיסים אחרים
 * - בהצלחה: updates charges + inserts payments + generates receipt url
 * - בכשלון בכל הכרטיסים: מסמן failed + שולח מייל למזכירה
 */
export const chargeSelectedChargesForParent = onRequest(
  {
    invoker: 'public',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,

      // סודות טרנזילה (אל תורידי – צריך שיהיו זמינים ב-runtime)
      TRANZILA_PASSWORD_S,
      TRANZILA_PASSWORD_TOKEN_S,
      TRANZILA_APP_KEY_S,
      TRANZILA_SECRET_S,
    ],
  },
  async (req, res) => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { tenantSchema, parentUid, chargeIds } = req.body as {
        tenantSchema: string;
        parentUid: string;
        chargeIds: string[];
        secretaryEmail?: string | null;
      };

      if (!tenantSchema || !parentUid || !Array.isArray(chargeIds) || !chargeIds.length) {
        res.status(400).json({ ok: false, error: 'missing tenantSchema/parentUid/chargeIds' });
        return;
      }

      const sb = getSupabaseForTenant(tenantSchema);


      // A) טוענים מסוף ברירת מחדל מהסכמה של החווה (זה מה שחסר אצלך עכשיו)
      const terminal = await loadDefaultBillingTerminal({ sbTenant: sb, provider: 'tranzila', mode: 'prod' });

      if (!terminal.tok_terminal_name) {
        res.status(500).json({ ok: false, error: 'tok_terminal_name not configured in billing_terminals' });
        return;
      }

      const tokenTerminalPassword = resolveTranzilaSecretByKeyName(terminal.secret_key_charge_token);
    
      // B) טוענים כרטיסים פעילים של ההורה + החיובים

      // 1) כרטיסים פעילים (default ראשון)
      const { data: profiles, error: pErr } = await sb
        .from('payment_profiles')
        .select('id, token_ref, last4, brand, is_default, created_at, expiry_month, expiry_year')

        .eq('parent_uid', parentUid)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (pErr) throw pErr;
      if (!profiles?.length) {
        res.status(400).json({ ok: false, error: 'no active payment profiles for parent' });
        return;
      }

      // 2) חיובים + יתרות
      const { data: charges, error: cErr } = await sb
        .from('charges')
        .select('id,parent_uid,status,description')
        .in('id', chargeIds)
        .eq('parent_uid', parentUid);

      if (cErr) throw cErr;

      const { data: amounts, error: aErr } = await sb
        .from('v_parent_charges')
        .select('id,parent_uid,remaining_agorot')
        .in('id', chargeIds)
        .eq('parent_uid', parentUid);

      if (aErr) throw aErr;

      const byId = new Map((charges ?? []).map((c: any) => [c.id, c]));
      const missing = chargeIds.filter((id) => !byId.has(id));
      if (missing.length) {
        res.status(404).json({ ok: false, error: `charges not found: ${missing.join(',')}` });
        return;
      }

      const results: any[] = [];

      for (const chargeId of chargeIds) {
        const ch: any = byId.get(chargeId);
        const amtRow = (amounts ?? []).find((a: any) => a.id === chargeId);
        const amountAgorot = Number(amtRow?.remaining_agorot ?? 0);

        // כבר שולם/אין יתרה
        if (String(ch.status) === 'paid' || String(ch.status) === 'succeeded') {
          results.push({ chargeId, skipped: true, reason: 'already_paid' });
          continue;
        }
        if (!Number.isFinite(amountAgorot) || amountAgorot <= 0) {
          results.push({ chargeId, skipped: true, reason: 'amount_is_zero' });
          continue;
        }

        // ניסיונות חיוב על כל הטוקנים הפעילים
        let charged = false;
        let usedProfile: any = null;
        let providerId: string | null = null;
        let lastErrMsg = 'charge failed';

        for (const prof of profiles) {
          const orderId = `ch_${chargeId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

          const attempt = await chargeByToken({
          terminalName: terminal.tok_terminal_name ?? terminal.terminal_name,
          token: String(prof.token_ref),
          amountAgorot,
          description: ch.description ?? 'Monthly charge',
          expiryMonth: (prof as any).expiry_month,
          expiryYear:  (prof as any).expiry_year,
        });

          if (attempt.ok) {
            charged = true;
            usedProfile = prof;
            providerId = attempt.provider_id;
            break;
          } else {
            lastErrMsg = attempt.error || 'charge failed';
          }
        }

        if (!charged) {
          await sb
            .from('charges')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', chargeId);

          results.push({ ok: false, chargeId, error: lastErrMsg });
          continue;
        }

        //להוסיף בקשת חשבונית מטרנזילה שוהם 
        //שליחה במייל להורה - שוהם 
        // שוהם - שמירת חשבונית בענן לפי תקיית חווה+ תקיית
       // הצלחה: עדכון charge
await sb
  .from('charges')
  .update({
    status: 'paid',
    provider_id: providerId,
    profile_id: usedProfile?.id ?? null,
    updated_at: new Date().toISOString(),
  })
  .eq('id', chargeId);

// ✅ 1) INSERT ל-payments
const amountNis = Number(amountAgorot) / 100;
const today = new Date().toISOString().slice(0, 10);

const { data: payRow, error: payErr } = await sb
  .from('payments')
  .insert({
    parent_uid: parentUid,
    amount: amountNis,
    date: today,
    method: 'charge',      // או 'monthly' / 'token' איך שמתאים לך
    invoice_url: null, //שוהם - לאחר יצירת חשבונית להוסיף URL
    charge_id: chargeId,   // חשוב!
  })
  .select('id')
  .single();

if (payErr) {
  console.error('[chargeSelectedChargesForParent] payments insert error:', payErr);
  // אם את רוצה לא להפיל סליקה שכבר הצליחה, אפשר רק ללוג ולהמשיך
  // אבל עדיף להחזיר שגיאה כדי שתדעי לתקן.
  throw new Error(payErr.message);
}

const paymentId = payRow.id as string;

// ✅ 2) יצירת PDF + העלאה + עדכון invoice_url
await generateAndAttachReceiptUrlOnly({
  sb,
  tenantSchema,
  paymentId,
  amountAgorot,
  tx: {
    transaction_id: providerId,
    credit_card_last_4_digits: usedProfile?.last4,
    card_type_name: usedProfile?.brand,
  },
});
}

      res.json({ ok: true, results });
    } catch (e: any) {
      console.error('[chargeSelectedChargesForParent] error:', e);
      res.status(500).json({ ok: false, error: e?.message ?? 'internal error' });
    }
  },
);




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
function toTranzilaExpireYearYY(y: any): number | null {
  if (y === null || y === undefined || y === '') return null;
  const n = Number(y);
  if (!Number.isFinite(n)) return null;

  // אם שמור YYYY (2029) -> YY (29)
  if (n >= 1000) return n % 100;

  // אם כבר YY
  if (n >= 0 && n <= 99) return n;

  return null;
}

function toTranzilaExpireMonth(m: any): number | null {
  if (m === null || m === undefined || m === '') return null;
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 12) return null;
  return n;
}


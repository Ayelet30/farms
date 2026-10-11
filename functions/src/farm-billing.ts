import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const PUBLIC_BASE_URL_S = defineSecret('PUBLIC_BASE_URL');

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function getSupabase(): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL');
  const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY');

  if (!url || !key) {
    throw new Error('Missing Supabase credentials');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getPublicBaseUrl() {
  const url = envOrSecret(PUBLIC_BASE_URL_S, 'PUBLIC_BASE_URL');
  if (!url) throw new Error('Missing PUBLIC_BASE_URL');
  return url;
}

type BillingPaymentType = 'setup' | 'monthly' | 'one_time' | 'credit';

function requireAdmin(request: any) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'חובה להתחבר');
  }

  // אם יש custom claims:
  // if (request.auth.token.role !== 'admin') {
  //   throw new HttpsError('permission-denied', 'אין הרשאת מנהל');
  // }
}

function assertPositiveAmount(amount: any) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpsError('invalid-argument', 'סכום לא תקין');
  }
  return Math.round(n);
}

async function getCustomerById(customerId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('farm_billing_customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error || !data) {
    throw new HttpsError('not-found', 'לקוח לא נמצא');
  }

  return data;
}

async function getOrCreateCustomer(params: {
  farm_id: string;
  customer_id?: string | null;
  farm_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  business_id?: string | null;
}) {
  if (params.customer_id) {
    return await getCustomerById(params.customer_id);
  }
  const supabase = getSupabase();

  const { data: farm, error: farmError } = await supabase
    .from('farms')
    .select('id, name, schema_name')
    .eq('id', params.farm_id)
    .single();

  if (farmError || !farm) {
    throw new HttpsError('not-found', 'חווה לא נמצאה');
  }

  const { data: existing } = await supabase
    .from('farm_billing_customers')
    .select('*')
    .eq('farm_id', params.farm_id)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('farm_billing_customers')
    .insert({
      farm_id: params.farm_id,
      farm_name: params.farm_name || farm.name,
      contact_name: params.contact_name || null,
      email: params.email || 'missing@email.local',
      phone: params.phone || null,
      business_id: params.business_id || null,
      active: true,
    })
    .select()
    .single();

  if (error) {
    throw new HttpsError('internal', error.message);
  }

  return data;
}

export const upsertFarmBillingCustomer = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (request) => {
    requireAdmin(request);

    const {
      farm_id,
      farm_name,
      contact_name,
      email,
      phone,
      business_id,
      active,
    } = request.data || {};

    if (!farm_id) {
      throw new HttpsError('invalid-argument', 'חסר farm_id');
    }

    if (!farm_name) {
      throw new HttpsError('invalid-argument', 'חסר שם חווה');
    }

    if (!email) {
      throw new HttpsError('invalid-argument', 'חסר אימייל');
    }

    const supabase = getSupabase();
    const { data: existing, error: existingError } = await supabase
      .from('farm_billing_customers')
      .select('id')
      .eq('farm_id', farm_id)
      .maybeSingle();

    if (existingError) {
      throw new HttpsError('internal', existingError.message);
    }

    if (existing?.id) {
      const { data, error } = await supabase
        .from('farm_billing_customers')
        .update({
          farm_name,
          contact_name: contact_name || null,
          email,
          phone: phone || null,
          business_id: business_id || null,
          active: active ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new HttpsError('internal', error.message);
      return data;
    }

    const { data, error } = await supabase
      .from('farm_billing_customers')
      .insert({
        farm_id,
        farm_name,
        contact_name: contact_name || null,
        email,
        phone: phone || null,
        business_id: business_id || null,
        active: active ?? true,
      })
      .select()
      .single();

    if (error) throw new HttpsError('internal', error.message);
    return data;
  }
);

export const createFarmBillingPaymentLink = onCall(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      PUBLIC_BASE_URL_S,
    ],
  },
  async (request) => {
    requireAdmin(request);

    const {
      farm_id,
      customer_id,
      amount_agorot,
      description,
      payment_type,
      billing_day,
    } = request.data || {};

    if (!farm_id) {
      throw new HttpsError('invalid-argument', 'חסר farm_id');
    }

    if (!description || !payment_type) {
      throw new HttpsError('invalid-argument', 'חסרים נתונים ליצירת חיוב');
    }

    const amount = assertPositiveAmount(amount_agorot);

    const customer = await getOrCreateCustomer({
      farm_id,
      customer_id: customer_id || null,
    });

    const supabase = getSupabase();
    const { data: payment, error: paymentError } = await supabase
      .from('farm_billing_payments')
      .insert({
        farm_id: customer.farm_id,
        customer_id: customer.id,
        amount_agorot: amount,
        description,
        payment_type,
        status: payment_type === 'credit' ? 'paid' : 'pending',
        paid_at: payment_type === 'credit' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (paymentError) {
      throw new HttpsError('internal', paymentError.message);
    }

    if (payment_type === 'credit') {
      return {
        paymentId: payment.id,
        paymentUrl: null,
        message: 'הזיכוי נוצר',
      };
    }

    const paymentUrl = buildTranzilaHostedUrl({
      paymentId: payment.id,
      amountAgorot: amount,
      description,
      customerEmail: customer.email,
      customerName: customer.farm_name,
      saveToken: payment_type === 'monthly',
    });

    if (payment_type === 'monthly') {
      const nextChargeDate = getNextChargeDate(Number(billing_day || 1));

      const { error: subError } = await supabase
        .from('farm_billing_subscriptions')
        .insert({
          farm_id: customer.farm_id,
          customer_id: customer.id,
          amount_agorot: amount,
          description,
          billing_day: Number(billing_day || 1),
          active: true,
          next_charge_date: nextChargeDate,
        });

      if (subError) {
        throw new HttpsError('internal', subError.message);
      }
    }

    return {
      paymentId: payment.id,
      paymentUrl,
    };
  }
);

export const markFarmBillingPaidManually = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (request) => {
    requireAdmin(request);

    const {
      farm_id,
      customer_id,
      farm_name,
      email,
      amount_agorot,
      description,
      payment_type,
      manual_payment_method,
      receipt_url,
      receipt_file_name,
    } = request.data || {};

    if (!farm_id) {
      throw new HttpsError('invalid-argument', 'חסר farm_id');
    }

    if (!description || !payment_type) {
      throw new HttpsError('invalid-argument', 'חסרים נתוני תשלום');
    }

    const amount = assertPositiveAmount(amount_agorot);

    const customer = await getOrCreateCustomer({
      farm_id,
      customer_id: customer_id || null,
      farm_name,
      email,
    });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('farm_billing_payments')
      .insert({
        farm_id: customer.farm_id,
        customer_id: customer.id,
        amount_agorot: amount,
        description,
        payment_type,
        status: 'paid',
        paid_manually: true,
        manual_payment_method: manual_payment_method || 'אחר',
        receipt_url: receipt_url || null,
        receipt_file_name: receipt_file_name || null,
        paid_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new HttpsError('internal', error.message);
    }

    return data;
  }
);

export const setFarmBillingStopped = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (request) => {
    requireAdmin(request);

    const { farm_id, customer_id, stop, reason } = request.data || {};

    if (!farm_id && !customer_id) {
      throw new HttpsError('invalid-argument', 'חסר מזהה חווה או לקוח');
    }

    const supabase = getSupabase();
    let q = supabase.from('farm_billing_subscriptions').update({
      active: !stop,
      paused_at: stop ? new Date().toISOString() : null,
      pause_reason: stop ? reason || null : null,
    });

    q = customer_id ? q.eq('customer_id', customer_id) : q.eq('farm_id', farm_id);

    const { error } = await q;

    if (error) {
      throw new HttpsError('internal', error.message);
    }

    return { ok: true };
  }
);

export const cancelFarmBillingPayment = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (request) => {
    requireAdmin(request);

    const { paymentId } = request.data || {};

    if (!paymentId) {
      throw new HttpsError('invalid-argument', 'חסר paymentId');
    }

    const supabase = getSupabase();
    const { data: payment, error: readError } = await supabase
      .from('farm_billing_payments')
      .select('id, status')
      .eq('id', paymentId)
      .single();

    if (readError || !payment) {
      throw new HttpsError('not-found', 'חיוב לא נמצא');
    }

    if (payment.status === 'paid') {
      throw new HttpsError('failed-precondition', 'אי אפשר לבטל חיוב שכבר שולם');
    }

    const { error } = await supabase
      .from('farm_billing_payments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (error) {
      throw new HttpsError('internal', error.message);
    }

    return { ok: true };
  }
);

function buildTranzilaHostedUrl(params: {
  paymentId: string;
  amountAgorot: number;
  description: string;
  customerEmail: string;
  customerName: string;
  saveToken: boolean;
}) {
  const terminal = 'moachapp'; // כאן לשים את שם המסוף של מוח אתרים טסט
  const appBaseUrl = getPublicBaseUrl();
  const amount = (params.amountAgorot / 100).toFixed(2);

  const qs = new URLSearchParams({
    supplier: terminal,
    sum: amount,
    currency: '1',
    cred_type: '1',
    tranmode: 'AK',
    pdesc: params.description,
    contact: params.customerName,
    email: params.customerEmail,
    order_id: params.paymentId,
    success_url_address: `${appBaseUrl}/api/tranzila/farm-billing-return?status=success&paymentId=${params.paymentId}`,
    fail_url_address: `${appBaseUrl}/api/tranzila/farm-billing-return?status=failed&paymentId=${params.paymentId}`,
  });

  if (params.saveToken) {
    qs.set('save_token', '1');
  }

  return `https://direct.tranzila.com/${terminal}/iframenew.php?${qs.toString()}`;
}

function getNextChargeDate(day: number) {
  const safeDay = Math.min(Math.max(Number(day || 1), 1), 28);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const candidate = new Date(y, m, safeDay);

  if (candidate <= now) {
    return new Date(y, m + 1, safeDay).toISOString().slice(0, 10);
  }

  return candidate.toISOString().slice(0, 10);
}

export const sendFarmBillingReceipt = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (request) => {
    requireAdmin(request);

    const { paymentId } = request.data || {};

    if (!paymentId) {
      throw new HttpsError('invalid-argument', 'חסר paymentId');
    }

    const supabase = getSupabase();
    const { data: payment, error } = await supabase
      .from('farm_billing_payments')
      .select(`
        *,
        farm_billing_customers (
          farm_name,
          email,
          business_id
        )
      `)
      .eq('id', paymentId)
      .single();

    if (error || !payment) {
      throw new HttpsError('not-found', 'חיוב לא נמצא');
    }

    if (payment.status !== 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'אי אפשר לשלוח קבלה על חיוב שלא שולם'
      );
    }

    const fakeDocumentUrl = payment.receipt_url || null;

    const { error: docError } = await supabase
      .from('farm_billing_documents')
      .upsert({
        farm_id: payment.farm_id,
        payment_id: paymentId,
        document_type: 'receipt',
        document_url: fakeDocumentUrl,
        sent_to_email: payment.farm_billing_customers?.email || null,
        sent_at: new Date().toISOString(),
        status: 'sent',
      });

    if (docError) {
      throw new HttpsError('internal', docError.message);
    }

    return {
      ok: true,
      message: 'הקבלה סומנה כנשלחה',
    };
  }
);

export const cronMonthlyFarmBilling = onSchedule(
  {
    schedule: 'every day 04:00',
    timeZone: 'Asia/Jerusalem',
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
    ],
  },
  async () => {

    const today = new Date().toISOString().slice(0, 10);

    const supabase = getSupabase();
    const { data: subscriptions, error } = await supabase
      .from('farm_billing_subscriptions')
      .select('*')
      .eq('active', true)
      .lte('next_charge_date', today);

    if (error) throw error;

    for (const sub of subscriptions || []) {
      const { data: payment, error: paymentError } = await supabase
        .from('farm_billing_payments')
        .insert({
          farm_id: sub.farm_id,
          customer_id: sub.customer_id,
          subscription_id: sub.id,
          amount_agorot: sub.amount_agorot,
          description: sub.description,
          payment_type: 'monthly',
          status: 'pending',
        })
        .select()
        .single();

      if (paymentError) {
        console.error('monthly payment insert failed', paymentError);
        continue;
      }

      const chargeResult = await chargeMonthlyByToken({
        tokenRef: sub.token_ref,
        amountAgorot: sub.amount_agorot,
        paymentId: payment.id,
      });

      await supabase
        .from('farm_billing_payments')
        .update({
          status: chargeResult.success ? 'paid' : 'failed',
          tranzila_txn_id: chargeResult.txnId || null,
          tranzila_response: chargeResult.raw || null,
          paid_at: chargeResult.success ? new Date().toISOString() : null,
        })
        .eq('id', payment.id);

      const next = addOneMonth(sub.billing_day);

      await supabase
        .from('farm_billing_subscriptions')
        .update({
          last_charge_at: new Date().toISOString(),
          next_charge_date: next,
        })
        .eq('id', sub.id);
    }
  }
);

type ChargeMonthlyResult = {
  success: boolean;
  txnId?: string | null;
  raw: any;
};

async function chargeMonthlyByToken(params: {
  tokenRef: string | null;
  amountAgorot: number;
  paymentId: string;
}): Promise<ChargeMonthlyResult> {
  if (!params.tokenRef) {
    return {
      success: false,
      txnId: null,
      raw: { error: 'Missing token_ref' },
    };
  }

  return {
    success: false,
    txnId: null,
    raw: {
      message: 'Tranzila token charge not implemented yet',
    },
  };
}

function addOneMonth(day: number) {
  const safeDay = Math.min(Math.max(Number(day || 1), 1), 28);
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth() + 1, safeDay)
    .toISOString()
    .slice(0, 10);
}
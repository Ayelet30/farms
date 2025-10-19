import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

if (!admin.apps.length) admin.initializeApp();

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

function toTranzilaCurrency(code?: string): string {
  // ברירת מחדל ILS
  if (!code || code.toUpperCase() === 'ILS') return '1';
  // הוסיפי כאן מפה למטבעות אחרים במידת הצורך
  return '1';
}

/**
 * יצירת URL לתשלום מאובטח (Hosted) של טרנזילה
 */
export const createHostedPaymentUrl = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const { uid, email, farmId, amountAgorot, orderId, successPath, failPath } = req.body as {
      uid: string; email: string; farmId: string; amountAgorot: number; orderId: string;
      successPath?: string; failPath?: string;
    };

    if (!uid || !email || !farmId || !amountAgorot || !orderId) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }

    const supplier = process.env.TRANZILA_SUPPLIER!;
    const base = process.env.PUBLIC_BASE_URL!;

    const sum = (amountAgorot / 100).toFixed(2);
    const successUrl = `${base}${successPath ?? '/billing/success'}`;
    const errorUrl = `${base}${failPath ?? '/billing/error'}`;

    const hostedUrl = new URL(`https://direct.tranzila.com/${supplier}/tranDirect.asp`);
    const params = new URLSearchParams({
      supplier,
      sum,
      currency: '1',        // 1 = ILS
      orderid: orderId,
      contact: email,
      email,
      // הפעלת טוקניזציה בעסקה הראשונה (הערכים המדויקים תלויים במסוף שלך)
      cred_type: '1',
      tranmode: 'AK',
      success_url: successUrl,
      error_url: errorUrl,
      // פרמטרים חופשיים שיחזרו אליך
      custom_uid: uid,
      custom_farm: farmId,
    });
    hostedUrl.search = params.toString();

    res.json({ url: hostedUrl.toString() });
  } catch (e: any) {
    console.error('[createHostedPaymentUrl] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * דף חזרה אחרי תשלום – לוכד Token ושומר פרופיל תשלום
 */
export const tranzilaReturn = onRequest(async (req, res) => {
  try {
    const { orderid, custom_uid, custom_farm } = req.query as any;

    const supplier = process.env.TRANZILA_SUPPLIER!;
    const password = process.env.TRANZILA_PASSWORD!;

    // שליפת תוצאות העסקה + הטוקן
    const qUrl = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
    const qParams = new URLSearchParams({ supplier, password, tranmode: 'Q', orderid: String(orderid) });
    const r = await fetch(qUrl.toString(), { method: 'POST', body: qParams as any });
    const text = await r.text();

    const kv: Record<string, string> = Object.fromEntries(
      text.split('&').map(p => {
        const [k, v] = p.split('=');
        return [k, v ?? ''];
      })
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
    const farmId = String(custom_farm);

    await sb.from('payment_profiles').insert({
      parent_uid: parentUid,
      farm_id: farmId,
      tranzila_token: token,
      tranzila_supplier: supplier,
      last4,
      brand,
      active: true,
    });

    res.redirect(302, `${process.env.PUBLIC_BASE_URL}/billing/success?orderid=${orderid}`);
  } catch (e: any) {
    console.error('[tranzilaReturn] error:', e);
    res.status(500).send('Failed to capture token');
  }
});

/**
 * חיוב לפי Token (לקריאה ידנית/REST)
 * body: { parentUid, farmId, amountAgorot, currency? }
 */
export const chargeByToken = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const { parentUid, farmId, amountAgorot, currency } = req.body as {
      parentUid: string; farmId: string; amountAgorot: number; currency?: string;
    };

    if (!parentUid || !farmId || !amountAgorot) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }

    const { data: profiles, error } = await sb
      .from('payment_profiles')
      .select('*')
      .eq('parent_uid', parentUid)
      .eq('farm_id', farmId)
      .eq('active', true)
      .limit(1);

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

    const supplier = String(tranzila_supplier);
    const password = process.env.TRANZILA_PASSWORD!;
    const sum = (Number(amountAgorot) / 100).toFixed(2);
    const tranzilaCurrency = toTranzilaCurrency(currency);

    const url = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
    const body = new URLSearchParams({
      supplier,
      password,
      sum,
      currency: tranzilaCurrency,
      tranmode: 'V',
      cred_type: '8',    // חיוב בטוקן
      TranzilaTK: String(tranzila_token),
    });

    const resp = await fetch(url.toString(), { method: 'POST', body: body as any });
    const text = await resp.text();

    const kv: Record<string, string> = Object.fromEntries(
      text.split('&').map(p => {
        const [k, v] = p.split('=');
        return [k, v ?? ''];
      })
    );

    const success = kv['Response'] === '000';
    const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? null;

    await sb.from('charges').insert({
      subscription_id: null,
      parent_uid: parentUid,
      farm_id: farmId,
      amount_agorot: amountAgorot,
      currency: (currency ?? 'ILS').toUpperCase(),
      provider_id: providerId,
      status: success ? 'succeeded' : 'failed',
      error_message: success ? null : text,
    });

    res.json({ ok: success, providerRaw: kv });
  } catch (e: any) {
    console.error('[chargeByToken] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Cron חודשי – מחייב את כל המנויים שהגיע מועד החיוב שלהם
 * ריצה לדוגמה כל יום ב-03:00. החליפי לזמן המתאים.
 */
export const cronMonthlyCharges = onSchedule('0 3 * * *', async (event) => {
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
        const { parent_uid, farm_id, amount_agorot, currency, id, interval_months } = sub as any;

        // ביצוע חיוב – ישירות מול טרנזילה (כמו ב-chargeByToken)
        const { data: profiles } = await sb
          .from('payment_profiles')
          .select('*')
          .eq('parent_uid', parent_uid)
          .eq('farm_id', farm_id)
          .eq('active', true)
          .limit(1);

        if (!profiles?.length) {
          console.warn(`[cronMonthlyCharges] no token for uid=${parent_uid} farm=${farm_id}`);
          continue;
        }

        const { tranzila_token, tranzila_supplier } = profiles[0] as any;
        const supplier = String(tranzila_supplier);
        const password = process.env.TRANZILA_PASSWORD!;
        const sum = (Number(amount_agorot) / 100).toFixed(2);
        const tranzilaCurrency = toTranzilaCurrency(currency);

        const url = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
        const body = new URLSearchParams({
          supplier,
          password,
          sum,
          currency: tranzilaCurrency,
          tranmode: 'V',
          cred_type: '8',
          TranzilaTK: String(tranzila_token),
        });

        const resp = await fetch(url.toString(), { method: 'POST', body: body as any });
        const text = await resp.text();
        const kv: Record<string, string> = Object.fromEntries(
          text.split('&').map(p => {
            const [k, v] = p.split('=');
            return [k, v ?? ''];
          })
        );

        const success = kv['Response'] === '000';
        const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? null;

        await sb.from('charges').insert({
          subscription_id: id,
          parent_uid,
          farm_id,
          amount_agorot: amount_agorot,
          currency: (currency ?? 'ILS').toUpperCase(),
          provider_id: providerId,
          status: success ? 'succeeded' : 'failed',
          error_message: success ? null : text,
        });

        // קידום מועד לחיוב הבא
        const next = new Date();
        next.setMonth(next.getMonth() + (interval_months ?? 1));
        await sb.from('subscriptions').update({ next_charge_at: next.toISOString() }).eq('id', id);
      } catch (inner) {
        console.error('[cronMonthlyCharges] single sub error:', inner);
      }
    }

    console.log('[cronMonthlyCharges] processed:', due.length);
  } catch (e: any) {
    console.error('[cronMonthlyCharges] error:', e);
  }
});

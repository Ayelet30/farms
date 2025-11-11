// functions/src/payments.ts (או בכל שם קיים אצלך)
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';

import { config as dotenvConfig } from 'dotenv';

import { defineSecret } from 'firebase-functions/params';



// עדיף שה-SERVICE KEY ייקרא SUPABASE_SERVICE_ROLE_KEY (ככה ברוב הפרויקטים)
// אבל כדי לא לשבור, ננסה גם SUPABASE_SERVICE_KEY אם הראשון לא קיים.
const SUPABASE_URL =  defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_ROLE_KEY');;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[boot] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const sb = createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value());

function toTranzilaCurrency(code?: string): string {
  // ברירת מחדל ILS
  if (!code || code.toUpperCase() === 'ILS') return '1';
  // הוסיפי כאן מפה למטבעות אחרים במידת הצורך
  return '1';
}

/** עוזר: בנייה מותנית של אובייקט Insert עם farm_id רק אם קיים */
function withMaybeFarm<T extends Record<string, any>>(base: T, farmId?: string) {
  if (farmId) return { ...base, farm_id: farmId };
  return base;
}

/**
 * יצירת URL לתשלום מאובטח (Hosted) של טרנזילה
 * גוף בקשה: { uid, email, farmId?, amountAgorot, orderId, successPath?, failPath? }
 * מחזיר: { url }
 */
export const createHostedPaymentUrl = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const {
      uid,
      email,
      farmId,            // אופציונלי
      amountAgorot,
      orderId,
      successPath,
      failPath,
    } = req.body as {
      uid: string;
      email: string;
      farmId?: string;
      amountAgorot: number;   // אגורות
      orderId: string;
      successPath?: string;
      failPath?: string;
    };

    if (!uid || !email || orderId == null || amountAgorot == null) {
      res.status(400).json({ error: 'missing fields (uid/email/orderId/amountAgorot)' });
      return;
    }
    if (typeof amountAgorot !== 'number' || amountAgorot < 0) {
      res.status(400).json({ error: 'amountAgorot must be a non-negative number' });
      return;
    }

    const supplier = process.env.TRANZILA_SUPPLIER || process.env.TRANZILA_SUPPLIER_ID;
    const base = process.env.PUBLIC_BASE_URL;

    if (!supplier) { res.status(500).json({ error: 'Missing TRANZILA_SUPPLIER(_ID)' }); return; }
    if (!base)     { res.status(500).json({ error: 'Missing PUBLIC_BASE_URL' }); return; }

    const sumNis = (amountAgorot / 100).toFixed(2);
    const successUrl = `${base}${(successPath ?? '/billing/success').trim().startsWith('/') ? (successPath ?? '/billing/success') : '/billing/success'}`;
    const errorUrl   = `${base}${(failPath ?? '/billing/error').trim().startsWith('/') ? (failPath ?? '/billing/error') : '/billing/error'}`;

    // שני מסלולי HPP נפוצים. אם קיבלת מאיתם URL אחר – החליפי כאן בלבד.
    // 1) iframenew.php
    // const hpp = new URL(`https://direct.tranzila.com/${supplier}/iframenew.php`);
    // 2) tranDirect.asp (פועל מצוין ברוב ההתקנות)
    const hpp = new URL(`https://direct.tranzila.com/${supplier}/tranDirect.asp`);

    const params = new URLSearchParams({
      supplier,
      sum: sumNis,
      currency: '1',         // 1 = ILS
      orderid: orderId,      // זה השם המקובל במסלול הזה
      contact: email,
      email,
      // טוקניזציה בפעולה הראשונה (ערכים תלויים במסוף שלך; אלו בטוחים ברוב ההתקנות)
      cred_type: '1',
      tranmode: 'AK',
      success_url: successUrl,
      error_url: errorUrl,
      // שדות חופשיים שיחזרו אלינו
      custom_uid: uid,
      ...(farmId ? { custom_farm: farmId } : {}),
    });
    hpp.search = params.toString();

    res.json({ url: hpp.toString() });
  } catch (e: any) {
    console.error('[createHostedPaymentUrl] error:', e);
    res.status(500).json({ error: e.message ?? 'internal error' });
  }
});

/**
 * דף חזרה אחרי תשלום – לוכד Token ושומר פרופיל תשלום (Server-to-Server Query)
 * מסלול: GET /tranzilaReturn?orderid=...&custom_uid=...&custom_farm=...
 */
export const tranzilaReturn = onRequest(async (req, res) => {
  try {
    const { orderid, custom_uid, custom_farm } = req.query as any;

    if (!orderid || !custom_uid) {
      res.status(400).send('Missing orderid/custom_uid');
      return;
    }

    const supplier = process.env.TRANZILA_SUPPLIER || process.env.TRANZILA_SUPPLIER_ID;
    const password = process.env.TRANZILA_PASSWORD;
    const appBase  = process.env.PUBLIC_BASE_URL;

    if (!supplier || !password || !appBase) {
      res.status(500).send('Missing TRANZILA_SUPPLIER/PASSWORD or PUBLIC_BASE_URL');
      return;
    }

    // שליפת תוצאות העסקה + הטוקן
    const qUrl = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
    const qParams = new URLSearchParams({ supplier, password, tranmode: 'Q', orderid: String(orderid) });

    const r = await fetch(qUrl.toString(), { method: 'POST', body: qParams });
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
    const farmId = custom_farm ? String(custom_farm) : undefined;

    // הוספה לטבלה – farm_id רק אם קיים אצלך ב-DB
    const insertObj = withMaybeFarm({
      parent_uid: parentUid,
      tranzila_token: token,
      tranzila_supplier: supplier,
      last4,
      brand,
      active: true,
    }, farmId);

    const { error: insErr } = await sb.from('payment_profiles').insert(insertObj as any);
    if (insErr) {
      console.error('[tranzilaReturn] insert error:', insErr);
      // נמשיך להפנות כדי לא לשבור UX, אבל לוג חשוב.
    }

    res.redirect(302, `${appBase}/billing/success?orderid=${encodeURIComponent(String(orderid))}`);
  } catch (e: any) {
    console.error('[tranzilaReturn] error:', e);
    res.status(500).send('Failed to capture token');
  }
});

/**
 * חיוב לפי Token (REST)
 * גוף בקשה: { parentUid, amountAgorot, currency?, farmId? }
 */
export const chargeByToken = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const { parentUid, amountAgorot, currency, farmId } = req.body as {
      parentUid: string;
      amountAgorot: number;
      currency?: string;
      farmId?: string;  // אופציונלי
    };

    if (!parentUid || amountAgorot == null) {
      res.status(400).json({ error: 'missing fields (parentUid/amountAgorot)' });
      return;
    }

    // שולף פרופיל פעיל – אם farmId קיים נחפש איתו, אחרת בלעדיו
    const q = sb.from('payment_profiles')
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

    const supplier = String(tranzila_supplier || process.env.TRANZILA_SUPPLIER || process.env.TRANZILA_SUPPLIER_ID || '');
    const password = process.env.TRANZILA_PASSWORD!;
    if (!supplier || !password) {
      res.status(500).json({ error: 'Missing TRANZILA_SUPPLIER/PASSWORD' });
      return;
    }

    const sum = (Number(amountAgorot) / 100).toFixed(2);
    const tranzilaCurrency = toTranzilaCurrency(currency);

    const url = new URL('https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi');
    const body = new URLSearchParams({
      supplier,
      password,
      sum,
      currency: tranzilaCurrency,
      tranmode: 'V',
      cred_type: '8',               // חיוב בטוקן
      TranzilaTK: String(tranzila_token),
    });

    const resp = await fetch(url.toString(), { method: 'POST', body });
    const text = await resp.text();

    const kv: Record<string, string> = Object.fromEntries(
      text.split('&').map(p => {
        const [k, v] = p.split('=');
        return [k, v ?? ''];
      })
    );

    const success = kv['Response'] === '000';
    const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

    // הכנסת רשומת חיוב – farm_id רק אם קיים אצלך ב-DB
    const chargeInsert = withMaybeFarm({
      subscription_id: null,
      parent_uid: parentUid,
      amount_agorot: amountAgorot,
      currency: (currency ?? 'ILS').toUpperCase(),
      provider_id: providerId,
      status: success ? 'succeeded' : 'failed',
      error_message: success ? null : text,
    }, farmId);

    await sb.from('charges').insert(chargeInsert as any);

    res.json({ ok: success, providerRaw: kv });
  } catch (e: any) {
    console.error('[chargeByToken] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Cron חודשי – מחייב את כל המנויים שהגיע מועד החיוב שלהם
 * ריצה לדוגמה כל יום ב-03:00
 */
export const cronMonthlyCharges = onSchedule('0 3 * * *', async () => {
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
        const { parent_uid, amount_agorot, currency, id, interval_months, farm_id } = sub as any;

        // פרופיל פעיל (עם/בלי farm_id)
        const q = sb.from('payment_profiles')
          .select('*')
          .eq('parent_uid', parent_uid)
          .eq('active', true)
          .limit(1);
        if (farm_id) q.eq('farm_id', farm_id);

        const { data: profiles } = await q;
        if (!profiles?.length) {
          console.warn(`[cronMonthlyCharges] no token for uid=${parent_uid} farm=${farm_id ?? '-'}`);
          continue;
        }

        const { tranzila_token, tranzila_supplier } = profiles[0] as any;
        const supplier = String(tranzila_supplier || process.env.TRANZILA_SUPPLIER || process.env.TRANZILA_SUPPLIER_ID || '');
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

        const resp = await fetch(url.toString(), { method: 'POST', body });
        const text = await resp.text();
        const kv: Record<string, string> = Object.fromEntries(
          text.split('&').map(p => {
            const [k, v] = p.split('=');
            return [k, v ?? ''];
          })
        );

        const success = kv['Response'] === '000';
        const providerId = kv['index'] ?? kv['ConfirmationCode'] ?? kv['ConfNum'] ?? null;

        const insertCharge = withMaybeFarm({
          subscription_id: id,
          parent_uid,
          amount_agorot: amount_agorot,
          currency: (currency ?? 'ILS').toUpperCase(),
          provider_id: providerId,
          status: success ? 'succeeded' : 'failed',
          error_message: success ? null : text,
        }, farm_id);

        await sb.from('charges').insert(insertCharge as any);

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

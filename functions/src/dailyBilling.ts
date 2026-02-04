import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

function getBillingDateInIsrael() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;

  return { billingDate: `${y}-${m}-${d}`, day: Number(d) };
}

function supaRoot() {
  return createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function supaTenant(schemaName: string) {
  return createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: schemaName },
  });
}

export const runDailyBilling = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 2 * * *',          // כל יום ב-02:00
    timeZone: 'Asia/Jerusalem',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
    maxInstances: 1,                 // נגד חפיפות
  },
  async () => {
    const { billingDate, day } = getBillingDateInIsrael();
    logger.info('runDailyBilling start', { billingDate, day });

    // 1) לשלוף את כל הסכמות הפעילות מתוך public.farms
    const root = supaRoot();
    const { data: farms, error: farmsErr } = await root
      .from('farms') // public.farms
      .select('schema_name')
      .not('schema_name', 'is', null);

    if (farmsErr) {
      logger.error('load public.farms failed', farmsErr);
      return;
    }

    const schemas = (farms ?? [])
      .map(f => String((f as any).schema_name || '').trim())
      .filter(s => !!s && s !== 'public');

    logger.info('schemas to bill', { count: schemas.length, schemas });

    // 2) לרוץ סכמה-סכמה
    for (const schema of schemas) {
      try {
        const supa = supaTenant(schema);

        // (אופציונלי אבל מומלץ) נעילה לכל סכמה+תאריך כדי שלא תהיה הרצה כפולה
        // אם עדיין אין לך RPC כזה, אפשר להוריד את הבלוק הזה.
        const lockKey = `dailyBilling:${schema}:${billingDate}`;
        const { data: gotLock, error: lockErr } = await supa.rpc('try_acquire_billing_lock', {
          p_lock_key: lockKey,
        });

        if (lockErr) {
          logger.error('lock rpc failed', { schema, lockErr });
          continue;
        }
        if (!gotLock) {
          logger.info('skip: lock already held', { schema, lockKey });
          continue;
        }

        // 3) להביא את ההורים שיום החיוב שלהם הוא היום
        const { data: parents, error: pErr } = await supa
          .from('parents')
          .select('uid')
          .eq('billing_day_of_month', day);

        if (pErr) throw pErr;

        logger.info('billing tenant parents', { schema, count: parents?.length ?? 0 });

        // 4) להפעיל RPC לכל הורה
        let ok = 0;
        let failed = 0;

        for (const p of parents ?? []) {
          const parentUid = (p as any).uid;

          const { error: rpcErr } = await supa.rpc('create_monthly_charge_for_parent', {
            p_parent_uid: parentUid,
            p_billing_date: billingDate, // YYYY-MM-DD
          });

          if (rpcErr) {
            failed++;
            logger.error('parent rpc failed', {
              schema,
              parentUid,
              message: rpcErr.message,
              code: rpcErr.code,
              details: rpcErr.details,
              hint: rpcErr.hint,
            });
          } else {
            ok++;
          }
        }

        logger.info('tenant billing done', { schema, ok, failed });
      } catch (e: any) {
        logger.error('tenant billing failed', { schema, message: e?.message ?? String(e) });
      }
    }

    logger.info('runDailyBilling done', { billingDate });
  }
);

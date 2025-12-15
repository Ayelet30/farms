import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { getSupabaseForTenant } from './supabase.js';

const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

export const runDailyBilling = onSchedule(
  {
    region: 'us-central1',
    schedule: '* * * * *',
    timeZone: 'Asia/Jerusalem',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S], 
  },
  async () => {
    logger.info('runDailyBilling tick', { now: new Date().toISOString() });

    const supa = getSupabaseForTenant('bereshit_farm'); // ייקח דרך defineSecret().value()

    const billingDate = new Date().toISOString().slice(0, 10);
    const day = new Date().getDate();

    const { data: parents, error } = await supa
      .from('parents')
      .select('uid')
      .eq('billing_day_of_month', day);

    if (error) {
      logger.error('load parents failed', error);
      return;
    }

    logger.info('billing parents', { day, count: parents?.length ?? 0 });

    for (const p of parents ?? []) {
      const { error: rpcError } = await supa.rpc('create_monthly_charge_for_parent', {
        p_parent_uid: p.uid,
        p_billing_date: billingDate,
      });

      if (rpcError) logger.error(`parent ${p.uid} failed`, rpcError as any);
      else logger.info(`created charge for ${p.uid}`);
    }
  }
);

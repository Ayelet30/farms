// services/payments.service.ts
import { Injectable } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseClient,
  dbTenant,
  ensureTenantContextReady,
} from './supabaseClient.service';

/** ========= TYPES ========= **/

// כרטיס אשראי שמור לסליקה
export type PaymentProfile = {
  id: string;
  parent_uid: string;
  brand: string | null;
  last4: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
};

// חיוב ברמת הסליקה (טבלת charges)
export type ChargeRow = {
  id: string;
  parent_uid: string;
  amount_agorot: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending' | 'draft';
  provider_id: string | null;
  created_at: string;
};

// שורת חיוב/טיוטה למסך "חיובים להורה" – מה־VIEW v_parent_charges
export type ParentChargeRow = {
  id: string;
  parent_uid: string;
  parent_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  period_start: string | null;
  period_end: string | null;
  description: string | null;
  charge_amount_agorot: number;
  items_amount_agorot: number;
  office_note?: string | null;

  paid_agorot: number;
  credits_agorot: number;
  remaining_agorot: number;
  status: 'draft' | 'pending' | 'open' | 'partial' | 'paid' | 'failed' | 'cancelled';
  created_at: string;
};

// זיכוי להורה – מטבלת parent_credits
export type ParentCreditRow = {
  id: string;
  parent_uid: string;
  amount_agorot: number;
  reason: string;
  related_charge_id: string | null;
  created_at: string;
  created_by: string | null;
};

/** אופציות לחיובים במסך "חיובים להורה" */
export type ListParentChargesOpts = {
  parentUid?: string | null;    // אם לא מעבירים – כל ההורים
  onlyOpen?: boolean;           // רק חיובים עם יתרה > 0
  limit?: number;
  offset?: number;
};

/** ========= SERVICE ========= **/

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private sb: SupabaseClient;

  constructor() {
    this.sb = getSupabaseClient();
  }

  /** מחזיר client על סכימת הטננט הנוכחי (אחרי bootstrap) */
  private async dbc() {
    await ensureTenantContextReady();
    return dbTenant();
  }

  /* ========== PROFILES (כרטיסי אשראי שמורים) ========== */

  async listProfiles(parentUid: string): Promise<PaymentProfile[]> {
    const dbc = await this.dbc();
    const { data, error } = await dbc
      .from('payment_profiles')
      .select('id,parent_uid,brand,last4,active,is_default,created_at')
      .eq('parent_uid', parentUid)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as PaymentProfile[];
  }

  async setDefault(profileId: string, parentUid: string): Promise<void> {
    const dbc = await this.dbc();

    const clear = await dbc
      .from('payment_profiles')
      .update({ is_default: false })
      .eq('parent_uid', parentUid);
    if (clear.error) throw clear.error;

    const upd = await dbc
      .from('payment_profiles')
      .update({ is_default: true })
      .eq('id', profileId);
    if (upd.error) throw upd.error;
  }

  async deactivate(profileId: string): Promise<void> {
    const dbc = await this.dbc();
    const { error } = await dbc
      .from('payment_profiles')
      .update({ active: false, is_default: false })
      .eq('id', profileId);
    if (error) throw error;
  }

  /* ========== RAW CHARGES (טבלת charges – היסטוריית סליקה) ========== */

  async listProviderCharges(
    parentUid: string,
    limit = 20
  ): Promise<ChargeRow[]> {
    const dbc = await this.dbc();
    const { data, error } = await dbc
      .from('charges')
      .select(
        'id,parent_uid,amount_agorot,currency,status,provider_id,created_at'
      )
      .eq('parent_uid', parentUid)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as ChargeRow[];
  }

  /* ========== PARENT CHARGES OVERVIEW (v_parent_charges) ========== */

  async listParentCharges(
    opts: ListParentChargesOpts
  ): Promise<{ rows: ParentChargeRow[]; count: number | null }> {
    const dbc = await this.dbc();

    const limit = Math.max(1, opts.limit ?? 50);
    const offset = Math.max(0, opts.offset ?? 0);

    let q = dbc
      .from('v_parent_charges')
   .select(
  'id,parent_name,parent_uid,period_start,period_end,description,charge_amount_agorot,items_amount_agorot,office_note,paid_agorot,credits_agorot,remaining_agorot,status,created_at',
  { count: 'exact' }
)

      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (opts.parentUid) {
      q = q.eq('parent_uid', opts.parentUid);
    }

    if (opts.onlyOpen) {
      // חיובים פתוחים = יתרה > 0 ולא בוטל
      q = q.gt('remaining_agorot', 0).neq('status', 'cancelled');
    }

    const { data, error, count } = await q;
    if (error) throw error;

    return {
      rows: (data ?? []) as ParentChargeRow[],
      count: count ?? null,
    };
  }

  /* ========== CREDITS (parent_credits) ========== */

  async listCreditsForParent(parentUid: string): Promise<ParentCreditRow[]> {
    const dbc = await this.dbc();
    const { data, error } = await dbc
      .from('parent_credits')
      .select(
        'id,parent_uid,amount_agorot,reason,related_charge_id,created_at,created_by'
      )
      .eq('parent_uid', parentUid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as ParentCreditRow[];
  }

  async createCreditForParent(payload: {
    parentUid: string;
    amountAgorot: number;
    reason: string;
    relatedChargeId?: string | null;
  }): Promise<ParentCreditRow> {
    const dbc = await this.dbc();

    const { data, error } = await dbc
      .from('parent_credits')
      .insert({
        parent_uid: payload.parentUid,
        amount_agorot: payload.amountAgorot,
        reason: payload.reason,
        related_charge_id: payload.relatedChargeId ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ParentCreditRow;
  }

  /* ========== BULK CHARGE RPC ========== */

  async chargeSelectedParentCharges(payload: {
    parentUid: string;
    chargeIds: string[];
  }): Promise<void> {
    const dbc = await this.dbc();
    const { error } = await dbc.rpc('charge_selected_parent_charges', {
      p_parent_uid: payload.parentUid,
      p_charge_ids: payload.chargeIds,
    });
    if (error) throw error;
  }
}

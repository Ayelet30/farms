// services/payments.service.ts
import { Injectable } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, db, ensureTenantContextReady, requireTenant } from './legacy-compat';

type PaymentProfile = {
  id: string;
  parent_uid: string;
  brand: string | null;
  last4: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
};

type ChargeRow = {
  id: string;
  amount_agorot: number;
  currency: string;
  status: 'succeeded' | 'failed';
  provider_id: string | null;
  created_at: string;
};

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private sb: SupabaseClient;

  constructor() {
    this.sb = getSupabaseClient();
  }

  private async dbc() {
    await ensureTenantContextReady();   // חשוב: שיטה שלנו שמוודאת קונטקסט
    return db();                        // ← שואל בסכימת ה-tenant הנוכחית
  }

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
    return data as any;
  }

  async listCharges(parentUid: string,  limit = 20): Promise<ChargeRow[]> {
    const dbc = await this.dbc();
    const { data, error } = await dbc
      .from('charges')
      .select('id,amount_agorot,currency,status,provider_id,created_at')
      .eq('parent_uid', parentUid)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as any;
  }

  async setDefault(profileId: string, parentUid: string) {
    const dbc = await this.dbc();
    const clear = await dbc.from('payment_profiles')
      .update({ is_default: false })
      .eq('parent_uid', parentUid)
    if (clear.error) throw clear.error;

    const upd = await dbc.from('payment_profiles')
      .update({ is_default: true })
      .eq('id', profileId);
    if (upd.error) throw upd.error;
  }

  async deactivate(profileId: string) {
    const dbc = await this.dbc();
    const { error } = await dbc
      .from('payment_profiles')
      .update({ active: false, is_default: false })
      .eq('id', profileId);
    if (error) throw error;
  }
}

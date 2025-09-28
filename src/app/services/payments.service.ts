// services/payments.service.ts
import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type PaymentProfile = {
  id: string;
  parent_uid: string;
  farm_id: string;
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
    const url = (document.querySelector('meta[name="x-supabase-url"]') as HTMLMetaElement)?.content!;
    const anon = (document.querySelector('meta[name="x-supabase-anon-key"]') as HTMLMetaElement)?.content!;
    this.sb = createClient(url, anon);
  }

  async listProfiles(parentUid: string, farmId: string): Promise<PaymentProfile[]> {
    const { data, error } = await this.sb
      .from('payment_profiles')
      .select('id,parent_uid,farm_id,brand,last4,active,is_default,created_at')
      .eq('parent_uid', parentUid)
      .eq('farm_id', farmId)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data as any;
  }

  async listCharges(parentUid: string, farmId: string, limit = 20): Promise<ChargeRow[]> {
    const { data, error } = await this.sb
      .from('charges')
      .select('id,amount_agorot,currency,status,provider_id,created_at')
      .eq('parent_uid', parentUid)
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as any;
  }

  async setDefault(profileId: string, parentUid: string, farmId: string) {
    // נקה דיפולט קודם
    const clear = await this.sb
      .from('payment_profiles')
      .update({ is_default: false })
      .eq('parent_uid', parentUid)
      .eq('farm_id', farmId);
    if (clear.error) throw clear.error;

    // קבע דיפולט ל־profileId
    const upd = await this.sb.from('payment_profiles').update({ is_default: true }).eq('id', profileId);
    if (upd.error) throw upd.error;
  }

  async deactivate(profileId: string) {
    const { error } = await this.sb.from('payment_profiles').update({ active: false, is_default: false }).eq('id', profileId);
    if (error) throw error;
  }
}

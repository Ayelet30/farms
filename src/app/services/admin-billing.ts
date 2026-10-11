import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { dbPublic, getSupabaseClient } from './legacy-compat';

export type BillingPaymentType = 'setup' | 'monthly' | 'one_time' | 'credit';

@Injectable({ providedIn: 'root' })
export class AdminBillingService {
  private functions = getFunctions();

  async getFarmBillingRows() {
    const { data, error } = await dbPublic()
      .from('v_farm_billing_dashboard')
      .select('*')
      .order('farm_created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async getPayments(filters?: {
    farmId?: string;
    status?: string;
    type?: string;
    month?: string;
  }) {
    let q = dbPublic()
      .from('farm_billing_payments')
      .select(`
        *,
        farm_billing_customers (
          contact_name,
          email,
          phone,
          business_id
        ),
        farms:farm_id (
          name,
          schema_name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(300);

    if (filters?.farmId) q = q.eq('farm_id', filters.farmId);
    if (filters?.status) q = q.eq('status', filters.status);
    if (filters?.type) q = q.eq('payment_type', filters.type);

    if (filters?.month) {
      const from = `${filters.month}-01`;
      const to = new Date(`${filters.month}-01T00:00:00`);
      to.setMonth(to.getMonth() + 1);
      q = q.gte('created_at', from).lt('created_at', to.toISOString().slice(0, 10));
    }

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async getHistory(farmId: string) {
    const { data, error } = await dbPublic()
      .from('farm_billing_payments')
      .select('*')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async uploadReceiptFile(file: File, farmId: string, paymentId?: string) {
    const supabase = getSupabaseClient();
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `${farmId}/${paymentId || 'manual'}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('farm-billing-receipts')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('farm-billing-receipts')
      .getPublicUrl(path);

    return {
      storagePath: path,
      publicUrl: data.publicUrl,
      fileName: file.name,
    };
  }

  async upsertCustomer(payload: any) {
    const fn = httpsCallable(this.functions, 'upsertFarmBillingCustomer');
    const res: any = await fn(payload);
    return res.data;
  }

  async createPaymentLink(payload: {
    farm_id: string;
    customer_id?: string | null;
    amount_agorot: number;
    description: string;
    payment_type: BillingPaymentType;
    billing_day?: number;
  }) {
    const fn = httpsCallable(this.functions, 'createFarmBillingPaymentLink');
    const res: any = await fn(payload);
    return res.data;
  }

  async markPaidManually(payload: any) {
    const fn = httpsCallable(this.functions, 'markFarmBillingPaidManually');
    const res: any = await fn(payload);
    return res.data;
  }

  async stopBilling(payload: {
    farm_id: string;
    customer_id?: string | null;
    stop: boolean;
    reason?: string;
  }) {
    const fn = httpsCallable(this.functions, 'setFarmBillingStopped');
    const res: any = await fn(payload);
    return res.data;
  }

  async cancelPayment(paymentId: string) {
    const fn = httpsCallable(this.functions, 'cancelFarmBillingPayment');
    const res: any = await fn({ paymentId });
    return res.data;
  }

  async resendReceipt(paymentId: string) {
    const fn = httpsCallable(this.functions, 'sendFarmBillingReceipt');
    const res: any = await fn({ paymentId });
    return res.data;
  }
}
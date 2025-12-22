// services/tranzila.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';

type CreateHostedUrlParams = {
  uid: string;
  email: string;
  amountAgorot: number;   // למשל 100 = 1.00 ₪
  orderId: string;        // את יכולה לייצר אצלך: `${uid}-${Date.now()}`
  successPath?: string;   // לדוג': '/payments/success'
  failPath?: string;      // לדוג': '/payments/error'
  tenantSchema?: string | null;
};

type CreateHostedUrlResponse = { url: string };

type ChargeByTokenParams = {
  parentUid: string;
  amountAgorot: number;   // 12000 = 120.00 ₪
  currency?: string;      // ברירת מחדל: 'ILS'
};

export interface TranzilaChargeDirectRequest {
  amountAgorot: number;
  currency_code?: string;
  terminal_name?: string;
  txn_type?: 'debit' | 'credit' | 'verify' | 'force' | 'cancel' | 'reversal' | 'sto';
  payment_plan?: 1 | 6 | 8;
  installments_number?: number;
  vat_percent?: number;
  description?: string;
  card: {
    card_number: string;
    expire_month: number;
    expire_year: number;
    cvv?: string;
    card_holder_id?: string;
    card_holder_name?: string;
  };
  client?: {
    external_id?: string;
    name?: string;
    contact_person?: string;
    id?: string;
    email?: string;
    phone_country_code?: string;
    phone_area_code?: string;
    phone_number?: string;
    address_line_1?: string;
    address_line_2?: string;
    city?: string;
    country_code?: 'IL';
    zip?: string;
  };
}

export interface TranzilaChargeDirectResponse {
  ok: boolean;
  status: number;
  tranzila: any;
}


export interface TranzilaChargeResponse {
  ok: boolean;
  status: number;
  tranzila: any;
}

@Injectable({ providedIn: 'root' })
export class TranzilaService {
  chargeSelectedParentCharges(arg0: { tenantSchema: string; parentUid: string; chargeIds: string[]; secretaryEmail: string; }) {
    throw new Error('Method not implemented.');
  }
  private http = inject(HttpClient);
  // אם יש לך פרוקסי ב־Angular: '/api/**' → לפונקציות/שרת
  private readonly base = '/api';

  async createHostedUrl(params: CreateHostedUrlParams): Promise<string> {
    console.log('TranzilaService.createHostedUrl called with:', params);
    const res = await firstValueFrom(
      this.http.post<CreateHostedUrlResponse>(`${this.base}/createHostedPaymentUrl`, params)
    );
    if (!res?.url) throw new Error('Missing hosted payment URL');
    return res.url;
  }

  savePaymentMethod(args: {
  parentUid: string;
  tenantSchema: string;
  token: string;
  last4?: string | null;
  brand?: string | null;
  expiryMonth?: string | null;
  expiryYear?: string | null;
}) {
  return firstValueFrom(
    this.http.post(`${this.base}/savePaymentMethod`, args)
  );
}

chargeSelectedChargesForParent(args: {
  parentUid: string;
  tenantSchema: string; 
  secretaryEmail: string;
  chargeIds: string[];
}) {
  return firstValueFrom(
    this.http.post(`${this.base}/chargeSelectedChargesForParent`, args)
  );
}

  async chargeByToken(params: ChargeByTokenParams): Promise<any> {
    return firstValueFrom(this.http.post(`${this.base}/chargeByToken`, params));
  }

  getHandshakeToken(): Promise<{ thtk: string }> {
  return firstValueFrom(
    this.http.get<{ thtk: string }>('/api/tranzilaHandshake', {})
  );
}

chargeOnce(body: {
  amountAgorot: number;
  card: { card_number: string; expire_month: number; expire_year: number; cvv: string; card_holder_id?: string; card_holder_name?: string; };
  client?: { name?: string; id?: string; email?: string; phone_country_code?: string; phone_area_code?: string; phone_number?: string; };
}) {
  return this.http.post(`${this.base}/tranzilaCharge`, body);
}

// tranzila.service.ts
recordOneTimePayment(args: {
  parentUid?: string | null;
  tenantSchema?: string | null;
  amountAgorot: number;
  tx: any;
  email?: string | null;
  fullName?: string | null;
}) {
  console.log('3333333333 TranzilaService.recordOneTimePayment called with:', args);
  return firstValueFrom(
    this.http.post('/api/recordOneTimePayment', args)
  );
}






}



// services/tranzila.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type CreateHostedUrlParams = {
  uid: string;
  email: string;
  amountAgorot: number;   // למשל 100 = 1.00 ₪
  orderId: string;        // את יכולה לייצר אצלך: `${uid}-${Date.now()}`
  successPath?: string;   // לדוג': '/payments/success'
  failPath?: string;      // לדוג': '/payments/error'
};

type CreateHostedUrlResponse = { url: string };

type ChargeByTokenParams = {
  parentUid: string;
  amountAgorot: number;   // 12000 = 120.00 ₪
  currency?: string;      // ברירת מחדל: 'ILS'
};

@Injectable({ providedIn: 'root' })
export class TranzilaService {
  private http = inject(HttpClient);
  // אם יש לך פרוקסי ב־Angular: '/api/**' → לפונקציות/שרת
  private readonly base = '/api';

  async createHostedUrl(params: CreateHostedUrlParams): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<CreateHostedUrlResponse>(`${this.base}/createHostedPaymentUrl`, params)
    );
    if (!res?.url) throw new Error('Missing hosted payment URL');
    return res.url;
  }

  async chargeByToken(params: ChargeByTokenParams): Promise<any> {
    return firstValueFrom(this.http.post(`${this.base}/chargeByToken`, params));
  }
}

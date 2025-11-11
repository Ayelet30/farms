// services/tranzila.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class TranzilaService {
  private http = inject(HttpClient);

  async createHostedUrl(params: {
    uid: string; email: string;
    amountAgorot: number; orderId: string;
    successPath?: string; failPath?: string;
  }): Promise<string> {
    console.log('createHostedUrl:', params);
    const r: any = await this.http.post('/api/createHostedPaymentUrl', params).toPromise();
    return r.url as string;
  }

  async chargeByToken(params: {
    parentUid: string; amountAgorot: number; currency?: string;
  }): Promise<any> {
    return await this.http.post('/api/chargeByToken', params).toPromise();
  }
}

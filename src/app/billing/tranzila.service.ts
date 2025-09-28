import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';


@Injectable({ providedIn: 'root' })
export class TranzilaService {
private http = inject(HttpClient);


async createHostedUrl(params: { uid: string; email: string; farmId: string; amountAgorot: number; orderId: string; }): Promise<string> {
const r: any = await this.http.post('/api/createHostedPaymentUrl', params).toPromise();
return r.url as string;
}


async chargeByToken(params: { parentUid: string; farmId: string; amountAgorot: number; currency?: string; }) {
return await this.http.post('/api/chargeByToken', params).toPromise();
}
}
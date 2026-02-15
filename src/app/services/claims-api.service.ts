// src/app/services/claims-api.service.ts
import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type ClaimOpenItem = {
  lesson_id: string;
  occur_date: string; // YYYY-MM-DD

  insuredId: string;
  insuredFirstName: string;
  insuredLastName: string;

  sectionCode: number;
  careCode: number;
  careDate: string; // DDMMYYYY
  doctorId: number;

  clinicId?: number;
  onlineServiceType?: number;
};

export type OpenClaimsPayload = {
  schema: string;
  items: ClaimOpenItem[];
};

export type OpenClaimsResult = {
  results: Array<{
    lesson_id: string;
    occur_date: string;
    ok: boolean;
    resultCode?: number;
    claimNumber?: string;
    answerDetails?: string;
    errorDescription?: string;
    rawResponseXml?: string;
  }>;
};

@Injectable({ providedIn: 'root' })
export class ClaimsApiService {
  private fn = getFunctions();

  async openClaimsClalit(payload: OpenClaimsPayload): Promise<OpenClaimsResult> {
    const call = httpsCallable<OpenClaimsPayload, OpenClaimsResult>(this.fn, 'openClaimsClalit');
    const res = await call(payload);
    return res.data;
  }
}

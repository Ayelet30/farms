import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';

import {
  ensureTenantContextReady,
} from './legacy-compat';

import {
  requireTenant,
} from './supabaseClient.service';

@Injectable({
  providedIn: 'root',
})
export class PayrollApiService {
  private readonly apiUrl =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/bereshitPayrollApi';

  async call<T = any>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    await ensureTenantContextReady();

    const tenant = requireTenant();

    const tenantId = String(tenant.id ?? '').trim();
    const tenantSchema = String(tenant.schema ?? '').trim();

    if (!tenantId || !tenantSchema) {
      throw new Error(
        'לא נמצאה חווה פעילה. יש לבחור חווה ולהתחבר מחדש.',
      );
    }

    const user = getAuth().currentUser;

    if (!user) {
      throw new Error(
        'לא נמצא משתמש מחובר. יש להתחבר מחדש.',
      );
    }

    const token = await user.getIdToken();

    const response = await fetch(this.apiUrl, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },

      body: JSON.stringify({
        ...payload,
        action,
        tenantId,
        tenantSchema,
      }),
    });

    const responseText = await response.text();

    let result: any;

    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `השרת החזיר תשובה לא תקינה (${response.status}).`,
      );
    }

    if (!response.ok || result?.ok !== true) {
      const message =
        result?.error ??
        result?.message ??
        'הפעולה נכשלה.';

      throw new Error(String(message));
    }

    return result.result as T;
  }
}
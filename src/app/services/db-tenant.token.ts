import { InjectionToken } from '@angular/core';
import { dbTenant } from './supabaseClient.service';

export const DB_TENANT = new InjectionToken<any>('DB_TENANT', {
  providedIn: 'root',
  factory: () => dbTenant, // ברירת מחדל - האמיתי
});

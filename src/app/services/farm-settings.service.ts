// src/app/services/farm-settings.service.ts
import { Injectable } from '@angular/core';
import { dbTenant } from './supabaseClient.service';

export interface FarmSettings {
  registration_fee?: number | null;
  operating_hours_start?: string | null;
  operating_hours_end?: string | null;
  lesson_duration_minutes?: number | null;

  // NEW
  monthly_billing_day?: number | null;
  timezone?: string | null;
  working_days?: number[] | null;
  time_slot_minutes?: number | null;

  cancel_before_hours?: number | null;
  late_cancel_policy?: 'CHARGE_FULL' | 'CHARGE_PARTIAL' | 'NO_CHARGE' | 'NO_MAKEUP' | null;
  late_cancel_fee_amount?: number | null;
  late_cancel_fee_percent?: number | null;

  makeup_allowed_days_ahead?: number | null;
  attendance_default?: 'ASSUME_ATTENDED' | 'ASSUME_ABSENT' | 'REQUIRE_MARKING' | null;

  send_lesson_reminder?: boolean | null;
  reminder_hours_before?: number | null;
  reminder_channel?: 'EMAIL' | 'SMS' | 'APP' | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;

  enable_discounts?: boolean | null;
  late_payment_fee?: number | null;
  interest_percent_monthly?: number | null;
}


@Injectable({ providedIn: 'root' })
export class FarmSettingsService {

  private cache: FarmSettings | null = null;
  private loadingPromise: Promise<FarmSettings | null> | null = null;

  async loadSettings(forceReload = false): Promise<FarmSettings | null> {
    if (this.cache && !forceReload) {
      return this.cache;
    }

    if (this.loadingPromise && !forceReload) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('farm_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('FarmSettingsService.loadSettings failed', error);
        throw error;
      }

      this.cache = data ?? null;
      return this.cache;
    })();

    return this.loadingPromise;
  }

  /**
   * קיצור דרך לשליפה ישירה של registration_fee
   */
  async getRegistrationFee(): Promise<number> {
    const settings = await this.loadSettings();
    return settings?.registration_fee ?? 0;
  }

  clearCache() {
    this.cache = null;
    this.loadingPromise = null;
  }
}

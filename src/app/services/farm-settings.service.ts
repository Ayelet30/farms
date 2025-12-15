// src/app/services/farm-settings.service.ts
import { Injectable } from '@angular/core';
import { dbTenant } from './supabaseClient.service';

export interface FarmSettings {
  registration_fee?: number | null;
  operating_hours_start?: string | null;
  operating_hours_end?: string | null;
  lesson_duration_minutes?: number | null;
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

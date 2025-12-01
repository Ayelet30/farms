import { Injectable } from '@angular/core';
import { dbTenant } from './supabaseClient.service';

@Injectable({ providedIn: 'root' })
export class FarmSettingsService {

  async loadSettings() {
    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('farm_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }
}

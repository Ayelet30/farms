// src/app/services/booking-data.service.ts
import { Injectable } from '@angular/core';
import { dbPublic } from '../services/supabaseClient.service';

export type FarmOption = {
  id: string;
  name: string;
  tenantSchema: string; 
};


@Injectable({ providedIn: 'root' })
export class BookingDataService {
  async loadFarmsByRidingType(code: string): Promise<FarmOption[]> {
    const client = dbPublic(); // להתאים לשם שיש אצלך

    const { data, error } = await client
      .rpc('get_farms_with_riding_type', { p_code: code });

    if (error) {
      console.error('get_farms_with_riding_type error', error);
      throw error;
    }


    return (data ?? []).map((row: any) => ({
  id: row.farm_id,
  name: row.farm_name,
  tenantSchema: row.tenant_schema,  // 👈 לא schema_name
}));
  }
}

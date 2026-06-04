// enum-options.service.ts

import { Injectable } from '@angular/core';
import { dbTenant } from './supabaseClient.service';
export interface DbOption {
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class EnumOptionsService {

  async getServiceCategories(): Promise<DbOption[]> {
    const supabase = dbTenant();

    const { data, error } = await supabase
      .from('service_category_options')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;

    return data ?? [];
  }

  async getServiceModes(): Promise<DbOption[]> {
    const supabase = await dbTenant();

    const { data, error } = await supabase
      .from('service_mode_options')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;

    return data ?? [];
  }
  async getRiderServiceStatuses() {
    const db = dbTenant();

    const { data, error } = await db
      .from('rider_service_status_options')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;

    return data ?? [];
  }
  async getRecurrenceUnits(): Promise<DbOption[]> {
    const supabase = await dbTenant();

    const { data, error } = await supabase
      .from('recurrence_unit_options')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;

    return data ?? [];
  }
  async getRiderServiceTaskStatuses(): Promise<DbOption[]> {
    const db = dbTenant();

    const { data, error } = await db
      .from('rider_service_task_status_options')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;

    return data ?? [];
  }

}
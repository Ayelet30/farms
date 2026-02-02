import { Injectable } from '@angular/core';
import { ensureTenantContextReady, dbTenant } from '../services/legacy-compat';
import { RidingType, WaitlistEntry, WaitlistStatus } from '../Types/waitlist.types';
// import { co } from '@fullcalendar/core/internal-common';

@Injectable({ providedIn: 'root' })
export class WaitlistService {

  async listRidingTypes(): Promise<RidingType[]> {
    await ensureTenantContextReady();
    const { data, error } = await dbTenant()
      .from('riding_types')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    return (data ?? []) as RidingType[];
  }

  async listEntriesByType(params: {
    ridingTypeId: string;
    statuses?: WaitlistStatus[];
    requestedDay?: string; // yyyy-mm-dd
  }): Promise<WaitlistEntry[]> {
    await ensureTenantContextReady();

    let q = dbTenant()
      .from('waitlist_entries')
      .select('*')
      .eq('riding_type_id', params.ridingTypeId);

      if (params.statuses?.length) q = q.in('status', params.statuses);
      if (params.requestedDay) q = q.eq('requested_day', params.requestedDay);
      
      // סדר מומלץ לצוות
      q = q.order('priority', { ascending: false })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
      
      const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as WaitlistEntry[];
  }

  async listMyEntries(parentUid: string): Promise<WaitlistEntry[]> {
    await ensureTenantContextReady();
    const { data, error } = await dbTenant()
      .from('waitlist_entries')
      .select('*')
      .eq('parent_uid', parentUid)
      .in('status', ['active','paused','offered'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as WaitlistEntry[];
  }

  async addEntry(payload: {
    parentUid: string;
    childUuid: string;
    ridingTypeId: string;
    requestedDay?: string | null;
    timeWindowStart?: string | null;
    timeWindowEnd?: string | null;
    preferredInstructorUid?: string | null;
    preferredArenaId?: string | null;
    preferredHorseId?: string | null;
    notes?: string | null;
  }): Promise<string> {
    await ensureTenantContextReady();
    const { data, error } = await dbTenant().rpc('waitlist_add_entry', {
      p_parent_uid: payload.parentUid,
      p_child_uuid: payload.childUuid,
      p_riding_type_id: payload.ridingTypeId,
      p_requested_day: payload.requestedDay ?? null,
      p_time_window_start: payload.timeWindowStart ?? null,
      p_time_window_end: payload.timeWindowEnd ?? null,
      p_preferred_instructor_uid: payload.preferredInstructorUid ?? null,
      p_preferred_arena_id: payload.preferredArenaId ?? null,
      p_preferred_horse_id: payload.preferredHorseId ?? null,
      p_notes: payload.notes ?? null,
    });

    if (error) throw error;
    return data as string;
  }

  async setStatus(entryId: string, status: WaitlistStatus): Promise<void> {
    await ensureTenantContextReady();
    const { error } = await dbTenant()
      .from('waitlist_entries')
      .update({ status })
      .eq('id', entryId);
    if (error) throw error;
  }

  async setLastContacted(entryId: string): Promise<void> {
    await ensureTenantContextReady(); 
    const { error } = await dbTenant()
      .from('waitlist_entries')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', entryId);
    if (error) throw error;
  }

  async moveEntry(entryId: string, beforeId: string | null, afterId: string | null): Promise<void> {
    await ensureTenantContextReady();
    const { error } = await dbTenant().rpc('waitlist_move_entry', {
      p_entry_id: entryId,
      p_before_id: beforeId,
      p_after_id: afterId,
    });
    if (error) throw error;
  }

  async setPriority(entryId: string, priority: number): Promise<void> {
    await ensureTenantContextReady();
    const { error } = await dbTenant().rpc('waitlist_set_priority', {
      p_entry_id: entryId,
      p_priority: priority,
    });
    if (error) throw error;
  }

  async normalize(ridingTypeId: string): Promise<void> {
    await ensureTenantContextReady();
    const { error } = await dbTenant().rpc('waitlist_normalize_positions', {
      p_riding_type_id: ridingTypeId,
    });
    if (error) throw error;
  }
}

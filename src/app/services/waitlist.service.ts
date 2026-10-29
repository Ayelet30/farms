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
      .in('status', ['active', 'paused', 'offered'])
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


  // כל בקשות ההמתנה בחווה - ללא סינון לפי סוג רכיבה
  async listAllEntries(): Promise<WaitlistEntry[]> {
    await ensureTenantContextReady();

    const { data, error } = await dbTenant()
      .from('waitlist_entries')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('priority', { ascending: false })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data ?? []) as WaitlistEntry[];
  }

  // שינוי עדיפות - הילד עובר לסוף העדיפות החדשה
  async changeWaitlistPriority(
    entryId: string,
    priority: 0 | 1 | 2
  ): Promise<void> {
    await ensureTenantContextReady();

    const { error } = await dbTenant().rpc(
      'waitlist_change_priority',
      {
        p_entry_id: entryId,
        p_new_priority: priority
      }
    );

    if (error) throw error;
  }

  // שינוי מיקום בתוך אותה קבוצת עדיפות
  async reorderWaitlistEntry(
    entryId: string,
    targetPosition: number
  ): Promise<void> {
    await ensureTenantContextReady();

    const { error } = await dbTenant().rpc(
      'waitlist_reorder_within_priority',
      {
        p_entry_id: entryId,
        p_target_position: targetPosition
      }
    );

    if (error) throw error;
  }

  // השהיה או החזרה לרשימה הפעילה
  async changeWaitlistStatus(
    entryId: string,
    status: 'active' | 'paused'
  ): Promise<void> {
    await ensureTenantContextReady();

    const { error } = await dbTenant().rpc(
      'waitlist_change_status',
      {
        p_entry_id: entryId,
        p_new_status: status
      }
    );

    if (error) throw error;
  }

  // מחיקה קבועה של בקשת המתנה
  async deleteWaitlistRequest(
    entryId: string
  ): Promise<void> {
    await ensureTenantContextReady();

    const { error } = await dbTenant().rpc(
      'waitlist_delete_request',
      {
        p_entry_id: entryId
      }
    );

    if (error) throw error;
  }


  // טעינת שמות הילדים לפי המזהים שברשימת ההמתנה
  async listChildNames(
    childIds: string[]
  ): Promise<Record<string, string>> {

    await ensureTenantContextReady();

    const uniqueIds = [...new Set(childIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
      return {};
    }

    const namesById: Record<string, string> = {};

    // חלוקה לקבוצות כדי לא לשלוח שאילתה ארוכה מדי
    for (let i = 0; i < uniqueIds.length; i += 200) {
      const batch = uniqueIds.slice(i, i + 200);

      const { data, error } = await dbTenant()
        .from('children')
        .select('child_uuid, first_name, last_name')
        .in('child_uuid', batch);

      if (error) throw error;

      for (const child of data ?? []) {
        const fullName = [
          child.first_name,
          child.last_name
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        namesById[child.child_uuid] =
          fullName || 'שם לא מעודכן';
      }
    }

    return namesById;
  }

  // =====================================
  // WAITLIST - ALL FARM CHILDREN
  // =====================================

  async listAllFarmChildren(): Promise<{
    child_uuid: string;
    parent_uid: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
  }[]> {
    await ensureTenantContextReady();

    const allChildren: any[] = [];
    const pageSize = 500;
    let from = 0;

    while (true) {
      const { data, error } = await dbTenant()
        .from('children')
        .select(
          'child_uuid, parent_uid, first_name, last_name, birth_date'
        )
        .order('child_uuid', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      allChildren.push(...(data ?? []));

      if (!data || data.length < pageSize) break;

      from += pageSize;
    }

    return allChildren;
  }

  // ==========================================
  // WAITLIST - FILTER DATA
  // ==========================================

  async loadWaitlistFilterData(): Promise<{
    ridingTypes: { id: string; name: string }[];
    instructors: {
      id_number: string;
      name: string;
    }[];
    ridingTypesByEntry: Record<string, string[]>;
    instructorsByEntry: Record<string, string[]>;
  }> {
    await ensureTenantContextReady();

    const db = dbTenant();

    const [
      ridingResult,
      instructorResult,
      entryRidingResult,
      entryInstructorResult
    ] = await Promise.all([
      db
        .from('riding_types')
        .select('id, name')
        .eq('is_active', true)
        .order('name'),

      db
        .from('instructors')
        .select('id_number, first_name, last_name')
        .order('first_name'),

      db
        .from('waitlist_entry_riding_types')
        .select('waitlist_entry_id, riding_type_id'),

      db
        .from('waitlist_entry_instructors')
        .select('waitlist_entry_id, instructor_id_number')
    ]);

    if (ridingResult.error) throw ridingResult.error;
    if (instructorResult.error) throw instructorResult.error;
    if (entryRidingResult.error) throw entryRidingResult.error;
    if (entryInstructorResult.error) throw entryInstructorResult.error;

    const ridingTypesByEntry: Record<string, string[]> = {};
    const instructorsByEntry: Record<string, string[]> = {};

    for (const row of entryRidingResult.data ?? []) {
      if (!ridingTypesByEntry[row.waitlist_entry_id]) {
        ridingTypesByEntry[row.waitlist_entry_id] = [];
      }

      ridingTypesByEntry[row.waitlist_entry_id]
        .push(row.riding_type_id);
    }

    for (const row of entryInstructorResult.data ?? []) {
      if (!instructorsByEntry[row.waitlist_entry_id]) {
        instructorsByEntry[row.waitlist_entry_id] = [];
      }

      instructorsByEntry[row.waitlist_entry_id]
        .push(row.instructor_id_number);
    }

    return {
      ridingTypes: ridingResult.data ?? [],
      instructors: (instructorResult.data ?? []).map((i: {
        id_number: string;
        first_name: string | null;
        last_name: string | null;
      }) => ({
        id_number: i.id_number,
        name: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
      })),
      ridingTypesByEntry,
      instructorsByEntry
    };
  }


  // ==========================================
  // WAITLIST - EDIT EXISTING REQUEST
  // ==========================================

  async getWaitlistEntryForEdit(entryId: string) {
    await ensureTenantContextReady();

    const db = dbTenant();

    const [
      entryResult,
      ridingResult,
      instructorResult,
      availabilityResult
    ] = await Promise.all([
      db
        .from('waitlist_entries')
        .select('*')
        .eq('id', entryId)
        .single(),

      db
        .from('waitlist_entry_riding_types')
        .select('riding_type_id')
        .eq('waitlist_entry_id', entryId),

      db
        .from('waitlist_entry_instructors')
        .select('instructor_id_number')
        .eq('waitlist_entry_id', entryId),

      db
        .from('waitlist_entry_availability')
        .select('day_of_week, all_day, time_from, time_to')
        .eq('waitlist_entry_id', entryId)
        .order('day_of_week')
    ]);

    if (entryResult.error) throw entryResult.error;
    if (ridingResult.error) throw ridingResult.error;
    if (instructorResult.error) throw instructorResult.error;
    if (availabilityResult.error) throw availabilityResult.error;

    return {
      entry: entryResult.data as WaitlistEntry,


      ridingTypeIds: (ridingResult.data ?? [])
        .map((row: { riding_type_id: string }) =>
          row.riding_type_id
        ),

      instructorIds: (instructorResult.data ?? [])
        .map((row: { instructor_id_number: string }) =>
          row.instructor_id_number
        ),


      availability: availabilityResult.data ?? []
    };
  }

  async updateWaitlistRequest(
    payload: {
      entryId: string;
      priority: 0 | 1 | 2;
      allRidingTypes: boolean;
      ridingTypeIds: string[];
      allInstructors: boolean;
      instructorIds: string[];
      allTimes: boolean;
      availability: {
        day: number;
        allDay: boolean;
        from: string | null;
        to: string | null;
      }[];
      notes: string | null;
    }
  ): Promise<string> {

    await ensureTenantContextReady();

    const { data, error } = await dbTenant().rpc(
      'waitlist_update_request',
      {
        p_entry_id: payload.entryId,
        p_priority: payload.priority,
        p_all_riding_types: payload.allRidingTypes,
        p_riding_type_ids: payload.allRidingTypes
          ? []
          : payload.ridingTypeIds,
        p_all_instructors: payload.allInstructors,
        p_instructor_ids: payload.allInstructors
          ? []
          : payload.instructorIds,
        p_all_times: payload.allTimes,
        p_availability: payload.allTimes
          ? []
          : payload.availability,
        p_notes: payload.notes
      }
    );

    if (error) throw error;

    if (data !== payload.entryId) {
      throw new Error(
        'עדכון הבקשה לא החזיר את מזהה הרשומה הצפוי'
      );
    }

    return data;
  }


}

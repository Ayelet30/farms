export interface SavedMatchingRun {
  id: string;
  completed_at: string;
  candidates: WeeklyMatchingCandidate[];
}
import { Injectable } from '@angular/core';
import {
  dbTenant,
  ensureTenantContextReady
} from './legacy-compat';

export interface MatchingWarning {
  date: string;
  reason: string;
  severity?: 'warning' | 'blocked' | 'skipped' | 'info';
  message?: string;
  conflicting_lessons?: {
    lesson_id: string;
    lesson_type: string;
    appointment_kind: string;
    start_time: string;
    end_time: string;
  }[];
}

export interface MatchingParticipant {
  child_uuid: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  birth_date: string | null;
  age: number | null;
}

export interface WeeklyMatchingCandidate {
  request_id: string;
  request_source: 'internal' | 'external';
  priority: number;
  queue_position: number | string | null;
  series_start_date: string;
  day_of_week: number;
  instructor_id: string;
  start_time: string;
  end_time: string;
  riding_type_id: string;
  riding_type: string;
  initial_slot_kind: 'existing_group' | 'new_slot';
  forecast_end_date: string;
  checked_weeks: number;
  available_weeks: number;
  skipped_weeks: number;
  warning_weeks: number;
  blocked_weeks: number;
  unverified_weeks: number;
  warnings: MatchingWarning[];
  group_participants: MatchingParticipant[];
  is_viable_candidate: boolean;
  requires_secretary_review: boolean;
}

export interface SavedMatchingRun {
  id: string;
  completed_at: string;
  candidates: WeeklyMatchingCandidate[];
}

@Injectable({ providedIn: 'root' })
export class MatchingService {

  async searchWeeklyMatches(
    fromDate: string,
    initialSearchDays = 14
  ): Promise<WeeklyMatchingCandidate[]> {

    await ensureTenantContextReady();

    const { data, error } = await dbTenant().rpc(
      'matching_weekly_series_candidates',
      {
        p_from_date: fromDate,
        p_initial_search_days: initialSearchDays
      }
    );

    if (error) {
      throw error;
    }

    return (data ?? []) as WeeklyMatchingCandidate[];
  }

  async loadLatestRun(): Promise<SavedMatchingRun | null> {
    await ensureTenantContextReady();

    const { data, error } = await dbTenant().rpc('matching_load_latest_run');
    if (error) throw error;

    return data as SavedMatchingRun | null;
  }

  async searchAndSaveRun(): Promise<SavedMatchingRun> {
    await ensureTenantContextReady();

    const { data, error } = await dbTenant().rpc('matching_search_and_save_run');
    if (error) throw error;
    if (!data) throw new Error('השרת לא החזיר תוצאות להרצה.');

    return data as SavedMatchingRun;
  }

}

import { Injectable, inject } from '@angular/core';
import { dbTenant } from './supabaseClient.service'; // אצלך כבר קיים
// אם אין - תחליפי ב-client שאת עובדת איתו

export type SeriesRequestRow = {
  id: string;
  child_id: string;
  instructor_id_number: string;
  series_start_date: string; // ISO date
  start_time: string;        // HH:MM:SS
  is_open_ended: boolean;
  repeat_weeks: number | null;
  payment_source: string;
  status: 'pending' | 'approved' | 'rejected';
  decision_note?: string | null;
};

@Injectable({ providedIn: 'root' })
export class SeriesRequestsService {
  private supabase = dbTenant(); // שימי לב: אצלך זה tenant-aware

  async listPending(): Promise<SeriesRequestRow[]> {
    const { data, error } = await this.supabase
      .from('series_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as SeriesRequestRow[];
  }

  async approve(requestId: string, decidedByUid: string, note: string) {
    const { data, error } = await this.supabase.rpc('approve_new_series_request', {
      p_request_id: requestId,
      p_decided_by_uid: decidedByUid,
      p_decision_note: note,
    });
    if (error) throw error;
    return data; // מחזיר טבלה (ok/deny_reason/lesson_id/...)
  }

  async reject(requestId: string, decidedByUid: string, note: string) {
    const { error } = await this.supabase.rpc('reject_new_series_request', {
      p_request_id: requestId,
      p_decided_by_uid: decidedByUid,
      p_decision_note: note,
    });
    if (error) throw error;
  }
}

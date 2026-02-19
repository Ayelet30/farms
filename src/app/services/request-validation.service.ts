// src/app/secretarial-requests-page/services/request-validation.service.ts
import { Injectable } from '@angular/core';

import {
  ensureTenantContextReady,
  dbTenant,
} from './supabaseClient.service';

import {
  RequestType,
  UiRequest,
} from '../Types/detailes.model';

// =====================================
// Types
// =====================================
export enum Check {
  Expiry = 'expiry',
  Requester = 'requester',
  Child = 'child',
  Instructor = 'instructor',
  ParentTarget = 'parentTarget',
  FarmDayOff = 'farmDayOff',
}

export type ValidationMode = 'auto' | 'approve' | 'reject';
export type ValidationResult = { ok: true } | { ok: false; reason: string };

type RequesterRole = 'parent' | 'instructor' | 'secretary' | 'admin' | 'manager';

type RequestRule = {
  checks: Check[];
  allowedChildStatuses?: Set<string>;
};

// =====================================
// Service
// =====================================
@Injectable({ providedIn: 'root' })
export class RequestValidationService {
  // ✅ פה נשמרים החוקים – כמו שהיה לך בקומפוננטה
  private readonly REQUEST_RULES: Record<RequestType, RequestRule> = {
    CANCEL_OCCURRENCE: {
      checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor],
      allowedChildStatuses: new Set([
        'Active',
        'Deletion Scheduled',
        'Pending Deletion Approval',
      ]),
    },

    INSTRUCTOR_DAY_OFF: {
      checks: [Check.Expiry, Check.Requester, Check.Instructor, Check.FarmDayOff],
    },

    NEW_SERIES: {
      checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor, Check.FarmDayOff],
      allowedChildStatuses: new Set([
        'Active',
        'Deletion Scheduled',
        'Pending Deletion Approval',
      ]),
    },

    MAKEUP_LESSON: {
      checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor, Check.FarmDayOff],
      allowedChildStatuses: new Set([
        'Active',
        'Deletion Scheduled',
        'Pending Deletion Approval',
      ]),
    },

    FILL_IN: {
      checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor, Check.FarmDayOff],
      allowedChildStatuses: new Set([
        'Active',
        'Deletion Scheduled',
        'Pending Deletion Approval',
      ]),
    },

    ADD_CHILD: {
      checks: [Check.Expiry, Check.Requester, Check.ParentTarget, Check.Child],
      allowedChildStatuses: new Set(['Pending Addition Approval']),
    },

    DELETE_CHILD: {
      checks: [Check.Expiry, Check.Requester, Check.Child],
      allowedChildStatuses: new Set(['Pending Deletion Approval']),
    },

    PARENT_SIGNUP: { checks: [] },
    OTHER_REQUEST: { checks: [] },
  };

  // =====================================
  // Public API
  // =====================================
  async validate(row: UiRequest, mode: ValidationMode = 'auto'): Promise<ValidationResult> {
    return await this.validateRequestByRules(row, mode);
  }

  // =====================================
  // Core validation engine
  // =====================================
  private getRulesFor(row: UiRequest): RequestRule {
    const type = row.requestType as RequestType;
    return this.REQUEST_RULES[type] ?? { checks: [Check.Requester] };
  }
private normalizeResult(
  r: { ok: boolean; reason?: string }
): ValidationResult {
  if (r.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: r.reason ?? 'הבקשה אינה תקפה',
  };
}

  private async validateRequestByRules(
  row: UiRequest,
  mode: ValidationMode
): Promise<ValidationResult> {

    if (!row) return { ok: false, reason: 'בקשה לא תקינה' };

    const rules = this.getRulesFor(row);

    await ensureTenantContextReady();
    const db = dbTenant();

   for (const check of rules.checks) {
  let r: ValidationResult | null = null;

  switch (check) {
 case Check.Expiry: {
  // 🔁 תמיד רענון נתונים מה-DB לפני approve/reject
  if (mode !== 'auto') {
    try {
      // ===== CANCEL_OCCURRENCE =====
      if (row.requestType === 'CANCEL_OCCURRENCE') {
        const fresh = await this.getFreshCancelOccurrenceDateTime(db, row, mode);

        const dateStr = fresh?.dateStr ?? (row.payload?.occur_date ?? row.fromDate ?? null);
        const timeStr = fresh?.timeStr ?? null;

        if (dateStr) {
          const dt = this.combineDateTime(dateStr, timeStr ?? '00:00');
          if (dt.getTime() < Date.now()) {
            return { ok: false, reason: 'עבר מועד השיעור לביטול' };
          }
        }
      }

      // ===== MAKEUP / FILL_IN =====
 // ===== MAKEUP / FILL_IN =====
if (row.requestType === 'MAKEUP_LESSON' || row.requestType === 'FILL_IN') {
  const p: any = row.payload ?? {};
  const dateStr = (row.fromDate ?? p.occur_date ?? p.from_date ?? null);
  const startStr = this.normalizeHHMM(p.requested_start_time ?? p.start_time ?? p.startTime ?? null);

  if (dateStr && startStr) {
    const dt = this.combineDateTime(String(dateStr).slice(0, 10), startStr);
    if (dt.getTime() < Date.now()) {
      return { ok: false, reason: 'עבר מועד השיעור המבוקש' };
    }
  }
}


    } catch (e:any) {
      return this.handleDbFailure(mode, 'expiry fresh check', e);
    }
  }

  // fallback רגיל (כמו שהיה)
  const expiryReason = this.getExpiryReason(row);
  if (expiryReason) return { ok: false, reason: expiryReason };
  break;
}


    case Check.Requester: {
      r = this.normalizeResult(
        await this.checkRequesterActive(db, row, mode)
      );
      break;
    }

    case Check.Child: {
      r = this.normalizeResult(
        await this.checkChildActive(
          db,
          row,
          mode,
          rules.allowedChildStatuses
        )
      );
      break;
    }

    case Check.Instructor: {
      r = this.normalizeResult(
        await this.checkInstructorActive(db, row, mode)
      );
      break;
    }

    case Check.ParentTarget: {
      r = this.normalizeResult(
        await this.checkParentActive(db, row, mode)
      );
      break;
    }

    case Check.FarmDayOff: {
      r = this.normalizeResult(
        await this.checkFarmDayOffConflict(db, row, mode)
      );
      break;
    }
  }

  if (r && !r.ok) return r;
}


    return { ok: true };
  }

  // =====================================
  // DB-failure handling
  // =====================================
  private isDbFailure(err: any): boolean {
    const msg = String(err?.message ?? err ?? '').toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('500') ||
      msg.includes('400') ||
      msg.includes('jwt') ||
      msg.includes('permission') ||
      msg.includes('rls') ||
      msg.includes('schema') ||
      msg.includes('tenant')
    );
  }

  private handleDbFailure(mode: ValidationMode, context: string, err: any): ValidationResult {
    console.warn(`[VALIDATION][${mode}] ${context} DB failed → skip/restrict`, err);

    // auto: לא חוסמים
    if (mode === 'auto') return { ok: true };

    // approve/reject: חוסמים כדי לא לבצע פעולה לא בטוחה
    return { ok: false, reason: 'לא ניתן לאמת כרגע (שגיאת מערכת). נסי לרענן/להתחבר מחדש.' };
  }

  // =====================================
  // Expiry
  // =====================================
  private getExpiryReason(row: UiRequest): string | null {
    const p: any = row.payload ?? {};
    const now = new Date();

    const isPast = (dateStr: string | null | undefined, timeStr?: string | null): boolean => {
      if (!dateStr) return false;
      const dt = this.combineDateTime(dateStr, timeStr);
      return dt.getTime() < now.getTime();
    };

    switch (row.requestType) {
    case 'CANCEL_OCCURRENCE': {
  const dateStr = p.occur_date ?? row.fromDate ?? null;
  const timeStr = null; // ⚠️ אל תשתמשי בשעה מה-payload כי היא לא תמיד נכונה
  if (isPast(dateStr, timeStr)) return 'עבר מועד השיעור לביטול';
  return null;
}


      case 'INSTRUCTOR_DAY_OFF': {
        const end = row.toDate ?? row.fromDate ?? null;
        if (isPast(end, '23:59')) return 'עבר מועד חופשת המדריך';
        return null;
      }

      case 'NEW_SERIES': {
        const start = row.fromDate ?? p.series_start_date ?? p.start_date ?? null;
        const timeStr = p.requested_start_time ?? p.start_time ?? p.startTime ?? null;
        if (isPast(start, timeStr ?? '00:00')) return 'עבר מועד תחילת הסדרה';
        return null;
      }

      case 'MAKEUP_LESSON':
      case 'FILL_IN': {
        const dateStr = row.fromDate ?? p.occur_date ?? null;
        const timeStr = p.requested_start_time ?? p.start_time ?? p.startTime ?? null;
        if (isPast(dateStr, timeStr)) return 'עבר מועד השיעור המבוקש';
        return null;
      }

      default:
        return null;
    }
  }

  private combineDateTime(dateStr: string, timeStr?: string | null): Date {
    const d = String(dateStr).slice(0, 10);
    const t = (timeStr ?? '00:00').toString().slice(0, 5);
    return new Date(`${d}T${t}:00`);
  }

  // =====================================
  // Request fields helpers
  // =====================================
  private getChildIdForRequest(row: UiRequest): string | null {
    const p: any = row.payload ?? {};
    return row.childId ?? p.child_id ?? p.childId ?? null;
  }

  private getInstructorIdForRequest(row: UiRequest): string | null {
    const p: any = row.payload ?? {};
    return (
      row.instructorId ??
      p.instructor_id_number ??
      p.instructor_id ??
      p.instructorId ??
      null
    );
  }

  private getParentUidForRequest(row: UiRequest): string | null {
    const p: any = row.payload ?? {};
    const uid = row.requesterUid;
    if (uid && uid !== 'PUBLIC') return uid;
    return p.parent_uid ?? p.parent?.uid ?? p.uid ?? null;
  }

  private getRequesterRoleForRequest(row: UiRequest): RequesterRole | null {
    const p: any = row.payload ?? {};
    return (row as any).requesterRole ?? p.requested_by_role ?? p.requestedByRole ?? null;
  }

  // =====================================
  // Checks: Requester / Instructor / Parent / Child
  // =====================================
  private async checkRequesterActive(db: any, row: UiRequest, mode: ValidationMode)
    : Promise<{ ok: boolean; reason?: string }> {

    const uid = row.requesterUid;
    const role = this.getRequesterRoleForRequest(row);

    if (!uid || !role) return { ok: true };

    try {
      switch (role) {
        case 'parent': {
          const { data, error } = await db
            .from('parents')
            .select('is_active')
            .eq('uid', uid)
            .maybeSingle();

          if (error) return this.handleDbFailure(mode, 'checkRequesterActive(parent)', error);
          if (data?.is_active === false) return { ok: false, reason: 'ההורה שהגיש את הבקשה אינו פעיל' };
          return { ok: true };
        }

        case 'instructor': {
          const { data, error } = await db
            .from('instructors')
            .select('status')
            .eq('uid', uid)
            .maybeSingle();

          if (error) return this.handleDbFailure(mode, 'checkRequesterActive(instructor)', error);
          if (!data) return mode === 'auto' ? { ok: true } : { ok: false, reason: 'המדריך מגיש הבקשה לא נמצא במערכת' };
          if (data.status !== 'Active') return { ok: false, reason: `המדריך מגיש הבקשה אינו פעיל (סטטוס: ${data.status})` };
          return { ok: true };
        }

        case 'secretary':
        case 'manager':
        case 'admin':
          return { ok: true };

        default:
          return { ok: true };
      }
    } catch (e: any) {
      return this.handleDbFailure(mode, 'checkRequesterActive', e);
    }
  }

  private async checkInstructorActive(db: any, row: UiRequest, mode: ValidationMode)
    : Promise<{ ok: boolean; reason?: string }> {

    const instructorId = this.getInstructorIdForRequest(row);
    if (!instructorId) return { ok: true };

    try {
      const { data, error } = await db
        .from('instructors')
        .select('status')
        .eq('id_number', instructorId)
        .maybeSingle();

      if (error) {
        const r = this.handleDbFailure(mode, 'checkInstructorActive', error);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      }

      if (!data) return mode === 'auto' ? { ok: true } : { ok: false, reason: 'לא נמצא מדריך במערכת' };

      const status = (data as any)?.status ?? null;
      if (status !== 'Active') return { ok: false, reason: `המדריך אינו פעיל (סטטוס: ${status})` };

      return { ok: true };
    } catch (e: any) {
      const r = this.handleDbFailure(mode, 'checkInstructorActive', e);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
  }

  private async checkParentActive(db: any, row: UiRequest, mode: ValidationMode)
    : Promise<{ ok: boolean; reason?: string }> {

    const parentUid = this.getParentUidForRequest(row);
    if (!parentUid) return { ok: true };

    try {
      const { data, error } = await db
        .from('parents')
        .select('is_active')
        .eq('uid', parentUid)
        .maybeSingle();

      if (error) {
        const r = this.handleDbFailure(mode, 'checkParentActive', error);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      }

      if ((data as any)?.is_active === false) return { ok: false, reason: 'ההורה אינו פעיל' };
      return { ok: true };
    } catch (e: any) {
      const r = this.handleDbFailure(mode, 'checkParentActive', e);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
  }

  private async checkChildActive(db: any, row: UiRequest, mode: ValidationMode, allowedStatuses?: Set<string>)
    : Promise<{ ok: boolean; reason?: string }> {

    const childId = this.getChildIdForRequest(row);
    if (!childId) return { ok: true };

    try {
      const { data, error } = await db
        .from('children')
        .select('status, scheduled_deletion_at')
        .eq('child_uuid', childId)
        .maybeSingle();

      if (error) {
        const r = this.handleDbFailure(mode, 'checkChildActive', error);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      }

      if (!data) return mode === 'auto' ? { ok: true } : { ok: false, reason: 'לא נמצא ילד במערכת' };

      const status = (data as any)?.status ?? null;
      const scheduledDeletionAt = (data as any)?.scheduled_deletion_at ?? null;

      // חוק מיוחד: Deletion Scheduled חוסם MAKEUP/FILL_IN אחרי מועד המחיקה
      if (
        status === 'Deletion Scheduled' &&
        scheduledDeletionAt &&
        (row.requestType === 'MAKEUP_LESSON' || row.requestType === 'FILL_IN')
      ) {
        const p: any = row.payload ?? {};
        const dateStr = row.fromDate ?? p.occur_date ?? p.from_date ?? null;
        const timeStr = p.requested_start_time ?? p.start_time ?? p.startTime ?? '00:00';

        if (dateStr) {
          const reqDt = this.combineDateTime(String(dateStr), String(timeStr));
          const delDt = new Date(String(scheduledDeletionAt));
          if (!isNaN(delDt.getTime()) && reqDt.getTime() >= delDt.getTime()) {
            const delPretty = new Date(delDt).toLocaleString('he-IL');
            return {
              ok: false,
              reason: `הבקשה נדחתה אוטומטית: הילד/ה מתוזמן/ת למחיקה ב-${delPretty}, והשיעור המבוקש לאחר מועד זה.`,
            };
          }
        }
      }

      if (!allowedStatuses || allowedStatuses.size === 0) return { ok: true };

      if (!allowedStatuses.has(status)) {
        if (row.requestType === 'DELETE_CHILD') {
          return { ok: false, reason: `כדי למחוק ילד, הסטטוס חייב להיות Pending Deletion Approval (כרגע: ${status})` };
        }
        return { ok: false, reason: `הילד אינו מתאים לבקשה (סטטוס: ${status})` };
      }

      return { ok: true };
    } catch (e: any) {
      const r = this.handleDbFailure(mode, 'checkChildActive', e);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
  }

  // =====================================
  // Farm day off
  // =====================================
  private normalizeTimeHHMM(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;

    if (s.includes('T')) {
      const timePart = s.split('T')[1] ?? '';
      return timePart.slice(0, 5);
    }

    if (s.length >= 5) return s.slice(0, 5);
    return null;
  }

  private timeToMinutes(hhmm: string): number {
    const [hh, mm] = hhmm.split(':');
    const h = Number(hh);
    const m = Number(mm);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  }

  // חפיפה: [aStart,aEnd) מול [bStart,bEnd)
  private overlapsMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    if (aEnd <= aStart || bEnd <= bStart) return false;
    return aStart < bEnd && bStart < aEnd;
  }

  private getRequestedDateAndWindow(row: UiRequest)
    : { date: string; startMin: number; endMin: number } | null {

    const p: any = row.payload ?? {};

    const date =
      (row.requestType === 'NEW_SERIES'
        ? (row.fromDate ?? p.series_start_date ?? p.start_date ?? null)
        : (row.fromDate ?? p.occur_date ?? p.from_date ?? null)
      );

    if (!date) return null;

    const startHHMM = this.normalizeTimeHHMM(
      p.requested_start_time ?? p.start_time ?? p.startTime ?? p.time ?? null
    );

    // ✅ חשוב: סוף מפורש מה-payload, אחרת fallback 30 דקות
    const endHHMM = this.normalizeTimeHHMM(
      p.requested_end_time ?? p.end_time ?? p.endTime ?? null
    );

    if (!startHHMM) return null;

    const startMin = this.timeToMinutes(startHHMM);
    const endMin = endHHMM ? this.timeToMinutes(endHHMM) : (startMin + 30);

    return { date: String(date).slice(0, 10), startMin, endMin };
  }

  private async checkFarmDayOffConflict(db: any, row: UiRequest, mode: ValidationMode)
    : Promise<{ ok: boolean; reason?: string }> {

    if (!['MAKEUP_LESSON', 'FILL_IN', 'INSTRUCTOR_DAY_OFF', 'NEW_SERIES'].includes(row.requestType)) {
      return { ok: true };
    }

    try {
      // ---------- INSTRUCTOR_DAY_OFF ----------
      if (row.requestType === 'INSTRUCTOR_DAY_OFF') {
        const from = (row.fromDate ?? null)?.slice(0, 10);
        const to = (row.toDate ?? row.fromDate ?? null)?.slice(0, 10);
        if (!from || !to) return { ok: true };

        const p: any = row.payload ?? {};
        const reqStartHHMM = this.normalizeTimeHHMM(p.requested_start_time ?? p.start_time ?? null);
        const reqEndHHMM = this.normalizeTimeHHMM(p.requested_end_time ?? p.end_time ?? null);

        const hasWindow = !!(reqStartHHMM && reqEndHHMM);
        const reqStartMin = hasWindow ? this.timeToMinutes(reqStartHHMM!) : 0;
        const reqEndMin = hasWindow ? this.timeToMinutes(reqEndHHMM!) : 24 * 60;

        const { data, error } = await db
          .from('farm_days_off')
          .select('id, reason, day_type, start_date, end_date, start_time, end_time')
          .eq('is_active', true)
          .lte('start_date', to)
          .gte('end_date', from);

        if (error) {
          const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict(INSTRUCTOR_DAY_OFF)', error);
          return r.ok ? { ok: true } : { ok: false, reason: r.reason };
        }

        const offs = (data ?? []) as any[];
        for (const off of offs) {
          const dayType = String(off.day_type ?? '');

          if (dayType === 'FULL_DAY') {
            return {
              ok: false,
              reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה (יום מלא) שחופף לטווח ${from}–${to}${off.reason ? ` (${off.reason})` : ''}.`,
            };
          }

          const offStart = this.normalizeTimeHHMM(off.start_time);
          const offEnd = this.normalizeTimeHHMM(off.end_time);
          if (!offStart || !offEnd) {
            return { ok: false, reason: `הבקשה נדחתה אוטומטית: יום חופש חווה מוגדר לפי שעות אך חסרות שעות במערכת.` };
          }

          const offStartMin = this.timeToMinutes(offStart);
          const offEndMin = this.timeToMinutes(offEnd);

          // אם אין שעות בבקשה -> נחסום (כי זה יום חופש למדריך בלי חלון -> מתפרש כטווח מלא)
          if (!hasWindow || this.overlapsMinutes(reqStartMin, reqEndMin, offStartMin, offEndMin)) {
            return {
              ok: false,
              reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה שחופף (בתוך הטווח) בין ${offStart}-${offEnd}${off.reason ? ` (${off.reason})` : ''}.`,
            };
          }
        }

        return { ok: true };
      }

      // ---------- MAKEUP / FILL_IN / NEW_SERIES ----------
      const w = this.getRequestedDateAndWindow(row);
      if (!w?.date) return { ok: true };

      const { data, error } = await db
        .from('farm_days_off')
        .select('id, reason, day_type, start_date, end_date, start_time, end_time')
        .eq('is_active', true)
        .lte('start_date', w.date)
        .gte('end_date', w.date);

      if (error) {
        const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict', error);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      }

      const offs = (data ?? []) as any[];
      for (const off of offs) {
        const dayType = String(off.day_type ?? '');

        if (dayType === 'FULL_DAY') {
          return {
            ok: false,
            reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה (יום מלא) בתאריך ${w.date}${off.reason ? ` (${off.reason})` : ''}.`,
          };
        }

        const offStart = this.normalizeTimeHHMM(off.start_time);
        const offEnd = this.normalizeTimeHHMM(off.end_time);
        if (!offStart || !offEnd) {
          return {
            ok: false,
            reason: `הבקשה נדחתה אוטומטית: יום חופש חווה בתאריך ${w.date} מוגדר לפי שעות אך חסרות שעות במערכת.`,
          };
        }

        const offStartMin = this.timeToMinutes(offStart);
        const offEndMin = this.timeToMinutes(offEnd);

        if (this.overlapsMinutes(w.startMin, w.endMin, offStartMin, offEndMin)) {
          return {
            ok: false,
            reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה בתאריך ${w.date} בין ${offStart}-${offEnd}${off.reason ? ` (${off.reason})` : ''}.`,
          };
        }
      }

      return { ok: true };
    } catch (e: any) {
      const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict', e);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
  }
 private async getFreshCancelOccurrenceDateTime(
  db: any,
  row: UiRequest,
  mode: ValidationMode
): Promise<{ dateStr: string | null; timeStr: string | null } | null> {

  if (mode === 'auto') return null;
  const requestId = row?.id;
  if (!requestId) return null;

  const fresh = await this.fetchFreshRequestRow(db, requestId);
  const p = this.parsePayload(fresh?.payload);

  const dateStr = p?.occur_date ? String(p.occur_date).slice(0, 10) : null;

  let timeStr: string | null = null;

  // ⭐ חדש: להביא שעת שיעור אמיתית מהמופע
  if (fresh?.lesson_occ_id) {
    const { data: occ, error: occErr } = await db
      .from('lessons_occurrences')
      .select('start_time')
      .eq('id', fresh.lesson_occ_id)
      .maybeSingle();

    if (!occErr && occ?.start_time) {
      timeStr = String(occ.start_time).slice(0, 5);
    }
  }

  return { dateStr, timeStr };
}

private async fetchFreshRequestRow(db: any, requestId: string) {
  const { data, error } = await db
    .from('secretarial_requests')
    .select('id, request_type, from_date, to_date, payload, lesson_occ_id')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

private parsePayload(p: any): any {
  try {
    if (!p) return {};
    if (typeof p === 'string') return JSON.parse(p);
    return p;
  } catch {
    return {};
  }
}

private normalizeHHMM(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // "10:30:00" -> "10:30"
  return s.length >= 5 ? s.slice(0, 5) : s;
}

}

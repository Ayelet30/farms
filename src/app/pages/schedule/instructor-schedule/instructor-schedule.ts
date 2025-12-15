/* -------------  IMPORTS ------------- */
import {
  Component,
  OnInit,
  ChangeDetectorRef,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import type { EventClickArg } from '@fullcalendar/core';

import { ScheduleItem } from '../../../models/schedule-item.model';
import { Lesson } from '../../../models/lesson-schedule.model';
import { NoteComponent } from '../../Notes/note.component';

import { CurrentUserService } from '../../../core/auth/current-user.service';
import {
  dbTenant,
  ensureTenantContextReady,
} from '../../../services/legacy-compat';

/* ------------ TYPES ------------ */
type UUID = string;
type CalendarView = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';
type RequestType = 'holiday' | 'sick' | 'personal' | 'other';
type RequestStatus = 'pending' | 'approved' | 'rejected';

/** תפקיד במערכת – למדריך/מזכירה */
type RoleInTenant =
  | 'parent'
  | 'instructor'
  | 'secretary'
  | 'manager'
  | 'admin'
  | 'coordinator';

interface Parent {
  uid: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

interface Child {
  child_uuid: UUID;
  first_name?: string;
  last_name?: string;
  birth_date?: string;
  status?: string;
  parent_uid?: string;
  medical_notes?: string | null;
  age?: number;
  parent?: Parent | null;
}

/** ייצוג יומי של בקשה */
interface DayRequestRow {
  id: string;
  instructor_id: string;
  request_date: string; // YYYY-MM-DD
  request_type: RequestType;
  status: RequestStatus;
  note?: string | null;
}

/* ------------ COMPONENT ------------ */
@Component({
  selector: 'app-instructor-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss'],
})
export class InstructorScheduleComponent implements OnInit {
  @ViewChild(ScheduleComponent) scheduleComp!: ScheduleComponent;

  private cdr = inject(ChangeDetectorRef);
  private cu = inject(CurrentUserService);

  instructorId = '';
  loading = false;
  error: string | null = null;

  currentView: CalendarView = 'timeGridWeek';
  currentDate = '';
  isFullscreen = false;

  lessons: Lesson[] = [];
  children: Child[] = [];
  items: ScheduleItem[] = [];
  dayRequests: DayRequestRow[] = [];

  /** ילד שנבחר – לכרטיסיית ההערות */
  selectedChild: Child | null = null;

  /** אוקורנס/שיעור שנבחר – נשלח לכרטיסיית ההערות */
  selectedOccurrence: any = null;

  /** סטטוס נוכחות לשיעור שנבחר (present/absent/null) */
  attendanceStatus: 'present' | 'absent' | null = null;

  /** תפקיד המשתמש – למדריך/מזכירה יש הרשאות עריכה */
  currentUserRole: RoleInTenant = 'instructor';

  private lastRange: { start: string; end: string } | null = null;

  /* ------- תפריט קליק ימני ------- */
  contextMenu = {
    visible: false,
    x: 0,
    y: 0,
    date: '' as string,
  };

  /* ------- מודאל לטווח תאריכים ------- */
  rangeModal = {
    open: false,
    from: '',
    to: '',
    allDay: true,
    fromTime: '',
    toTime: '',
    type: 'holiday' as RequestType,
    text: '',
  };

  /* ------- תפריט אישור/דחייה ------- */
  approvalMenu = {
    open: false,
    x: 0,
    y: 0,
    request: null as DayRequestRow | null,
  };

  /* ------------ INIT ------------ */
  async ngOnInit(): Promise<void> {
    try {
      this.loading = true;
      await ensureTenantContextReady();

      const user = await this.cu.loadUserDetails();
      this.instructorId = String(user?.id_number || '').trim();
      if (!this.instructorId) throw new Error('לא נמצא מזהה מדריך');

      const startYmd = ymd(addDays(new Date(), -14));
      const endYmd = ymd(addDays(new Date(), 60));

      await this.loadLessonsForRange(startYmd, endYmd);

      const childIds = Array.from(
        new Set(this.lessons.map((l) => l.child_id).filter(Boolean)),
      ) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
      }

      await this.loadRequestsForRange(startYmd, endYmd);

      this.setScheduleItems();
      this.updateCurrentDateFromCalendar();
    } catch (err: any) {
      console.error(err);
      this.error = err?.message || 'שגיאה בטעינה';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /* ------------ LOADERS ------------ */
  private async loadLessonsForRange(
    startYmd: string,
    endYmd: string,
  ): Promise<void> {
    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('lessons_occurrences')
      .select(
        `
        lesson_id,
        child_id,
        instructor_id,
        lesson_type,
        status,
        start_datetime,
        end_datetime,
        occur_date,
        start_time,
        end_time
      `,
      )
      .eq('instructor_id', this.instructorId)
      .gte('occur_date', startYmd)
      .lte('occur_date', endYmd);

    if (error) throw error;
    this.lessons = (data ?? []) as Lesson[];
  }

  private async loadChildrenAndRefs(ids: string[]): Promise<void> {
    const dbc = dbTenant();

    const { data: kids, error } = await dbc
      .from('children')
      .select(
        `
        child_uuid,
        first_name,
        last_name,
        birth_date,
        status,
        parent_uid,
        medical_notes
      `,
      )
      .in('child_uuid', ids);

    if (error) throw error;

    const list = (kids ?? []) as Child[];

    const parentIds = Array.from(
      new Set(list.map((c) => c.parent_uid).filter(Boolean)),
    ) as string[];

    let map = new Map<string, Parent>();

    if (parentIds.length) {
      const { data: parentsData } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, email, phone')
        .in('uid', parentIds);

      const parents = (parentsData ?? []) as Parent[];
      map = new Map<string, Parent>(parents.map((p) => [p.uid, p]));
    }

    this.children = list.map((c) => ({
      ...c,
      age: c.birth_date ? calcAge(c.birth_date) : undefined,
      parent: c.parent_uid ? map.get(c.parent_uid) ?? null : null,
    }));
  }

  private async loadRequestsForRange(
    startYmd: string,
    endYmd: string,
  ): Promise<void> {
    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('secretarial_requests')
      .select(
        `
        id,
        instructor_id,
        request_type,
        status,
        from_date,
        to_date,
        payload,
        decision_note
      `,
      )
      .eq('instructor_id', this.instructorId)
      .gte('from_date', startYmd)
      .lte('from_date', endYmd);

    if (error) throw error;

    const rows = data ?? [];
    this.dayRequests = rows.flatMap((row: any) => this.expandRequestRow(row));
  }

  private expandRequestRow(row: any): DayRequestRow[] {
    const res: DayRequestRow[] = [];
    if (!row.from_date) return res;

    const from = new Date(row.from_date);
    const to = new Date(row.to_date || row.from_date);

    const type: RequestType = this.mapDbRequestType(row.payload?.category);
    const status: RequestStatus = this.mapDbStatus(row.status);
    const note: string | null = row.payload?.note ?? row.decision_note ?? null;

    let d = new Date(from);
    while (d <= to) {
      res.push({
        id: row.id,
        instructor_id: row.instructor_id,
        request_date: ymd(d),
        request_type: type,
        status,
        note,
      });
      d.setDate(d.getDate() + 1);
    }

    return res;
  }

  /* ------------ ITEM MAPPING ------------ */
  private setScheduleItems(): void {
    const src = this.lessons;

    // תצוגה חודשית – סיכום יומי
    if (this.currentView === 'dayGridMonth') {
      const grouped: Record<string, Lesson[]> = {};
      for (const l of src) {
        const day = (l as any).occur_date?.slice(0, 10);
        if (!day) continue;
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(l);
      }

      this.items = Object.entries(grouped).map(([day, arr]) => {
        const req = this.getRequestForDate(day);

        const parts: string[] = [];
        const count = arr.length;
        parts.push(`${count} שיעור${count > 1 ? 'ים' : ''}`);

        if (req) {
          parts.push(this.getRequestLabel(req.request_type));
        }

        const item: ScheduleItem = {
          id: day,
          title: parts.join(' | '),
          start: day,
          end: day,
          color: '#ffffff',
          status: 'summary',
        };

        return item;
      });

      this.cdr.detectChanges();
      return;
    }

    // תצוגת שבוע / יום – אירוע לכל שיעור
    this.items = src.map((l: any) => {
      const startISO = this.ensureIso(
        l.start_datetime,
        l.start_time,
        l.occur_date,
      );
      const endISO = this.ensureIso(
        l.end_datetime,
        l.end_time,
        l.occur_date,
      );

      const child = this.children.find((c) => c.child_uuid === l.child_id);
      const name = `${child?.first_name || ''} ${
        child?.last_name || ''
      }`.trim();
      const agePart = child?.age != null ? ` (${child.age})` : '';

      const lessonTypeLabel = this.formatLessonType(l.lesson_type);

      let color = '#b5ead7';
      if (l.status === 'בוטל') color = '#ffcdd2';
      else if (new Date(endISO) < new Date()) color = '#e0e0e0';

      const item: ScheduleItem = {
        id: `${l.lesson_id}_${l.child_id}_${l.occur_date}`,
        title: `${name}${agePart} — ${lessonTypeLabel}`.trim(),
        start: startISO,
        end: endISO,
        color,
        meta: {
          child_id: l.child_id,
          child_name: name,
          instructor_id: l.instructor_id,
          instructor_name: '',
          status: l.status,
          lesson_type: lessonTypeLabel,
        },
        status: l.status as any,
      };

      return item;
    });

    this.cdr.detectChanges();
  }

  private ensureIso(
    datetime?: string | null,
    time?: string | null,
    baseDate?: string | Date | null,
  ): string {
    if (datetime) return datetime;
    const base =
      typeof baseDate === 'string'
        ? new Date(baseDate)
        : baseDate ?? new Date();
    const d = new Date(base);
    if (time) {
      const [hh, mm] = String(time).split(':');
      d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    }
    return d.toISOString();
  }

  /* ------------ EVENTS ------------ */
  /* ------------ EVENTS ------------ */
  onEventClick(arg: EventClickArg): void {
    // ================ DEBUG חזק ================
    console.log(
      '%c[EVENT CLICK] full event →',
      'color: orange; font-size: 14px; font-weight: bold;',
      arg.event
    );
    console.log(
      '%c[EVENT CLICK] extendedProps →',
      'color: blue; font-weight: bold;',
      arg.event.extendedProps
    );

    const ext: any = arg.event.extendedProps || {};
    const raw: any = ext.raw || ext.meta || ext;

    console.log('%c[EVENT CLICK] raw →', 'color: purple;', raw);

    // ננסה להביא child_id מכל מקום אפשרי
    const childId: string | undefined =
      raw.child_id || ext.child_id || raw.child_uuid;

    console.log('%c[EVENT CLICK] childId →', 'color: teal;', childId);

    if (!childId) {
      console.warn('[EVENT CLICK] no child_id found, aborting');
      return;
    }

    // ננסה למצוא lesson_id מכל מקור אפשרי
    let lessonId: string | null =
      raw.lesson_id ??
      ext.lesson_id ??
      null;

    // אם עדיין אין – ננסה לחלץ מה-id של האירוע (בנינו אותו כ: lessonId_childId_occurDate)
    const eventId = String(arg.event.id || '');
    console.log('%c[EVENT CLICK] event.id →', 'color: brown;', eventId);

    if (!lessonId && eventId.includes('_')) {
      lessonId = eventId.split('_')[0] || null;
      console.log(
        '%c[EVENT CLICK] lessonId recovered from event.id →',
        'color: red; font-weight:bold;',
        lessonId
      );
    } else {
      console.log(
        '%c[EVENT CLICK] lessonId from raw/ext →',
        'color: red; font-weight:bold;',
        lessonId
      );
    }

    const lessonTypeLabel =
      raw.lesson_type ||
      ext.lesson_type ||
      this.formatLessonType(raw.lesson_type);

    // הילד לכרטיסייה
    this.selectedChild =
      this.children.find((c) => c.child_uuid === childId) ?? null;

    // אוקורנס – נשלח ל-NoteComponent
    this.selectedOccurrence = {
      lesson_id: lessonId,  // ⭐ עכשיו צריך להגיע ערך אמיתי
      child_id: childId,
      status: raw.status ?? ext.status ?? null,
      lesson_type: lessonTypeLabel,
      start: arg.event.start,
      end: arg.event.end,
    };

    console.log(
      '%c[EVENT CLICK] selectedOccurrence →',
      'color: green; font-weight:bold;',
      this.selectedOccurrence
    );

    // מיפוי לסטטוס נוכחות (אם יש כזה במטא)
    const attendanceRaw = String(
      raw.attendance_status ??
        ext.attendance_status ??
        raw.status ??
        ext.status ??
        ''
    ).toLowerCase();

    if (attendanceRaw === 'present' || attendanceRaw === 'הגיע') {
      this.attendanceStatus = 'present';
    } else if (attendanceRaw === 'absent' || attendanceRaw === 'לא הגיע') {
      this.attendanceStatus = 'absent';
    } else {
      this.attendanceStatus = null;
    }

    this.cdr.detectChanges();
  }


  onDateClick(event: any): void {
    const api = this.scheduleComp?.calendarApi;
    if (!api) return;
    if (api.view.type === 'dayGridMonth') {
      api.changeView('timeGridDay', event.dateStr);
      this.currentView = 'timeGridDay';
      this.updateCurrentDateFromCalendar();
    }
  }

  /** חתימה רחבה כדי לסתום את NG על Event */
  onRightClickDay(e: any): void {
    if (!e?.jsEvent || !e?.dateStr) return;
    e.jsEvent.preventDefault();

    this.contextMenu.visible = true;
    this.contextMenu.x = e.jsEvent.clientX;
    this.contextMenu.y = e.jsEvent.clientY;
    this.contextMenu.date = e.dateStr.slice(0, 10);
  }

  closeContextMenu(): void {
    this.contextMenu.visible = false;
  }

  /* ------------ שינוי טווח תצוגה ------------ */
  async onViewRangeChange(range: any): Promise<void> {
    try {
      const vt = range.viewType || '';
      if (vt === 'dayGridMonth') this.currentView = 'dayGridMonth';
      else if (vt === 'timeGridWeek') this.currentView = 'timeGridWeek';
      else this.currentView = 'timeGridDay';

      if (
        this.lastRange &&
        this.lastRange.start === range.start &&
        this.lastRange.end === range.end
      ) {
        this.updateCurrentDateFromCalendar();
        return;
      }

      this.lastRange = { start: range.start, end: range.end };
      this.loading = true;

      await this.loadLessonsForRange(range.start, range.end);

      const ids = Array.from(
        new Set(this.lessons.map((l: any) => l.child_id).filter(Boolean)),
      ) as string[];

      if (ids.length) {
        await this.loadChildrenAndRefs(ids);
      }

      await this.loadRequestsForRange(range.start, range.end);

      this.setScheduleItems();
      this.updateCurrentDateFromCalendar();
    } catch (err: any) {
      console.error('viewRange error', err);
      this.error = err?.message || 'שגיאה בטעינת השיעורים';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /* ------------ ניווט טולבר ------------ */
  onToolbarChangeView(view: CalendarView): void {
    this.currentView = view;
    if (this.scheduleComp?.calendarApi) {
      this.scheduleComp.changeView(view);
      this.updateCurrentDateFromCalendar();
    }
  }

  onToolbarPrev(): void {
    if (!this.scheduleComp) return;
    this.scheduleComp.prev();
    this.updateCurrentDateFromCalendar();
  }

  onToolbarNext(): void {
    if (!this.scheduleComp) return;
    this.scheduleComp.next();
    this.updateCurrentDateFromCalendar();
  }

  onToolbarToday(): void {
    if (!this.scheduleComp) return;
    this.scheduleComp.today();
    this.updateCurrentDateFromCalendar();
  }

  toggleMainFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    this.scheduleComp.toggleFullscreen();
  }

  /* ------------ REQUEST UI ------------ */
  async openRequest(type: RequestType): Promise<void> {
    const date = this.contextMenu.date;
    this.closeContextMenu();
    if (!date) return;

    this.rangeModal.open = true;
    this.rangeModal.from = date;
    this.rangeModal.to = date;
    this.rangeModal.allDay = true;
    this.rangeModal.fromTime = '';
    this.rangeModal.toTime = '';
    this.rangeModal.type = type;
    this.rangeModal.text = '';
  }

  closeRangeModal(): void {
    this.rangeModal.open = false;
  }

  async submitRange(): Promise<void> {
    const { from, to, allDay, fromTime, toTime, type, text } = this.rangeModal;

    if (!from || !to) {
      this.error = 'חובה לבחור מתאריך ועד תאריך';
      this.cdr.detectChanges();
      return;
    }

    if (!allDay && (!fromTime || !toTime)) {
      this.error = 'לחסימה לפי שעות – חובה למלא משעה ועד שעה';
      this.cdr.detectChanges();
      return;
    }

    try {
      await this.saveRangeRequest(
        from,
        to,
        allDay,
        allDay ? null : fromTime,
        allDay ? null : toTime,
        type,
        text.trim() || null,
      );

      this.rangeModal.open = false;
      this.rangeModal.text = '';
    } catch (err) {
      console.error('submitRange error', err);
      this.error = 'שגיאה בשמירת הבקשה';
      this.cdr.detectChanges();
    }
  }

  private async saveRangeRequest(
    fromDate: string,
    toDate: string,
    allDay: boolean,
    fromTime: string | null,
    toTime: string | null,
    type: RequestType,
    note: string | null,
  ): Promise<void> {
    if (!this.instructorId) return;

    const dbc = dbTenant();
    const user = await this.cu.loadUserDetails();

    const payload: any = {
      category: this.mapRequestTypeToDb(type),
      note,
      allDay,
      fromTime,
      toTime,
    };

    const { data, error } = await dbc
      .from('secretarial_requests')
      .insert({
        request_type: 'INSTRUCTOR_DAY_OFF',
        status: 'PENDING',
        requested_by_uid: user?.uid,
        requested_by_role: 'instructor',
        instructor_id: this.instructorId,
        child_id: null,
        lesson_occ_id: null,
        from_date: fromDate,
        to_date: toDate,
        payload,
      })
      .select()
      .single();

    if (error) throw error;

    const expanded = this.expandRequestRow(data);
    this.dayRequests.push(...expanded);

    this.setScheduleItems();
    this.cdr.detectChanges();
  }

  /* ------------ APPROVAL MENU ------------ */
  onClickRequest(dateStr: string, ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();

    const req = this.getRequestForDate(dateStr);
    if (!req) return;

    this.approvalMenu.open = true;
    this.approvalMenu.x = ev.clientX;
    this.approvalMenu.y = ev.clientY;
    this.approvalMenu.request = req;
  }

  closeApprovalMenu(): void {
    this.approvalMenu.open = false;
    this.approvalMenu.request = null;
  }

  async approveRequest(): Promise<void> {
    await this.setRequestStatus('approved');
  }

  async rejectRequest(): Promise<void> {
    await this.setRequestStatus('rejected');
  }

  private async setRequestStatus(status: RequestStatus): Promise<void> {
    const req = this.approvalMenu.request;
    if (!req) return;

    try {
      const dbc = dbTenant();
      const user = await this.cu.loadUserDetails();

      const dbStatus =
        status === 'approved'
          ? 'APPROVED'
          : status === 'rejected'
          ? 'REJECTED'
          : 'PENDING';

      const { data, error } = await dbc
        .from('secretarial_requests')
        .update({
          status: dbStatus,
          decided_at: new Date().toISOString(),
          decided_by_uid: user?.uid ?? null,
        })
        .eq('id', req.id)
        .select()
        .single();

      if (error) throw error;

      const updated: any = data;

      this.dayRequests = this.dayRequests.map((r) =>
        r.id === updated.id
          ? {
              ...r,
              status: this.mapDbStatus(updated.status),
              note:
                updated.payload?.note ??
                updated.decision_note ??
                r.note ??
                null,
            }
          : r,
      );

      this.setScheduleItems();
      this.closeApprovalMenu();
    } catch (err) {
      console.error('setRequestStatus error', err);
      this.error = 'שגיאה בעדכון סטטוס הבקשה';
      this.cdr.detectChanges();
    }
  }

  /* ------------ HELPERS ------------ */
  private getRequestForDate(date: string): DayRequestRow | undefined {
    return this.dayRequests.find((r) => r.request_date === date);
  }

  getRequestLabel(type: RequestType): string {
    switch (type) {
      case 'holiday':
        return 'יום חופש';
      case 'sick':
        return 'יום מחלה';
      case 'personal':
        return 'יום אישי';
      case 'other':
      default:
        return 'בקשה אחרת';
    }
  }

  private mapDbRequestType(x: string | null | undefined): RequestType {
    const map: Record<string, RequestType> = {
      HOLIDAY: 'holiday',
      SICK: 'sick',
      PERSONAL: 'personal',
      OTHER: 'other',
    };
    const key = String(x ?? '').toUpperCase();
    return map[key] ?? 'other';
  }

  private mapDbStatus(x: string | null | undefined): RequestStatus {
    const map: Record<string, RequestStatus> = {
      APPROVED: 'approved',
      REJECTED: 'rejected',
      PENDING: 'pending',
    };
    const key = String(x ?? '').toUpperCase();
    return map[key] ?? 'pending';
  }

  private mapRequestTypeToDb(t: RequestType): string {
    const map: Record<RequestType, string> = {
      holiday: 'HOLIDAY',
      sick: 'SICK',
      personal: 'PERSONAL',
      other: 'OTHER',
    };
    return map[t];
  }

 private formatLessonType(val: any, lesson?: any): string {
  if (!val) return 'ניסיון'; // ברירת מחדל במקום NULL

  const v = String(val).toUpperCase();

  switch (v) {
    case 'REGULAR':
      // אם יש חזרתיות → להציג חלק מסדרה
      if (lesson?.repeat_weeks && lesson?.week_index >= 0) {
        const part = lesson.week_index + 1;
        const total = lesson.repeat_weeks;
        return `רגיל (חלק ${part} מתוך ${total})`;
      }
      return 'שיעור רגיל';

    case 'MAKEUP':
      return 'השלמה';

    case 'NISAYON':
      return 'ניסיון';

    case 'SERIES':
      if (lesson?.repeat_weeks && lesson?.week_index >= 0) {
        const part = lesson.week_index + 1;
        const total = lesson.repeat_weeks;
        return `רגיל (חלק ${part} מתוך ${total})`;
      }
      return 'רגיל';

    default:
      return val;
  }
}

  private updateCurrentDateFromCalendar(): void {
    const api = this.scheduleComp?.calendarApi;
    if (!api) return;
    this.currentDate = api.view?.title || '';
    this.cdr.detectChanges();
  }

  /* ------------ NOTE CLOSE ------------ */
  onCloseNote(): void {
    this.selectedChild = null;
    this.selectedOccurrence = null;
    this.attendanceStatus = null;
  }
}

/* ------------ UTILITIES ------------ */
function ymd(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function calcAge(isoDate: string): number {
  const b = new Date(isoDate);
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

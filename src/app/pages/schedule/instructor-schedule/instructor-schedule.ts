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
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import {
  dbTenant,
  ensureTenantContextReady,
} from '../../../services/legacy-compat';
import type { EventClickArg } from '@fullcalendar/core';

import { NoteComponent } from '../../Notes/note.component';
import { Lesson } from '../../../models/lesson-schedule.model';

type UUID = string;
type CalendarView = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

type RequestType = 'holiday' | 'sick' | 'personal' | 'other';
type RequestStatus = 'pending' | 'approved' | 'rejected';

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
  status?:
    | 'Active'
    | 'Pending Addition Approval'
    | 'Pending Deletion Approval'
    | 'Deleted';
  parent_uid?: string;
  medical_notes?: string | null;
  age?: number;
  parent?: Parent | null;
}

/** ייצוג יומי של בקשה (יכול להיות חלק מטווח כמה ימים) */
interface DayRequestRow {
  id: string; // uuid מטבלת secretarial_requests
  instructor_id: string;
  request_date: string; // YYYY-MM-DD
  request_type: RequestType;
  status: RequestStatus;
  note?: string | null;
}

@Component({
  selector: 'app-instructor-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss'],
})
export class InstructorScheduleComponent implements OnInit {
  @ViewChild(ScheduleComponent) scheduleComp!: ScheduleComponent;

  private lastRange: { start: string; end: string } | null = null;

  private cdr = inject(ChangeDetectorRef);
  private cu = inject(CurrentUserService);

  children: Child[] = [];
  lessons: Lesson[] = [];
  items: ScheduleItem[] = [];
  selectedChild: Child | null = null;

  /** בקשות יומיות שנמשכו מה-DB (מורחב לפי ימים) */
  dayRequests: DayRequestRow[] = [];

  instructorId = '';
  currentView: CalendarView = 'timeGridWeek';
  loading = false;
  error: string | null = null;
  currentDate = '';
  isFullscreen = false;

  /** === UI: תפריט קליק ימני + מודאלים === */
  contextMenu = {
    visible: false,
    x: 0,
    y: 0,
    date: '' as string, // YYYY-MM-DD
  };

  /** מודאל אחיד לטווח ימים/שעות */
  rangeModal = {
    open: false,
    from: '' as string,
    to: '' as string,
    allDay: true,
    fromTime: '' as string,
    toTime: '' as string,
    type: 'holiday' as RequestType,
    text: '',
  };

  /** חלון אישור/דחייה (למזכירה/מנהל) */
  approvalMenu = {
    open: false,
    x: 0,
    y: 0,
    request: null as DayRequestRow | null,
  };

  /** ================== lifecycle ================== */

  async ngOnInit(): Promise<void> {
    try {
      this.loading = true;

      await ensureTenantContextReady();

      const user = await this.cu.loadUserDetails();
      if (!user?.id_number) {
        this.error = 'לא נמצאו פרטי מדריך. התחבר שוב.';
        return;
      }
      this.instructorId = String(user.id_number).trim();

      const startYmd = ymd(addDays(new Date(), -14));
      const endYmd = ymd(addDays(new Date(), 60));

      await this.loadLessonsForRange(startYmd, endYmd);

      const childIds = Array.from(
        new Set(this.lessons.map((l) => l.child_id)),
      ).filter(Boolean) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
      }

      // טעינת בקשות מה-secretarial_requests לטווח הראשוני
      await this.loadRequestsForRange(startYmd, endYmd);

      this.setScheduleItems();
      this.updateCurrentDateFromCalendar();
    } catch (err: any) {
      console.error('init error', err);
      this.error = err?.message || 'שגיאה בטעינה';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /** ========= DB loaders ========= **/

  private async loadLessonsForRange(
    startYmd: string,
    endYmd: string,
  ): Promise<void> {
    if (!this.instructorId) {
      this.lessons = [];
      return;
    }

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

  private async loadChildrenAndRefs(childIds: string[]): Promise<void> {
    const dbc = dbTenant();

    const { data: kids, error: errKids } = await dbc
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
      .in('child_uuid', childIds);

    if (errKids) throw errKids;
    const childList: Child[] = (kids ?? []) as Child[];

    const parentUids = Array.from(
      new Set(childList.map((c) => c.parent_uid!).filter(Boolean)),
    ) as string[];

    let parentsMap = new Map<string, Parent>();

    if (parentUids.length) {
      const { data: parentsData, error: pErr } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, email, phone')
        .in('uid', parentUids);

      if (!pErr && parentsData) {
        parentsMap = new Map<string, Parent>(
          (parentsData as Parent[]).map((p) => [p.uid, p]),
        );
      }
    }

    this.children = childList.map((c) => ({
      ...c,
      age: c.birth_date ? calcAge(c.birth_date) : undefined,
      parent: c.parent_uid ? parentsMap.get(c.parent_uid) ?? null : null,
    }));
  }

  /** טעינת בקשות מטבלת secretarial_requests לטווח תאריכים */
  private async loadRequestsForRange(
    startYmd: string,
    endYmd: string,
  ): Promise<void> {
    if (!this.instructorId) {
      this.dayRequests = [];
      return;
    }

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

    if (error) {
      console.error('❌ loadRequests error', error);
      throw error;
    }

    const rows = data ?? [];
    this.dayRequests = rows.flatMap((r: any) => this.expandRequestRow(r));

    console.log('📥 loaded dayRequests:', this.dayRequests);
  }

  /** מרחיב רשומת בקשה לטווח ימים → לרשומות יומיות */
  private expandRequestRow(row: any): DayRequestRow[] {
    const res: DayRequestRow[] = [];
    if (!row.from_date) return res;

    const from = new Date(row.from_date);
    const to = row.to_date ? new Date(row.to_date) : new Date(row.from_date);

    const reqType = this.mapDbRequestType(row.payload?.category);
    const status = this.mapDbStatus(row.status);
    const note = row.payload?.note ?? row.decision_note ?? null;

    let d = new Date(from);
    while (d <= to) {
      const dayStr = ymd(d);
      res.push({
        id: row.id,
        instructor_id: row.instructor_id,
        request_date: dayStr,
        request_type: reqType,
        status,
        note,
      });
      d.setDate(d.getDate() + 1);
    }

    return res;
  }

  /** ========= View mapping ========= **/

  private setScheduleItems(): void {
    const src = this.lessons;

    // חודש – סיכום יומי
    if (this.currentView === 'dayGridMonth') {
      const grouped: Record<string, Lesson[]> = {};
      for (const l of src) {
        const day =
          l.occur_date?.slice(0, 10) || l.start_datetime?.slice(0, 10);
        if (!day) continue;
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(l);
      }

      this.items = Object.entries(grouped).map(([day, lessons]) => {
        const req = this.getRequestForDate(day);

        const count = lessons.length;
        const regular = lessons.filter((l) => l.lesson_type === 'רגיל').length;
        const makeup = lessons.filter((l) => l.lesson_type === 'השלמה').length;
        const canceled = lessons.filter((l) => l.status === 'בוטל').length;

        const parts: string[] = [];
        if (count) parts.push(`${count} שיעור${count > 1 ? 'ים' : ''}`);
        if (regular) parts.push(`${regular} רגיל`);
        if (makeup) parts.push(`${makeup} השלמה`);
        if (canceled) parts.push(`${canceled} בוטל`);

        const classNames: string[] = [];

        if (req) {
          const label = this.getRequestLabel(req.request_type);
          parts.push(label);

          const cls = this.getRequestClass(req.status);
          if (cls) classNames.push(cls);
        }

        const item: ScheduleItem = {
          id: day,
          title: parts.join(' | '),
          start: day,
          end: day,
          color: '#ffffff',
          status: 'הושלם',
        };

        if (classNames.length) {
          (item as any).classNames = classNames;
        }

        return item;
      });

      this.cdr.detectChanges();
      return;
    }

    // שבוע / יום – שיעורים מלאים
    this.items = src.map((l) => {
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

      let color = '#b5ead7';
      if (l.status === 'בוטל') color = '#ffcdd2';
      else if (new Date(endISO) < new Date()) color = '#e0e0e0';

      const dayKey =
        l.occur_date?.slice(0, 10) ||
        l.start_datetime?.slice(0, 10) ||
        startISO.slice(0, 10);

      const req = this.getRequestForDate(dayKey);
      const classNames: string[] = [];

      if (req) {
        const cls = this.getRequestClass(req.status);
        if (cls) classNames.push(cls);
      }

      const childName = `${child?.first_name || ''} ${
        child?.last_name || ''
      }`.trim();
      const agePart = child?.age != null ? ` (${child.age})` : '';

      const item: ScheduleItem = {
        id: `${l.lesson_id}_${l.child_id}_${l.occur_date}`,
        title: `${childName}${agePart} — ${l.lesson_type ?? ''}`.trim(),
        start: startISO,
        end: endISO,
        color,
        meta: {
          child_id: l.child_id,
          child_name: childName,
          instructor_id: l.instructor_id,
          instructor_name: '',
          status: l.status,
          lesson_type: l.lesson_type ?? '',
        },
        status: l.status,
      };

      if (classNames.length) {
        (item as any).classNames = classNames;
      }

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
      const [hh, mm] = time.split(':');
      d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    }
    return d.toISOString();
  }

  /** ========= Events ========= **/

  onEventClick(arg: EventClickArg): void {
    const ext: any = arg.event.extendedProps || {};

    const childId: string | undefined = ext.child_id;
    if (!childId) return;

    this.selectedChild =
      this.children.find((c) => c.child_uuid === childId) ?? null;
    this.cdr.detectChanges();
  }

  // משתמשים ב-any כדי לא להסתבך עם טיפוסים של FullCalendar / wrapper
  onDateClick(arg: any): void {
    const jsEvent: MouseEvent | undefined = arg?.jsEvent;
    const dateStr: string | undefined = arg?.dateStr;

    jsEvent?.preventDefault?.();

    const api = this.scheduleComp?.calendarApi;
    if (!api || !dateStr) return;

    // מעבר מתצוגת חודש אל יום שנלחץ
    if (api.view.type === 'dayGridMonth') {
      api.changeView('timeGridDay', dateStr);
      this.currentView = 'timeGridDay';
      this.updateCurrentDateFromCalendar();
    }
  }

  async onViewRangeChange(range: {
    start: string;
    end: string;
    viewType?: string;
  }) {
    try {
      if (!this.instructorId) return;

      const vt = range.viewType || '';
      if (vt === 'dayGridMonth') this.currentView = 'dayGridMonth';
      else if (vt === 'timeGridWeek') this.currentView = 'timeGridWeek';
      else if (vt === 'timeGridDay' || vt === 'resourceTimeGridDay')
        this.currentView = 'timeGridDay';

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

      const childIds = Array.from(
        new Set(this.lessons.map((l) => l.child_id)),
      ).filter(Boolean) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
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

  changeView(view: CalendarView) {
    this.currentView = view;
    this.scheduleComp.changeView(view);
    this.updateCurrentDateFromCalendar();
  }

  next() {
    this.scheduleComp.next();
    this.updateCurrentDateFromCalendar();
  }

  prev() {
    this.scheduleComp.prev();
    this.updateCurrentDateFromCalendar();
  }

  today() {
    this.scheduleComp.today();
    this.updateCurrentDateFromCalendar();
  }

  toggleMainFullscreen() {
    this.isFullscreen = !this.isFullscreen;
  }

  /** ========= בקשות יומיות – לוגיקה ========= **/

  /** קליק ימני על יום/אירוע – מגיע מ-ScheduleComponent */
  onRightClickDay(e: any) {
    const jsEvent: MouseEvent | undefined = e?.jsEvent;
    const dateStr: string | undefined = e?.dateStr;

    jsEvent?.preventDefault?.();

    if (!jsEvent || !dateStr) return;

    this.contextMenu.visible = true;
    this.contextMenu.x = jsEvent.clientX;
    this.contextMenu.y = jsEvent.clientY;
    this.contextMenu.date = dateStr.slice(0, 10);
  }

  closeContextMenu() {
    this.contextMenu.visible = false;
  }

  /** פתיחת בקשה מסוג מסוים מהתפריט – תמיד פותח מודאל טווח */
  async openRequest(type: RequestType) {
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

  closeRangeModal() {
    this.rangeModal.open = false;
  }

  /** שליחת בקשת טווח ל-secretarial_requests */
  async submitRange() {
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

  /** שמירת בקשת טווח בטבלת secretarial_requests */
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
      category: this.mapRequestTypeToDb(type), // HOLIDAY / SICK / PERSONAL / OTHER
      note,
      allDay,
      fromTime,
      toTime,
    };

    const { data, error } = await dbc
      .from('secretarial_requests')
      .insert({
        request_type: 'INSTRUCTOR_DAY_OFF', // enum מהטבלה שלך
        status: 'PENDING',
        requested_by_uid: user?.uid,
        requested_by_role: 'instructor', // tenant_role (lowercase)
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

  /** לחיצה על יום בקשה – לפתוח חלון אישור/דחייה */
  onClickRequest(dateStr: string, ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();

    const req = this.getRequestForDate(dateStr);
    if (!req) return;

    this.approvalMenu.open = true;
    this.approvalMenu.x = ev.clientX;
    this.approvalMenu.y = ev.clientY;
    this.approvalMenu.request = req;
  }

  closeApprovalMenu() {
    this.approvalMenu.open = false;
    this.approvalMenu.request = null;
  }

  async approveRequest() {
    await this.setRequestStatus('approved');
  }

  async rejectRequest() {
    await this.setRequestStatus('rejected');
  }

  /** עדכון סטטוס בטבלת secretarial_requests + רישום ל-instructor_unavailability */
  private async setRequestStatus(status: RequestStatus) {
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

      const updated = data as any;

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

      // במקרה של אישור – ליצור רשומות ב-instructor_unavailability לטווח המלא
      if (status === 'approved') {
        await this.applyApprovedRequest(updated);
      }

      this.closeApprovalMenu();
      this.setScheduleItems();
    } catch (err) {
      console.error('setRequestStatus error', err);
      this.error = 'שגיאה בעדכון סטטוס הבקשה';
      this.cdr.detectChanges();
    }
  }

  /** יצירת רשומות היעדרות ב-instructor_unavailability אחרי אישור בקשה */
  private async applyApprovedRequest(secretReqRow: any) {
    if (!secretReqRow) return;

    try {
      const dbc = dbTenant();

      const fromDate = secretReqRow.from_date as string;
      const toDate = (secretReqRow.to_date as string) || fromDate;

      const payload = secretReqRow.payload || {};
      const allDay = payload.allDay ?? true;
      const fromTime = payload.fromTime || '00:00';
      const toTime = payload.toTime || '23:59';
      const note =
        payload.note ||
        secretReqRow.decision_note ||
        this.getRequestLabel(this.mapDbRequestType(payload.category));

      const inserts: any[] = [];

      let d = new Date(fromDate);
      const end = new Date(toDate);

      while (d <= end) {
        const dayStr = ymd(d);

        const fromTs = allDay
          ? `${dayStr}T00:00:00.000Z`
          : `${dayStr}T${fromTime}:00.000Z`;
        const toTs = allDay
          ? `${dayStr}T23:59:59.999Z`
          : `${dayStr}T${toTime}:00.000Z`;

        inserts.push({
          instructor_id_number: this.instructorId,
          from_ts: fromTs,
          to_ts: toTs,
          reason: note,
          all_day: allDay,
        });

        d.setDate(d.getDate() + 1);
      }

      const { error } = await dbc
        .from('instructor_unavailability')
        .insert(inserts);

      if (error) {
        console.error('applyApprovedRequest error', error);
        this.error = 'שגיאה ברישום ההיעדרות';
        this.cdr.detectChanges();
      }
    } catch (err) {
      console.error('applyApprovedRequest error', err);
      this.error = 'שגיאה ברישום ההיעדרות';
      this.cdr.detectChanges();
    }
  }

  /** === עזרי בקשות === */

  private getRequestForDate(dateStr: string): DayRequestRow | undefined {
    return this.dayRequests.find((r) => r.request_date === dateStr);
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

  private getRequestClass(status: RequestStatus): string | null {
    switch (status) {
      case 'pending':
        return 'day-request-pending';
      case 'approved':
        return 'day-request-approved';
      case 'rejected':
        return 'day-request-rejected';
      default:
        return null;
    }
  }

  private mapRequestTypeToDb(type: RequestType): string {
    switch (type) {
      case 'holiday':
        return 'HOLIDAY';
      case 'sick':
        return 'SICK';
      case 'personal':
        return 'PERSONAL';
      case 'other':
      default:
        return 'OTHER';
    }
  }

  private mapDbRequestType(dbType: string | null | undefined): RequestType {
    switch ((dbType || '').toUpperCase()) {
      case 'HOLIDAY':
        return 'holiday';
      case 'SICK':
        return 'sick';
      case 'PERSONAL':
        return 'personal';
      case 'OTHER':
      default:
        return 'other';
    }
  }

  private mapDbStatus(dbStatus: string): RequestStatus {
    switch ((dbStatus || '').toUpperCase()) {
      case 'APPROVED':
        return 'approved';
      case 'REJECTED':
        return 'rejected';
      case 'PENDING':
      default:
        return 'pending';
    }
  }

  /** === טולבר – תצוגת תאריך === */

  private updateCurrentDateFromCalendar() {
    const api = this.scheduleComp?.calendarApi;
    if (!api) return;
    this.currentDate = api.view?.title || '';
    this.cdr.detectChanges();
  }
}

/* ---------- פונקציות עזר ---------- */
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

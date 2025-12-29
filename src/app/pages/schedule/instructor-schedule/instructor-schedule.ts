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
import { dbTenant, ensureTenantContextReady } from '../../../services/legacy-compat';

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
farmDaysOff: any[] = [];

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

      console.log('[INIT] range', { startYmd, endYmd, instructorId: this.instructorId });

      await this.loadLessonsForRange(startYmd, endYmd);

      // ✅ חדש: טעינת סוס+מגרש והזרקה לתוך lessons
      await this.loadLessonResourcesForRange(startYmd, endYmd);


      const childIds = Array.from(
        new Set(this.lessons.map((l: any) => l.child_id).filter(Boolean)),
      ) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
      }

      await this.loadRequestsForRange(startYmd, endYmd);
await this.loadFarmDaysOffForRange(startYmd, endYmd);

      this.setScheduleItems();
      this.updateCurrentDateFromCalendar();
    } catch (err: any) {
      console.error('[INIT ERROR]', err);
      this.error = err?.message || 'שגיאה בטעינה';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }


  /* ------------ LOADERS ------------ */

  private async loadLessonsForRange(startYmd: string, endYmd: string): Promise<void> {
  const dbc = dbTenant();

  const { data, error } = await dbc
    .from('lessons_occurrences')
    .select(`
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
    `)
    .eq('instructor_id', this.instructorId)
    .gte('occur_date', startYmd)
    .lte('occur_date', endYmd);

  if (error) throw error;

  this.lessons = data ?? [];
  console.log('[LOAD LESSONS]', this.lessons);
}

  /**
   * ✅ חדש: טעינת horse_name + arena_name מתוך view שעובד אצל המזכירה:
   * lessons_with_children (רק עמודות קיימות!)
   *
   * חשוב:
   * - לא מבקשים child_name / start_datetime וכו' כדי לא לקבל 42703
   * - ממפים לפי (lesson_id + occur_date)
   */
private async loadLessonResourcesForRange(startYmd: string, endYmd: string): Promise<void> {
  if (!this.lessons.length) return;

  const dbc = dbTenant();

  const lessonIds = [...new Set(this.lessons.map((l: any) => l.lesson_id))];
  if (!lessonIds.length) return;

  console.log('[LOAD RESOURCES]', { lessonIds, startYmd, endYmd });

  const { data, error } = await dbc
    .from('lessons_with_children')
    .select('lesson_id, occur_date, horse_name, arena_name')
    .in('lesson_id', lessonIds)
    .gte('occur_date', startYmd)
    .lte('occur_date', endYmd);

  if (error) {
    console.error('[LOAD RESOURCES ERROR]', error);
    return;
  }

  const map = new Map<string, any>();
  for (const r of data ?? []) {
    map.set(`${r.lesson_id}_${r.occur_date}`, r);
  }

  this.lessons = this.lessons.map((l: any) => {
    const key = `${l.lesson_id}_${l.occur_date}`;
    const res = map.get(key);

    return {
      ...l,
      horse_name: res?.horse_name ?? null,
      arena_name: res?.arena_name ?? null,
    };
  });

  console.log('[LOAD RESOURCES] merged into lessons');
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
 

private async loadFarmDaysOffForRange(startYmd: string, endYmd: string): Promise<void> {
  const dbc = dbTenant();

  const { data, error } = await dbc
    .from('farm_days_off')
    .select(`
      id,
      reason,
      start_date,
      end_date,
      day_type,
      start_time,
      end_time,
      is_active
    `)
    .eq('is_active', true)
    // טווח חופף
    .lte('start_date', endYmd)
    .gte('end_date', startYmd);

  if (error) throw error;

  this.farmDaysOff = data ?? [];
  console.log('[LOAD FARM DAYS OFF]', this.farmDaysOff);
}

private async loadRequestsForRange(startYmd: string, endYmd: string): Promise<void> {
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
    .eq('request_type', 'INSTRUCTOR_DAY_OFF') // ✅ הכי חשוב! רק בקשות חופש אמיתיות
    // ✅ טווח חופף: בקשה שנוגעת לטווח התצוגה גם אם התחילה לפני
    .lte('from_date', endYmd)
    .gte('to_date', startYmd);

  if (error) throw error;

  const rows = data ?? [];
  this.dayRequests = rows.flatMap((row: any) => this.expandRequestRow(row));
}


  private expandRequestRow(row: any): DayRequestRow[] {
    const res: DayRequestRow[] = [];
    if (!row.from_date) return res;
// ✅ אם אין category – זו לא בקשת חופש תקינה, לא להציג בלוח
if (!row.payload?.category) return res;

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
    // 🔑 שיעורים תקינים (לא חופפים לחופשת חווה)
  const validLessons = this.lessons.filter((l: any) => {
    const baseDate = String(l.occur_date).slice(0, 10);

    const startISO = l.start_datetime
      ? l.start_datetime
      : this.ensureLocalIso(l.start_time, baseDate);

    const endISO = l.end_datetime
      ? l.end_datetime
      : this.ensureLocalIso(l.end_time, baseDate);

    return !this.isLessonBlockedByFarmOff(
      new Date(startISO),
      new Date(endISO)
    );
  });


    // תצוגה חודשית – סיכום יומי
    if (this.currentView === 'dayGridMonth') {
      const grouped: Record<string, Lesson[]> = {};
  for (const l of validLessons) {





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
          id: `summary_${day}`,
          title: parts.join(' | '),
          start: day,
          end: day,
          color: 'transparent', 
          status: 'summary',
    meta: {
    isSummaryDay: 'true', // ✅ string ולא boolean
  },

        };

        return item;
      });
const farmOffItems = this.farmDaysOffToItems();
this.items = [...this.items, ...farmOffItems];
console.log('📅 FINAL ITEMS', this.items);
console.log(
  '🏖 FARM DAYS OFF ITEMS',
  this.items.filter(i => String(i.id).startsWith('farm_off_'))
);

      this.cdr.detectChanges();
      return;
    }

    // תצוגת שבוע / יום – אירוע לכל שיעור
   const srcForDayWeek = validLessons;


this.items = srcForDayWeek
  .filter((l: any) => {
    const baseDate = String(l.occur_date).slice(0, 10);

    const startISO = l.start_datetime
      ? l.start_datetime
      : this.ensureLocalIso(l.start_time, baseDate);

    const endISO = l.end_datetime
      ? l.end_datetime
      : this.ensureLocalIso(l.end_time, baseDate);

    const start = new Date(startISO);
    const end = new Date(endISO);

    // ❌ אם השיעור חופף לחופשת חווה – לא להציג אותו
    return !this.isLessonBlockedByFarmOff(start, end);
  })
  .map((l: any) => {

console.log('🔍 RAW LESSON:', {
  lesson_id: l.lesson_id,
  status: l.status,
  occur_date: l.occur_date,
  start_datetime: l.start_datetime,
  start_time: l.start_time,
});

const rawStatus = String(l.status ?? '').trim();
const upperStatus = rawStatus.toUpperCase();

// תופס כל צורה של ביטול
const isCancelled =
  upperStatus.includes('CANCEL') ||
  rawStatus.includes('בוטל') ||
  rawStatus.includes('מבוטל');


const baseDate = String(l.occur_date).slice(0, 10);

const startISO = l.start_datetime
  ? l.start_datetime
  : this.ensureLocalIso(l.start_time, baseDate);

const endISO = isCancelled
  ? this.ensureLocalIso(this.addMinutes(l.start_time ?? '00:00', 30), baseDate)
  : l.end_datetime
    ? l.end_datetime
    : this.ensureLocalIso(l.end_time, baseDate);



      const child = this.children.find((c) => c.child_uuid === l.child_id);
      const name = `${child?.first_name || ''} ${child?.last_name || ''}`.trim();
      const agePart = child?.age != null ? ` (${child.age})` : '';

      const lessonTypeLabel = this.formatLessonType(l.lesson_type);

  let color = '#b5ead7';
if (isCancelled) color = '#ffcdd2';
else if (new Date(endISO) < new Date()) color = '#e0e0e0';


      // ✅ חדש: טקסט סוס+מגרש (לא חובה – אבל עוזר לראות בלוז)
      const horse = l.horse_name ? `🐴 ${l.horse_name}` : '';
      const arena = l.arena_name ? `🏟 ${l.arena_name}` : '';
      const resourcesText = [horse, arena].filter(Boolean).join(' | ');

      const titleBase = `${name}${agePart} — ${lessonTypeLabel}`.trim();
      const title = resourcesText ? `${titleBase}\n${resourcesText}` : titleBase;

      const item: ScheduleItem = {
        id: `${l.lesson_id}_${l.child_id}_${l.occur_date}`,
        title,
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

          // ✅ חדש: מעבירים ל-UI/NoteComponent
          horse_name: l.horse_name ?? null,
          arena_name: l.arena_name ?? null,
          occur_date: (l.occur_date ?? '').slice(0, 10),
          lesson_id: l.lesson_id,
        } as any,
        status: l.status as any,
      };

      return item;
    });
const farmOffItems = this.farmDaysOffToItems();
this.items = [...this.items, ...farmOffItems];
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
onEventClick(arg: EventClickArg): void {
  const evAny: any = arg.event;
  const eventId = String(evAny?.id || '');
    // 🔒 חופשת חווה – לא פותחים כרטסת
  if (eventId.startsWith('farm_off_')) {
    return;
  }

  // ✅ 1) לחיצה על סיכום חודשי → לעבור ליום הזה (כמו לחיצה על הרקע) + לטעון שיעורים
  if (eventId.startsWith('summary_')) {
    const day = eventId.replace('summary_', '').slice(0, 10);

    // ניקוי כרטיסייה פתוחה (אם יש)
    this.selectedChild = null;
    this.selectedOccurrence = null;
    this.attendanceStatus = null;

    // קריטי: להשתמש ב-goToDay כדי ש-FullCalendar יפעיל datesSet → viewRange → loadLessons
    this.currentView = 'timeGridDay';
    this.scheduleComp?.goToDay(day);

    this.cdr.detectChanges();
    return;
  }

  // ✅ 2) לחיצה על שיעור רגיל → לפתוח כרטסת ילד (כמו בקוד המקורי)
  const extProps: any = evAny?.extendedProps || {};
  const metaProps: any = extProps['meta'] || extProps;

  const childId: string | undefined =
    metaProps.child_id || extProps.child_id || metaProps.child_uuid;

  if (!childId) {
    console.warn('[EVENT CLICK] no child_id found, aborting', { extProps, metaProps });
    return;
  }

  // lesson_id אמיתי: מה-meta או חילוץ מה-id
  let lessonId: string | null = metaProps.lesson_id ?? extProps.lesson_id ?? null;
  if (!lessonId && eventId.includes('_')) {
    lessonId = eventId.split('_')[0] || null;
  }

  const lessonTypeLabel =
    metaProps.lesson_type ||
    extProps.lesson_type ||
    this.formatLessonType(metaProps.lesson_type);

  // הילד לכרטיסייה
  this.selectedChild =
    this.children.find((c) => c.child_uuid === childId) ?? null;
// ===== זיהוי אם השיעור מבוטל =====
const rawStatus = String(
  metaProps.status ?? extProps.status ?? ''
).toLowerCase();

const isCancelled =
  rawStatus.includes('בוטל') ||
  rawStatus.includes('מבוטל') ||
  rawStatus.includes('cancel');

  // occurrence ל-NoteComponent
  this.selectedOccurrence = {
    lesson_id: lessonId,
    child_id: childId,
    occur_date:
      metaProps.occur_date ??
      (arg.event.start ? arg.event.start.toISOString().slice(0, 10) : null),

    status: metaProps.status ?? extProps.status ?? null,
    lesson_type: lessonTypeLabel,
    start: arg.event.start,
    end: arg.event.end,
 isCancelled, 
    // משאבים
    horse_name: metaProps.horse_name ?? null,
    arena_name: metaProps.arena_name ?? null,
  };

  // נוכחות
  const attendanceRaw = String(
    metaProps.attendance_status ??
      extProps.attendance_status ??
      metaProps.status ??
      extProps.status ??
      '',
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
    console.log('[VIEW RANGE RAW]', range);

    const vt = range.viewType || '';
    if (vt === 'dayGridMonth') this.currentView = 'dayGridMonth';
    else if (vt === 'timeGridWeek') this.currentView = 'timeGridWeek';
    else this.currentView = 'timeGridDay';

    const startYmd = toYmd(range.start);
    const endYmd = toYmd(range.end);
function toYmd(val: string | Date): string {
  const d = typeof val === 'string' ? new Date(val) : val;
  return ymd(d);
}

    console.log('[VIEW RANGE YMD]', { startYmd, endYmd });

    if (
      this.lastRange &&
      this.lastRange.start === startYmd &&
      this.lastRange.end === endYmd
    ) {
      this.updateCurrentDateFromCalendar();
      return;
    }

    this.lastRange = { start: startYmd, end: endYmd };
    this.loading = true;

    await this.loadLessonsForRange(startYmd, endYmd);
    await this.loadLessonResourcesForRange(startYmd, endYmd);

    const ids = Array.from(
      new Set(this.lessons.map((l: any) => l.child_id).filter(Boolean)),
    ) as string[];

    if (ids.length) {
      await this.loadChildrenAndRefs(ids);
    }

    await this.loadRequestsForRange(startYmd, endYmd);
await this.loadFarmDaysOffForRange(startYmd, endYmd);

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
 private isLessonBlockedByFarmOff(
  lessonStart: Date,
  lessonEnd: Date
): boolean {
  return (this.farmDaysOff ?? []).some((off: any) => {

    // יום מלא – חוסם הכל
    if (off.day_type === 'FULL_DAY') {
      const lessonDay = lessonStart.toISOString().slice(0, 10);
      return (
        lessonDay >= off.start_date &&
        lessonDay <= off.end_date
      );
    }

    // ⏰ חופשה לפי שעות – רק באותו יום!
    const offStart = new Date(
      `${off.start_date}T${off.start_time}`
    );
    const offEnd = new Date(
      `${off.start_date}T${off.end_time}`
    );

    return lessonStart < offEnd && lessonEnd > offStart;
  });
}


  private addOneDayYmd(dateYmd: string): string {
  const d = new Date(dateYmd + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

private farmDaysOffToItems(): ScheduleItem[] {
  return (this.farmDaysOff ?? []).map((d: any) => {
    const isFullDay = String(d.day_type || '').toUpperCase() === 'FULL_DAY';

    const start = isFullDay
      ? String(d.start_date).slice(0, 10)
      : this.ensureLocalIso(
          String(d.start_time).slice(0, 5),
          String(d.start_date).slice(0, 10)
        );

    const end = isFullDay
      ? this.addOneDayYmd(String(d.end_date).slice(0, 10))
      : this.ensureLocalIso(
          String(d.end_time).slice(0, 5),
           String(d.start_date).slice(0, 10) 
        );

    // ⭐ כאן הקסם
    const title =
      d.reason?.trim()
        ? `🏖 ${d.reason}`
        : isFullDay
        ? '🏖 חופשת חווה – יום מלא'
        : '🏖 חופשת חווה – לפי שעות';

    return {
      id: `farm_off_${d.id}`,
      title,

      start,
      end,

      allDay: isFullDay,
      display: 'background',
      classNames: ['farm-day-off'],

      status: 'farm_day_off' as any,
      meta: {
        isFarmDayOff: 'true',
        reason: d.reason ?? null,
        day_type: d.day_type,
      } as any,
    };
  });
}


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
    if (!val) return 'ניסיון';

    const v = String(val).toUpperCase();

    switch (v) {
      case 'REGULAR':
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
  private ensureLocalIso(
  time?: string | null,
  baseDate?: string | Date | null,
): string {
  const dateStr =
    typeof baseDate === 'string'
      ? baseDate.slice(0, 10)
      : (baseDate ?? new Date()).toISOString().slice(0, 10);

  const t = (time ?? '00:00').toString().slice(0, 5); // "HH:MM"
  return `${dateStr}T${t}:00`; // ✅ ISO מקומי בלי UTC
}

private addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m + mins, 0, 0);
  return d.toTimeString().slice(0, 5);
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

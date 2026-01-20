import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  dbTenant,
  ensureTenantContextReady,
  onTenantChange
} from '../../../services/legacy-compat';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { Lesson } from '../../../models/lesson-schedule.model';
import type { EventClickArg } from '@fullcalendar/core';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import { NoteComponent } from '../../Notes/note.component';
import { UiDialogService } from '../../../services/ui-dialog.service';


type ChildRow = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  birth_date?: string | null;
  status?: string | null;
};

type InstructorRow = {
  id_number: string;
  first_name: string | null;
  last_name: string | null;
  status?: string | null;
};

@Component({
  selector: 'app-secretary-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent],
  templateUrl: './secretary-schedule.html',
  styleUrls: ['./secretary-schedule.css'],
})
export class SecretaryScheduleComponent implements OnInit, OnDestroy {
  @ViewChild(ScheduleComponent) scheduleCmp!: ScheduleComponent;

  children: ChildRow[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  selectedChild: ChildRow | null = null;

  instructors: InstructorRow[] = [];
  selectedInstructorIds: string[] = [];

  instructorResources: { id: string; title: string }[] = [];

  instructorId = '';
  items: ScheduleItem[] = [];

  isFullscreen = false;

  currentRange: { start: string; end: string; viewType: string } | null = null;
  currentViewType:
  | 'timeGridDay'
  | 'timeGridWeek'
  | 'dayGridMonth'
  | 'resourceTimeGridDay'
  | 'resourceTimeGridWeek' = 'timeGridDay';

  autoAssignLoading = false;
  selectedOccurrence: any = null;


  private childAgeById = new Map<string, string>();

  weekInstructorStats: { instructor_id: string; instructor_name: string; totalLessons: number }[] = [];

  private unsubTenantChange: (() => void) | null = null;
private ui = inject(UiDialogService);

  public cu = inject(CurrentUserService);
  private cdr = inject(ChangeDetectorRef);
  occurrence: any;

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();

      this.unsubTenantChange = onTenantChange(async () => {
        await this.reloadAll();
      });

      const user = await this.cu.loadUserDetails();
      this.instructorId = (user?.id_number ?? '').toString();

      await this.reloadAll();
    } catch (e) {
      console.error('init error', e);
    } finally {
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {
    try { this.unsubTenantChange?.(); } catch {}
  }


private hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // להפוך ל-32bit
  }
  return Math.abs(hash);
}

private rebuildInstructorResources(): void {
  // אם לא מסומן כלום – נתייחס כאילו כולם מסומנים
  const activeIds =
    this.selectedInstructorIds.length
      ? this.selectedInstructorIds
      : this.instructors.map(i => i.id_number);

  this.instructorResources = this.instructors
    .filter(i => activeIds.includes(i.id_number))
    .map(i => ({
      id: i.id_number,
      title: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
    }));
}


  private async reloadAll() {
    await this.loadChildren();
    await this.loadInstructors();
    await this.loadLessons(this.currentRange ?? undefined);
    this.filterLessons();
    this.setScheduleItems();
    this.buildWeekStats();
    this.cdr.detectChanges();
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';
  }

  /** ילדים פעילים */
  private async loadChildren(): Promise<void> {
    try {
      const dbc = dbTenant();
      const { data, error } = await dbc
  .from('children')
  .select('child_uuid, first_name, last_name, birth_date, status')
  .in('status', ['Active']);


      if (error) throw error;

      this.children = (data ?? []) as ChildRow[];
    } catch (err) {
      console.error('loadChildren failed', err);
      this.children = [];
    }
      this.childAgeById = new Map(
  this.children.map(c => [c.child_uuid, this.calcChildAge(c.birth_date ?? null)])
);


  }

private calcChildAge(birthDate: string | null): string {
  if (!birthDate) return '';
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return years > 0 ? years.toString() : '';
}

  private async loadInstructors(): Promise<void> {
    try {
      const dbc = dbTenant();
      const { data, error } = await dbc
        .from('instructors')
        .select('id_number, first_name, last_name, status')
        .in('status', ['Active']);

      if (error) throw error;

      this.instructors = (data ?? []) as InstructorRow[];

      // ברירת מחדל – אם המשתמש גם מדריך, מסמנים אותו, אחרת כולם
      if (!this.selectedInstructorIds.length) {
        if (this.instructorId) {
          this.selectedInstructorIds = [this.instructorId];
          this.instructorResources = this.instructors.map(i => ({
  id: i.id_number,
  title: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
}));

this.instructors = (data ?? []) as InstructorRow[];

// ברירת מחדל לבחירה
if (!this.selectedInstructorIds.length) {
  if (this.instructorId) {
    this.selectedInstructorIds = [this.instructorId];
  } else {
    this.selectedInstructorIds = this.instructors.map(i => i.id_number);
  }
}

// 👇 חדש
this.rebuildInstructorResources();


        } else {
          this.selectedInstructorIds = this.instructors.map(i => i.id_number);
        }
      }
    } catch (err) {
      console.error('loadInstructors failed', err);
      this.instructors = [];
    }
    
  }

  get isAllInstructorsSelected(): boolean {
    return (
      this.instructors.length > 0 &&
      this.selectedInstructorIds.length === this.instructors.map(i => i.id_number).length
    );
  }

  toggleAllInstructors() {
  if (this.isAllInstructorsSelected) {
    this.selectedInstructorIds = [];
  } else {
    this.selectedInstructorIds = this.instructors.map(i => i.id_number);
  }

  this.rebuildInstructorResources();  // 👈
  this.filterLessons();
  this.setScheduleItems();
  this.buildWeekStats();
}


  toggleInstructor(id: string) {
  if (this.selectedInstructorIds.includes(id)) {
    this.selectedInstructorIds = this.selectedInstructorIds.filter(x => x !== id);
  } else {
    this.selectedInstructorIds = [...this.selectedInstructorIds, id];
  }

  this.rebuildInstructorResources();  // 👈 חשוב
  this.filterLessons();
  this.setScheduleItems();
  this.buildWeekStats();
}


  async onViewRange(range: { start: string; end: string; viewType: string }) {
    this.currentRange = range;
    this.currentViewType = range.viewType as any;

    await this.loadLessons({ start: range.start, end: range.end });
    this.filterLessons();
    this.setScheduleItems();
    this.buildWeekStats();
    this.cdr.detectChanges();
  }

private async loadLessons(
  range?: { start: string; end: string }
): Promise<void> {
  try {
    const childIds = this.children.map(c => c.child_uuid).filter(Boolean);
    if (!childIds.length) {
      this.lessons = [];
      return;
    }

    const dbc = dbTenant();

    const today = new Date().toISOString().slice(0, 10);
    const in8Weeks = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    const from = range?.start ?? today;
    const to   = range?.end   ?? in8Weeks;

    // 1) השיעורים עצמם (כמו שהיה)
    const { data: occData, error: err1 } = await dbc
  .from('lessons_occurrences')
.select(`
  lesson_id,
  child_id,
  day_of_week,
  start_time,
  end_time,
  lesson_type,
  status,
  instructor_id,
  start_datetime,
  end_datetime,
  occur_date,

  lesson_occurrence_exceptions (
    status,
    is_makeup_allowed
  )
`)

      .in('child_id', childIds)
      .gte('occur_date', from)
      .lte('occur_date', to)
      .order('start_datetime', { ascending: true });

    if (err1) throw err1;

    // 2) משאבי סוס+מגרש לפי אותו טווח
    const { data: resData, error: err2 } = await dbc
      .from('lessons_with_children')
      .select('lesson_id, occur_date, horse_name, arena_name')
      .in('child_id', childIds)
      .gte('occur_date', from)
      .lte('occur_date', to);

    if (err2) throw err2;

    // 3) בניית Map לפי (lesson_id + occur_date)
    const resourceByKey = new Map<
      string,
      { horse_name: string | null; arena_name: string | null }
    >();

    for (const row of resData ?? []) {
      const key = `${row.lesson_id}::${row.occur_date}`;
      resourceByKey.set(key, {
        horse_name: row.horse_name ?? null,
        arena_name: row.arena_name ?? null,
      });
    }

    // 4) מיפוי לשיעורים + הוספת horse/arena מה-Map
    const nameByChild = new Map(
      this.children.map(c => [
        c.child_uuid,
        `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
      ])
    );

    const instructorNameById = new Map(
      this.instructors.map(i => [
        i.id_number,
        `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
      ])
    );

    this.lessons = (occData ?? []).map((r: any) => {
      const ex = r.lesson_occurrence_exceptions;
const finalStatus =
  ex?.status === 'בוטל'
    ? 'בוטל'
    : r.status;

const isMakeupAllowed =
  ex?.is_makeup_allowed ?? false;

      const key = `${r.lesson_id}::${r.occur_date}`;
      const res = resourceByKey.get(key);

      return {
        lesson_id: String(r.lesson_id ?? ''),
        id:        String(r.lesson_id ?? ''),
        child_id:  r.child_id,
        day_of_week: r.day_of_week,
        start_time:  r.start_time,
        end_time:    r.end_time,
        lesson_type: r.lesson_type,
        status:      r.status,
        instructor_id:   r.instructor_id ?? '',
        instructor_name: instructorNameById.get(r.instructor_id) || '',
        child_color: this.getColorForChild(r.child_id),
        child_name:  nameByChild.get(r.child_id) || '',
        start_datetime: r.start_datetime ?? null,
        end_datetime:   r.end_datetime ?? null,
        occur_date:     r.occur_date ?? null,
  is_makeup_allowed: isMakeupAllowed,
        // 👇 עכשיו באמת מגיע מהנתונים של ה-view
        horse_name: res?.horse_name ?? null,
        arena_name: res?.arena_name ?? null,
      } as Lesson;
    });
  } catch (err) {
    console.error('loadLessons failed', err);
    this.lessons = [];
  }
}


  /** סינון שיעורים לפי מדריכים מסומנים + טווח תצוגה */
  private filterLessons(): void {
    let src = [...this.lessons];

    if (!this.selectedInstructorIds.length) {
      if (this.instructorId) {
        this.selectedInstructorIds = [this.instructorId];
      } else {
        this.selectedInstructorIds = this.instructors.map(i => i.id_number);
      }
    }

    const selected = this.selectedInstructorIds.filter(Boolean);

    if (selected.length) {
      src = src.filter(l =>
        selected.includes((l.instructor_id ?? '').toString())
      );
    }

    if (this.currentRange) {
      const { start, end } = this.currentRange;
      src = src.filter(l => {
        const d =
          (l as any).occur_date ||
          ((l as any).start_datetime
            ? (l as any).start_datetime.slice(0, 10)
            : '');
        if (!d) return true;
        return d >= start && d <= end;
      });
    }

    this.filteredLessons = src;
  }

 private setScheduleItems(): void {
  const src = this.filteredLessons;
  if (!src?.length) {
    this.items = [];
    return;
  }

  const getDate = (l: any): string | null => {
    if (l.occur_date) return l.occur_date;
    if (l.start_datetime) return String(l.start_datetime).slice(0, 10);
    return null;
  };

 const makeLessonEvent = (lesson: any): ScheduleItem => {
  const start = this.ensureIso(
    lesson.start_datetime as any,
    lesson.start_time as any,
    lesson.occur_date as any
  );
  const end = this.ensureIso(
    lesson.end_datetime as any,
    lesson.end_time as any,
    lesson.occur_date as any
  );

  const childName = lesson.child_name ?? '';
  const lessonType = lesson.lesson_type ?? '';
  const age = this.childAgeById.get(lesson.child_id) || '';
  const childDisplay = age ? `${childName} (${age})` : childName;

  return {
    id: lesson.id,
    title: childDisplay,
    start,
    end,
    color: lesson.child_color,
    status: lesson.status,
    meta: {
      status: lesson.status ?? '',
      child_id: lesson.child_id,
      child_name: childDisplay,
      instructor_id: lesson.instructor_id,
      instructor_name: lesson.instructor_name,
      lesson_type: lessonType,
      children: childDisplay,   
      horse_name: lesson.horse_name,
      arena_name: lesson.arena_name,
        lesson_id: lesson.lesson_id,          // זה ה-UUID של השיעור
  occur_date: lesson.occur_date,        // YYYY-MM-DD
  is_makeup_allowed: lesson['is_makeup_allowed'] ?? false, 
    },
  } as ScheduleItem;
};

  // ===== חודשי – כמו שהיה =====
  if (this.currentViewType === 'dayGridMonth') {
    const perDay = new Map<string, number>();

    src.forEach(l => {
      const d = getDate(l);
      if (!d) return;
      perDay.set(d, (perDay.get(d) || 0) + 1);
    });

    this.items = Array.from(perDay.entries()).map(([date, count]) => ({
      id: `sum-day-${date}`,
      title: `${count} שיעורים`,
      start: `${date}T00:00:00`,
      end: `${date}T23:59:59`,
      color: 'transparent',
      status: 'אושר',
      meta: {
        status: '',
        child_id: '',
        child_name: '',
        instructor_id: '',
        instructor_name: '',
        lesson_type: 'summary-day',
        isSummaryDay: '1',
      },
    })) as any;

    return;
  }

  // ===== שבוע – טבלת מדריכים × ימים =====
// ===== תצוגת שבוע – סיכום לכל מדריך בכל יום (אחד מתחת לשני) =====
if (this.currentViewType === 'timeGridWeek') {
  type Key = string; // date|instructor_id

  const perDayInstructor = new Map<Key, {
    date: string;
    instructor_id: string;
    instructor_name: string;
    count: number;
  }>();

  const getDate = (l: any): string | null => {
    if (l.occur_date) return l.occur_date;
    if (l.start_datetime) return String(l.start_datetime).slice(0, 10);
    return null;
  };

  // אוספים: כמה שיעורים יש לכל מדריך בכל יום
  for (const l of src) {
    const d = getDate(l);
    if (!d) continue;

    const instId = (l as any).instructor_id || '';
    const instName = (l as any).instructor_name || 'ללא מדריך';
    const key: Key = `${d}|${instId}`;

    if (!perDayInstructor.has(key)) {
      perDayInstructor.set(key, {
        date: d,
        instructor_id: instId,
        instructor_name: instName,
        count: 0,
      });
    }
    perDayInstructor.get(key)!.count++;
  }

  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);

  // ממירים למבנה לפי יום → [סיכומים]
  const perDate = new Map<string, {
    date: string;
    instructor_id: string;
    instructor_name: string;
    count: number;
  }[]>();

  for (const g of perDayInstructor.values()) {
    if (!perDate.has(g.date)) perDate.set(g.date, []);
    perDate.get(g.date)!.push(g);
  }

  const result: ScheduleItem[] = [];

  for (const [date, groups] of perDate.entries()) {
    // שיהיה מסודר לפי שם מדריך
    groups.sort((a, b) =>
      a.instructor_name.localeCompare(b.instructor_name, 'he')
    );

    groups.forEach((g, idxInDay) => {
      // כל מדריך שעה אחרת – 7, 8, 9, ...
      const baseHour = 7;
      const startHour = baseHour + idxInDay;
      const endHour = startHour;

      const start = `${date}T${pad(startHour)}:00:00`;
      const end   = `${date}T${pad(endHour)}:50:00`;

      result.push({
        id: `sum-week-${date}-${g.instructor_id}`,
        title: `${g.instructor_name} · ${g.count} שיעורים`,
        start,
        end,
        status: 'אושר',
        meta: {
          status: '',
          child_id: '',
          child_name: '',
          instructor_id: g.instructor_id,
          instructor_name: g.instructor_name,
          lesson_type: 'summary-week',
          isSummarySlot: '1',
        },
      } as ScheduleItem);
    });
  }

  this.items = result;
  return;
}
  // ===== יום – בשעה 07:00 שם המדריך, ובשעות – כרטיסיות ילדים (עם גיל) =====
  // ===== יום – מדריך בשורה ב-07:00, ובשעות כרטיסייה אחת לכל שיעור (גם כפול) =====
if (this.currentViewType === 'timeGridDay') {
  this.items = src.map(makeLessonEvent);
  return;

}

  // ברירת מחדל (אם יהיה View נוסף) – אירוע לכל שיעור
  this.items = src.map(makeLessonEvent);
}

  private ensureIso(datetime?: string | null, time?: string | null, baseDate?: string | null): string {
    if (datetime && typeof datetime === 'string' && datetime.includes('T')) return datetime;

    if (datetime && typeof datetime === 'string' && datetime.trim() !== '') {
      return datetime.replace(' ', 'T');
    }

    const base = baseDate ? new Date(baseDate) : new Date();
    const d = new Date(base);
    if (time) {
      const [hh, mm] = String(time).split(':').map((x) => parseInt(x, 10) || 0);
      d.setHours(hh, mm, 0, 0);
    }
    return this.toLocalIso(d);
  }

  private toLocalIso(date: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private getColorForChild(child_id: string): string {
    const index = this.children.findIndex((c) => c.child_uuid === child_id);
    const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
    return colors[(index >= 0 ? index : 0) % colors.length];
  }

  onEventClick(arg: EventClickArg): void {
  const ext: any = arg.event.extendedProps || {};
  const meta: any = ext.meta || ext;

  const childId =
    meta.child_id ||
    ext.child_id ||
    null;

  if (!childId) {
    console.warn('❌ secretary onEventClick – no child_id', ext);
    this.selectedChild = null;
    this.selectedOccurrence = null;
    return;
  }

  const child =
    this.children.find(c => c.child_uuid === childId) ?? null;

  this.selectedChild = child ? { ...child } : null;

  // 🔑 lesson_id – לוקחים מה-meta או מה-id של האירוע
let lessonId: string | null = meta.lesson_id ?? null;


  if (!lessonId && arg.event.id) {
    lessonId = String(arg.event.id);
  }

  // 🔑 occur_date
  const occurDate =
    meta.occur_date ??
    (arg.event.start
      ? arg.event.start.toISOString().slice(0, 10)
      : null);

  this.selectedOccurrence = {
    lesson_id: lessonId,
    child_id: childId,
    occur_date: occurDate,
    status: meta.status ?? null,
    lesson_type: meta.lesson_type ?? null,
    start: arg.event.start,
    end: arg.event.end,
    is_makeup_allowed: !!meta.is_makeup_allowed,
  };

  
  this.cdr.detectChanges();
}

  onDateClick(arg: any): void {
    const dateStr = arg?.dateStr ??
      (arg?.date ? arg.date.toISOString().slice(0, 10) : '');

    if (!dateStr) return;

    if (this.currentViewType === 'dayGridMonth' || this.currentViewType === 'timeGridWeek') {
      if (this.scheduleCmp) {
        this.scheduleCmp.goToDay(dateStr);
      }
      return;
    }
  }

  private buildWeekStats(): void {
    if (this.currentViewType !== 'timeGridWeek') {
      this.weekInstructorStats = [];
      return;
    }

    const stats = new Map<string, { instructor_id: string; instructor_name: string; totalLessons: number }>();

    for (const l of this.filteredLessons) {
      const id = (l as any).instructor_id || '';
      if (!id) continue;
      const key = id;
      const name = (l as any).instructor_name || id;

      if (!stats.has(key)) {
        stats.set(key, { instructor_id: id, instructor_name: name, totalLessons: 0 });
      }
      stats.get(key)!.totalLessons++;
    }

    this.weekInstructorStats = Array.from(stats.values()).sort((a, b) =>
      a.instructor_name.localeCompare(b.instructor_name, 'he')
    );
  }

  async autoAssignForCurrentDay(): Promise<void> {
  // רק בתצוגת יום, ובלוח של המזכירה
  if (
    !this.currentRange ||
    !(
      this.currentViewType === 'timeGridDay' ||
      this.currentViewType === 'resourceTimeGridDay'
    )
  ) {
    return;
  }

  const day = this.currentRange.start; // start==end בתצוגת יום
  if (!day) return;

  if (this.autoAssignLoading) return;
  this.autoAssignLoading = true;

  try {
    const dbc = dbTenant();

    const p_date = String(day).slice(0, 10); // YYYY-MM-DD


    const { data, error } = await dbc.rpc(
      'auto_assign_horses_and_arenas',
      { p_date: day } // טיפוס DATE ב-Postgres
    );

    if (error) throw error;

    // אחרי השיבוץ – לטעון מחדש את השיעורים של היום
    await this.loadLessons({ start: day, end: day });
    this.filterLessons();
    this.setScheduleItems();
    this.buildWeekStats();
    this.cdr.detectChanges();

  await this.ui.alert(
    'שובצו סוסים ומגרשים לשיעורים של היום. ניתן לערוך שיעור-שיעור בממשק המתאים.',
    'הצלחה'
  );
  } catch (e: any) {
    console.error('autoAssignForCurrentDay failed', e);
   await this.ui.alert(
    'שיבוץ סוסים ומגרשים נכשל: ' + (e?.message ?? e),
    'שגיאה'
  );

  } finally {
    this.autoAssignLoading = false;
  }
}
async onToggleMakeupAllowed(checked: boolean) {
  try {
    await ensureTenantContextReady();

    const lessonId = this.occurrence?.lesson_id;
    const occurDate = this.occurrence?.occur_date;

    if (!lessonId || !occurDate) {
      console.warn('❌ Missing lesson_id / occur_date', this.occurrence);
      return;
    }

    const dbc = dbTenant();

    const { error } = await dbc
      .from('lesson_occurrence_exceptions')
      .upsert(
        {
          lesson_id: lessonId,
          occur_date: occurDate,
          status: 'בוטל',                // חייב לפי CHECK
          is_makeup_allowed: checked,
          canceller_role: 'secretary',
          cancelled_at: new Date().toISOString(),
        },
        { onConflict: 'lesson_id,occur_date' }
      );

    if (error) throw error;

    // ✅ עדכון מיידי ב-UI
    this.occurrence = {
      ...this.occurrence,
      is_makeup_allowed: checked,
    };

  } catch (e) {
    console.error('toggle makeup failed', e);
     await this.ui.alert('שגיאה בעדכון "ניתן להשלמה"', 'שגיאה');

  }
}

}

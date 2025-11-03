import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
<<<<<<< HEAD
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import { dbTenant } from '../../../services/supabaseClient.service';
import type { EventClickArg, DatesSetArg } from '@fullcalendar/core';
=======
import { dbTenant } from '../../../services/supabaseClient.service';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
import { NoteComponent } from '../../Notes/note.component';
import { Lesson } from '../../../models/lesson-schedule.model';
import { EventClickArg } from '@fullcalendar/core';

@Component({
  selector: 'app-instructor-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss']
})
<<<<<<< HEAD
export class InstructorScheduleComponent implements OnInit, AfterViewInit {
  @ViewChild(ScheduleComponent) scheduleComp!: ScheduleComponent;

  private cdr = inject(ChangeDetectorRef);
  private cu = inject(CurrentUserService);

  children: Child[] = [];
=======
export class InstructorScheduleComponent implements OnInit {
  children: any[] = [];
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  selectedChild: any = null;
  instructorId: string = "";
  items: ScheduleItem[] = [];

  constructor(
    public cu: CurrentUserService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    await this.loadChildren();
    await this.loadLessons();
    this.filterLessons();
    this.setScheduleItems();
    this.cdr.detectChanges();
  }

  async loadChildren() {
    try {
      const user = await this.cu.loadUserDetails();
      if (!user) { this.children = []; return; }

<<<<<<< HEAD
      // טווח כולל שיעורים אחורה וקדימה
      const startYmd = ymd(addDays(new Date(), -14));
      const endYmd = ymd(addDays(new Date(), 60));
=======
      this.instructorId = user.id_number!;
      const dbc = dbTenant();
      const { data: kids, error } = await dbc
        .from('children')
        .select('*')
        .eq('status', 'active');
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452

      if (error) { console.error(error); this.children = []; return; }

      this.children = kids ?? [];
    } catch (err) {
      console.error(err);
      this.children = [];
    }
  }

<<<<<<< HEAD
  ngAfterViewInit(): void {
    const calendarApi = this.scheduleComp?.calendarApi;
    if (calendarApi) {
      calendarApi.on('datesSet', (info: DatesSetArg) => {
        this.currentView = info.view.type;
        this.setScheduleItems();
      });

      // תיקון קליק בתצוגת חודש גם על טקסט
      calendarApi.on('dateClick', (event) => this.onDateClick(event));
    }
  }

  private async loadLessonsForRange(startYmd: string, endYmd: string): Promise<void> {
=======
  async loadLessons() {
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
    const dbc = dbTenant();
    const childIds = this.children.map(c => c.child_uuid);
    if (!childIds.length) { this.lessons = []; return; }

    const today = new Date().toISOString().slice(0, 10);
    const in8Weeks = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const { data, error } = await dbc
      .from('lessons_occurrences')
      .select('*')
      .in('child_id', childIds)
      .gte('occur_date', today)
      .lte('occur_date', in8Weeks);

    if (error) { console.error(error); this.lessons = []; return; }

<<<<<<< HEAD
  private async loadChildrenAndRefs(childIds: string[]): Promise<void> {
    const dbc = dbTenant();

    const { data: kids, error: errKids } = await dbc
      .from('children')
      .select('child_uuid, full_name, birth_date, status, parent_uid, medical_notes')
      .in('child_uuid', childIds);

    if (errKids) throw errKids;
    const childList: Child[] = (kids ?? []) as Child[];

    const parentUids = Array.from(new Set(childList.map(c => c.parent_uid!).filter(Boolean)));
    const { data: parentsData, error: errParents } = parentUids.length
      ? await dbc.from('parents').select('uid, full_name, email, phone').in('uid', parentUids)
      : { data: [] as Parent[], error: null };

    if (errParents) throw errParents;
    const parentsMap = new Map<string, Parent>((parentsData ?? []).map((p: { uid: string }) => [p.uid, p]));

    this.children = childList.map(c => ({
      ...c,
      age: c.birth_date ? calcAge(c.birth_date) : undefined,
      parent: c.parent_uid ? (parentsMap.get(c.parent_uid) ?? null) : null
    }));
  }

  /** בונה את הנתונים לתצוגה */
  private setScheduleItems(): void {
    if (!this.scheduleComp?.calendarApi) return;
    const src = this.filteredLessons.length ? this.filteredLessons : this.lessons;

    // תצוגת חודש
    if (this.currentView === 'dayGridMonth') {
      const grouped: Record<string, Lesson[]> = {};
      for (const l of src) {
        const day = (l as any).occur_date?.slice(0, 10) || (l as any).start_datetime?.slice(0, 10);
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(l);
      }

      this.items = Object.entries(grouped).map(([day, lessons]) => {
        const regular = lessons.filter(l => l.lesson_type === 'רגיל').length;
        const makeup = lessons.filter(l => l.lesson_type === 'השלמה').length;
        const canceled = lessons.filter(l => l.status === 'בוטל').length;
        const count = lessons.length;

        // מציג רק מה שקיים בפועל
        const parts: string[] = [];
        if (count) parts.push(`${count} שיעור${count > 1 ? 'ים' : ''}`);
        if (regular) parts.push(`${regular} רגיל`);
        if (makeup) parts.push(`${makeup} השלמה`);
        if (canceled) parts.push(`${canceled} בוטל`);

        return {
          id: day,
          title: parts.join(' | '),
          start: day,
          end: day,
          color: '#e8f5e9'
        } as ScheduleItem;
      });

      this.cdr.detectChanges();
      return;
    }

    // תצוגת יום/שבוע
    this.items = src.map(l => {
      const startISO = this.ensureIso(l.start_datetime, l.start_time, l.occur_date);
      const endISO = this.ensureIso(l.end_datetime, l.end_time, l.occur_date);
      const now = new Date();

      const child = this.children.find(c => c.child_uuid === l.child_id);
      const name = child?.full_name || '';
      const age = child?.age ? `(${child.age})` : '';
      const lessonType = l.lesson_type ? `שיעור ${l.lesson_type}` : 'שיעור';

      const startTime = (l.start_time || startISO.slice(11, 16)).replace(/:00$/, '');
      const endTime = (l.end_time || endISO.slice(11, 16)).replace(/:00$/, '');
      const timeRange = startTime && endTime ? `${startTime}–${endTime}` : '';

      let color = '#b5ead7';
      if (l.status === 'בוטל') color = '#ffcdd2';
      else if (new Date(endISO) < now) color = '#e0e0e0';

      return {
        id: `${(l as any)['lesson_id'] || 'noid'}_${l.child_id}_${l.occur_date}_${l.start_time || '00:00'}`,
        title: `${name} ${age} — ${lessonType} ${timeRange}`.trim(),
        start: startISO,
        end: endISO,
        color,
        meta: {
          child_id: l.child_id,
          child_name: name,
          instructor_id: l.instructor_id,
          instructor_name: (l as any).instructor_name || '',
          status: l.status,
          lesson_type: lessonType
        },
        status: l.status
      } as ScheduleItem;
    });

    this.cdr.detectChanges();
  }

  private ensureIso(datetime?: string, time?: string, baseDate?: string | Date): string {
    if (datetime) return datetime;
    const base = typeof baseDate === 'string' ? new Date(baseDate) : (baseDate ?? new Date());
    const d = new Date(base);
    if (time) {
      const [hh, mm] = time.split(':');
      d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    }
    return d.toISOString();
  }

  onEventClick(arg: EventClickArg): void {
    const childId: string | undefined = arg.event.extendedProps['child_id'];
    if (!childId) return;
    this.selectedChild = this.children.find(c => c.child_uuid === childId) ?? null;
    this.cdr.detectChanges();
  }

  onDateClick(event: any): void {
    const api = this.scheduleComp?.calendarApi;
    if (!api) return;
    if (api.view.type === 'dayGridMonth') {
      api.changeView('timeGridDay', event.dateStr);
    } else {
      console.log('📅 נבחר תאריך בתצוגת יום/שבוע:', event.dateStr);
    }
  }
}

/* ---------- פונקציות עזר ---------- */
function ymd(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
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
=======
    this.lessons = (data ?? []).map((r: any) => ({
      id: String(r.lesson_id),
      child_id: r.child_id,
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      lesson_type: r.lesson_type,
      status: r.status,
      instructor_id: r.instructor_id ?? '',
      instructor_name: r.instructor_name ?? '',
      child_color: this.getColorForChild(r.child_id),
      child_name: this.children.find(c => c.child_uuid === r.child_id)?.full_name || '',
      start_datetime: r.start_datetime,
      end_datetime: r.end_datetime,
    }));
  }

  filterLessons() {
    this.filteredLessons = this.lessons.filter(l => l.instructor_id === this.instructorId);
  }

  setScheduleItems() {
    const src = this.filteredLessons.length ? this.filteredLessons : this.lessons;

    this.items = src.map(lesson => {
      const startFallback = this.getLessonDateTime(lesson.day_of_week, lesson.start_time);
      const endFallback = this.getLessonDateTime(lesson.day_of_week, lesson.end_time);
      const start = this.isoWithTFallback(lesson.start_datetime, startFallback);
      const end = this.isoWithTFallback(lesson.end_datetime, endFallback);

      return {
        id: lesson.id,
        title: `${lesson.lesson_type}${lesson.instructor_name ? ' עם ' + lesson.instructor_name : ''}`,
        start,
        end,
        color: lesson.child_color,
        meta: {
          child_id: lesson.child_id,
          child_name: lesson.child_name,
          instructor_id: lesson.instructor_id,
          instructor_name: lesson.instructor_name,
          status: lesson.status
        },
        status: lesson.status
      } satisfies ScheduleItem;
    });

    this.cdr.detectChanges();
  }

  getLessonDateTime(dayName: string, timeStr: string): string {
    const dayMap: Record<string, number> = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
    const today = new Date();
    const targetDay = dayMap[dayName];
    const diff = (targetDay - today.getDay() + 7) % 7;

    const eventDate = new Date(today);
    eventDate.setDate(today.getDate() + diff);
    const [hours, minutes] = timeStr.split(':').map(Number);
    eventDate.setHours(hours, minutes, 0, 0);
    return this.toLocalIso(eventDate);
  }

  private isoWithTFallback(s: string | undefined | null, fallbackIso: string): string {
    if (s && s.trim() !== '') return s.includes('T') ? s : s.replace(' ', 'T');
    return fallbackIso;
  }

  private toLocalIso(date: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  getColorForChild(child_id: string): string {
    const index = this.children.findIndex(c => c.child_uuid === child_id);
    const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
    return colors[(index >= 0 ? index : 0) % colors.length];
  }

  onEventClick(arg: EventClickArg) {
    const childId = arg.event.extendedProps['child_id'];
    const child = this.children.find(c => c.child_uuid === childId);

    if (!child) {
      console.warn('לא נמצא ילד מתאים!', arg.event.extendedProps);
      this.selectedChild = null;
      return;
    }

    this.selectedChild = { ...child };
  }

  onDateClick(arg: any) {
    console.log('תאריך נבחר:', arg.dateStr || arg.date);
  }
}
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452

import {
  Component,
  OnInit,
  ChangeDetectorRef,
  ViewChild,
  AfterViewInit,
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
import type { EventClickArg, DatesSetArg } from '@fullcalendar/core';

import { NoteComponent } from '../../Notes/note.component';
import { Lesson } from '../../../models/lesson-schedule.model';

type UUID = string;

interface Instructor {
  id_number: string;
  first_name?: string;
  last_name?: string;
}

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
  status?: 'Active' | 'Pending Addition Approval' | 'Pending Deletion Approval' | 'Deleted';
  parent_uid?: string;
  medical_notes?: string | null;
  age?: number;
  parent?: Parent | null;
}

@Component({
  selector: 'app-instructor-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss']
})
export class InstructorScheduleComponent implements OnInit, AfterViewInit {
  @ViewChild(ScheduleComponent) scheduleComp!: ScheduleComponent;

  private lastRange: { start: string; end: string } | null = null;

  private cdr = inject(ChangeDetectorRef);
  private cu = inject(CurrentUserService);

  children: Child[] = [];
  lessons: Lesson[] = [];
  items: ScheduleItem[] = [];
  selectedChild: Child | null = null;

  instructorId = '';
  currentView = 'timeGridWeek';
  loading = false;
  error: string | null = null;
  currentDate = '';
  isFullscreen = false;

  async ngOnInit(): Promise<void> {
    try {
      this.loading = true;

      // ✅ קודם כל – לוודא שיש הקשר טננט
      await ensureTenantContextReady();

      // כעת מותר להשתמש ב־CurrentUserService וב־dbTenant
      console.log('✅ טננט מוכן לשימוש');
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
        new Set(this.lessons.map((l) => l.child_id))
      ).filter(Boolean) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
      }

      this.setScheduleItems();
    } catch (err: any) {
      console.error('❌ init error', err);
      this.error = err?.message || 'שגיאה בטעינה';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit(): void {
    const calendarApi = this.scheduleComp?.calendarApi;
    if (calendarApi) {
      calendarApi.on('datesSet', (info: DatesSetArg) => {
        this.currentView = info.view.type;
        this.currentDate = info.view.title;
        this.setScheduleItems();
      });
    }
  }

  /** ========= DB loaders ========= **/

  private async loadLessonsForRange(
    startYmd: string,
    endYmd: string
  ): Promise<void> {
    console.log('🔄 loadLessonsForRange', this.instructorId, startYmd, endYmd);

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
      `
      )
      .eq('instructor_id', this.instructorId)
      .gte('occur_date', startYmd)
      .lte('occur_date', endYmd);
      // .order('start_datetime', { ascending: true });

    console.log('📚 loaded lessons occurrences:', data, error);

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
      `
      )
      .in('child_uuid', childIds);

    if (errKids) throw errKids;
    const childList: Child[] = (kids ?? []) as Child[];

    const parentUids = Array.from(
      new Set(childList.map((c) => c.parent_uid!).filter(Boolean))
    ) as string[];

    let parentsMap = new Map<string, Parent>();

    if (parentUids.length) {
      const { data: parentsData, error: pErr } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, email, phone')
        .in('uid', parentUids);

      if (!pErr && parentsData) {
        parentsMap = new Map<string, Parent>(
          (parentsData as Parent[]).map((p) => [p.uid, p])
        );
      }
    }

    this.children = childList.map((c) => ({
      ...c,
      age: c.birth_date ? calcAge(c.birth_date) : undefined,
      parent: c.parent_uid ? parentsMap.get(c.parent_uid) ?? null : null,
    }));
  }

  /** ========= View mapping ========= **/

  private setScheduleItems(): void {
    if (!this.scheduleComp?.calendarApi) return;
    const src = this.lessons;

    // תצוגת חודש – סיכום יומי
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
        const count = lessons.length;
        const regular = lessons.filter((l) => l.lesson_type === 'רגיל').length;
        const makeup =
          lessons.filter((l) => l.lesson_type === 'השלמה').length;
        const canceled = lessons.filter((l) => l.status === 'בוטל').length;

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
          color: '#e8f5e9',
        } as ScheduleItem;
      });

      this.cdr.detectChanges();
      return;
    }

    // תצוגת שבוע/יום – מופעים מלאים
    this.items = src.map((l) => {
      const startISO = this.ensureIso(l.start_datetime, l.start_time, l.occur_date);
      const endISO = this.ensureIso(l.end_datetime, l.end_time, l.occur_date);
      const child = this.children.find((c) => c.child_uuid === l.child_id);

      let color = '#b5ead7';
      if (l.status === 'בוטל') color = '#ffcdd2';
      else if (new Date(endISO) < new Date()) color = '#e0e0e0';

      return {
        id: `${l.lesson_id}_${l.child_id}_${l.occur_date}`,
        title: `${child?.first_name || ''} ${child?.last_name || ''} (${child?.age ?? ''}) — ${
          l.lesson_type ?? ''
        }`,
        start: startISO,
        end: endISO,
        color,
        meta: {
          child_id: l.child_id,
          child_name: `${child?.first_name || ''} ${child?.last_name || ''}`.trim(),
          instructor_id: l.instructor_id,
          instructor_name: '',
          status: l.status,
          lesson_type: l.lesson_type ?? '',
        },
        status: l.status,
      } as ScheduleItem;
    });

    this.cdr.detectChanges();
  }

  private ensureIso(
    datetime?: string,
    time?: string,
    baseDate?: string | Date
  ): string {
    if (datetime) return datetime;
    const base =
      typeof baseDate === 'string' ? new Date(baseDate) : baseDate ?? new Date();
    const d = new Date(base);
    if (time) {
      const [hh, mm] = time.split(':');
      d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    }
    return d.toISOString();
  }

  async onViewRangeChange(range: { start: string; end: string }) {
    try {
      // אם עדיין אין מדריך – אין מה לטעון
      if (!this.instructorId) {
        return;
      }

      // אם הטווח לא השתנה – לחסוך קריאה מיותרת
      if (
        this.lastRange &&
        this.lastRange.start === range.start &&
        this.lastRange.end === range.end
      ) {
        return;
      }
      this.lastRange = range;

      this.loading = true;
      console.log('🔄 viewRange change:', range.start, '→', range.end);

      // 1. טוענים שיעורים לטווח החדש
      await this.loadLessonsForRange(range.start, range.end);

      // 2. טוענים ילדים רלוונטיים
      const childIds = Array.from(
        new Set(this.lessons.map(l => l.child_id))
      ).filter(Boolean) as string[];

      if (childIds.length) {
        await this.loadChildrenAndRefs(childIds);
      }

      // 3. מעדכנים את האירועים ביומן
      this.setScheduleItems();
    } catch (err: any) {
      console.error('❌ viewRange error', err);
      this.error = err?.message || 'שגיאה בטעינת השיעורים';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /** ========= Events ========= **/

  onEventClick(arg: EventClickArg): void {
    const childId: string | undefined = arg.event.extendedProps['child_id'];
    if (!childId) return;
    this.selectedChild = this.children.find((c) => c.child_uuid === childId) ?? null;
    this.cdr.detectChanges();
  }

  onDateClick(event: any): void {
    const api = this.scheduleComp?.calendarApi;
    if (!api) return;
    if (api.view.type === 'dayGridMonth') {
      api.changeView('timeGridDay', event.dateStr);
    }
  }

  changeView(view: 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth') {
    this.currentView = view;
    this.scheduleComp.changeView(view);
  }

  next() {
    this.scheduleComp.next();
  }
  prev() {
    this.scheduleComp.prev();
  }
  today() {
    this.scheduleComp.today();
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';
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

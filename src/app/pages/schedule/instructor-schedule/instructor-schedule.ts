import { Component, OnInit, ChangeDetectorRef, ViewChild, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import { dbTenant } from '../../../services/supabaseClient.service';
import type { EventClickArg, DatesSetArg } from '@fullcalendar/core';

import { NoteComponent } from '../../Notes/note.component';
import { Lesson } from '../../../models/lesson-schedule.model';

type UUID = string;

interface Instructor {
  id_number: string;
  full_name?: string;
}
interface Parent {
  uid: string;
  full_name?: string;
  email?: string;
  phone?: string;
}
interface Child {
  child_uuid: UUID;
  full_name?: string;
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

  private cdr = inject(ChangeDetectorRef);
  private cu  = inject(CurrentUserService);

  children: Child[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  items: ScheduleItem[] = [];
  selectedChild: Child | null = null;

  instructorId = '';
  currentView: string = 'timeGridWeek';
  loading = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.loading = true;

      const user = await this.cu.loadUserDetails();
      if (!user?.id_number) {
        this.error = 'לא נמצאו פרטי מדריך. התחברי שוב.';
        return;
      }
      this.instructorId = String(user.id_number).trim();

      const startYmd = ymd(new Date());
      const endYmd = ymd(addDays(new Date(), 56));

      await this.loadLessonsForRange(startYmd, endYmd);

      const childIds = Array.from(new Set(this.lessons.map(l => l.child_id))).filter(Boolean) as string[];
      if (!childIds.length) {
        this.children = [];
        this.items = [];
        return;
      }

      await this.loadChildrenAndRefs(childIds);
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
        this.setScheduleItems();
      });
    }
  }

  private async loadLessonsForRange(startYmd: string, endYmd: string): Promise<void> {
    const dbc = dbTenant();
    const { data, error } = await dbc
      .from('lessons_occurrences')
      .select('lesson_id, child_id, instructor_id, lesson_type, status, start_datetime, end_datetime, occur_date, start_time, end_time')
      .eq('instructor_id', this.instructorId)
      .gte('occur_date', startYmd)
      .lte('occur_date', endYmd)
      .order('start_datetime', { ascending: true });

    if (error) throw error;
    this.lessons = (data ?? []) as Lesson[];
  }

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
    const parentsMap = new Map<string, Parent>((parentsData ?? []).map((p: { uid: any; }) => [p.uid, p]));

    this.children = childList.map(c => ({
      ...c,
      age: c.birth_date ? calcAge(c.birth_date) : undefined,
      parent: c.parent_uid ? (parentsMap.get(c.parent_uid) ?? null) : null
    }));
  }

  /** בונה את הנתונים לפי סוג התצוגה */
  private setScheduleItems(): void {
    if (!this.scheduleComp?.calendarApi) return;

    const src = this.filteredLessons.length ? this.filteredLessons : this.lessons;

    // תצוגת חודש – סיכום כללי
    if (this.currentView === 'dayGridMonth') {
      const grouped: Record<string, Lesson[]> = {};
      for (const l of src) {
        const day = (l as any).occur_date?.slice(0, 10) || (l as any).start_datetime?.slice(0, 10);
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(l);
      }

      this.items = Object.entries(grouped).map(([day, lessons]) => {
        const count = lessons.length;
        const regular = lessons.filter(l => l.lesson_type === 'רגיל').length;
        const makeup = lessons.filter(l => l.lesson_type === 'השלמה').length;
        const canceled = lessons.filter(l => l.status === 'בוטל').length;

        const titleParts = [];
        titleParts.push(`סה״כ ${count}`);
        if (regular) titleParts.push(`${regular} רגיל`);
        if (makeup) titleParts.push(`${makeup} השלמה`);
        if (canceled) titleParts.push(`${canceled} בוטל`);

        return {
          id: day,
          title: titleParts.join(' | '),
          start: day,
          end: day,
          color: '#e8f5e9'
        } as ScheduleItem;
      });

      console.log('📅 Month summary items:', this.items);
      this.cdr.detectChanges();
      return;
    }

    // תצוגת יום/שבוע – פירוט מלא
    this.items = src.map(l => {
      const startISO = this.ensureIso(l.start_datetime, l.start_time, l.occur_date);
      const endISO   = this.ensureIso(l.end_datetime, l.end_time, l.occur_date);

      const child = this.children.find(c => c.child_uuid === l.child_id);
      const name = child?.full_name || '';
      const age = child?.age ? `בן ${child.age}` : '';
      const lessonType = l.lesson_type ? `שיעור ${l.lesson_type}` : 'שיעור';

      const startTime = (l.start_time || startISO.slice(11, 16)).replace(/:00$/, '');
      const endTime   = (l.end_time   || endISO.slice(11, 16)).replace(/:00$/, '');
      const timeRange = startTime && endTime ? `${startTime}–${endTime}` : '';

      const title = `${name} ${age} — ${lessonType} ${timeRange}`.trim();

      return {
        id: String(l.id ?? `${l.child_id}__${startISO}`),
        title,
        start: startISO,
        end: endISO,
        color: l.child_color || '#b5ead7',
        meta: {
          child_id: l.child_id,
          child_name: name,
          instructor_id: l.instructor_id,
          instructor_name: l.instructor_name || '',
          status: l.status,
          lesson_type: lessonType
        },
        status: l.status
      } as ScheduleItem;
    });

    console.log('📆 Week/day items:', this.items);
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

  /** לחיצה על יום בתצוגת חודש */
 onDateClick(event: any): void {
  const api = this.scheduleComp?.calendarApi;
  if (!api) return;

  // נבדוק באיזה תצוגה אנחנו
  if (api.view.type === 'dayGridMonth') {
    // מעבר אוטומטי לתצוגת יום לאותו תאריך
    api.changeView('timeGridDay', event.dateStr);
  } else {
    // אם כבר בתצוגת יום/שבוע – אפשר להציג את פרטי היום (או להשאיר ריק)
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

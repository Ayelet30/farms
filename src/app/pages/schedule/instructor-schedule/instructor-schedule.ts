import { Component, OnInit, ChangeDetectorRef, ViewChild, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import { dbTenant } from '../../../services/supabaseClient.service';
import type { EventClickArg } from '@fullcalendar/core';

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
  loading = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.loading = true;

      // ✅ תיקון: בדיקת פרטי מדריך
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

      this.applyFilterAndBuildItems();

    } catch (err: any) {
      console.error('❌ init error', err);
      this.error = err?.message || 'שגיאה בטעינה';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit(): void {
    // מחכים שה-ViewChild וה-calendarApi יהיו מוכנים
    const interval = setInterval(() => {
      if (this.scheduleComp?.calendarApi) {
        clearInterval(interval);
        console.log('Calendar API ready:', this.scheduleComp.calendarApi);
        this.setScheduleItems();
      }
    }, 50);

    this.cdr.detectChanges();
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

    this.lessons = this.lessons.map(l => ({
      ...l,
      child_name: this.childName(l.child_id),
      child_color: colorFromId(l.child_id),
      instructor_name: ''
    }));
  }

  private applyFilterAndBuildItems(): void {
    this.filteredLessons = this.lessons.filter(l => l.instructor_id === this.instructorId);
    this.setScheduleItems();
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

  private setScheduleItems(): void {
    if (!this.scheduleComp?.calendarApi) {
      console.warn('Calendar API not ready yet, skipping items build');
      return;
    }

    const src = this.filteredLessons.length ? this.filteredLessons : this.lessons;
    this.items = src
      .map(l => {
        const startISO = this.ensureIso((l as any).start_datetime, (l as any).start_time, (l as any).occur_date);
        const endISO   = this.ensureIso((l as any).end_datetime,   (l as any).end_time,   (l as any).occur_date);
        return {
          id: String(l.id ?? `${l.child_id}__${startISO}`),
          title: l.lesson_type || 'שיעור',
          start: startISO,
          end: endISO,
          color: l.child_color || '#b5ead7',
          meta: {
            child_id: l.child_id,
            child_name: l.child_name || '',
            instructor_id: l.instructor_id,
            status: l.status
          },
          status: l.status
        } as ScheduleItem;
      })
      .filter(it => !!it.start && !!it.end);

    console.log('Schedule items built:', this.items);
    this.cdr.detectChanges();
  }

  private childName(childId: string): string {
    const child = this.children.find(c => c.child_uuid === childId);
    return child?.full_name ?? '';
  }

  onEventClick(arg: EventClickArg): void {
    const childId: string | undefined = arg.event.extendedProps['child_id'];
    if (!childId) return;

    const api = this.scheduleComp?.calendarApi;
    if (api?.view.type === 'dayGridMonth') {
      api.changeView('timeGridWeek', arg.event.start!);
    }

    this.selectedChild = this.children.find(c => c.child_uuid === childId) ?? null;
    this.cdr.detectChanges();
  }

  onDateClick(raw: string | Date | { date?: Date; dateStr?: string }): void {
    let d: Date;
    if (typeof raw === 'string') d = new Date(raw);
    else if (raw instanceof Date) d = raw;
    else d = raw?.date ?? (raw?.dateStr ? new Date(raw.dateStr) : new Date());

    const targetYmd = ymd(d);
    const event = this.items.find(it => ymd(new Date(it.start)) === targetYmd);
    if (event?.meta?.child_id) {
      this.selectedChild = this.children.find(c => c.child_uuid === event?.meta?.child_id) ?? null;
      this.cdr.detectChanges();
    }
  }
}

// ---------------- helper functions ----------------
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

function colorFromId(id: string): string {
  const palette = ['#d8f3dc','#fbc4ab','#cdb4db','#b5ead7','#ffdac1','#e0fbfc','#ffe5ec'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

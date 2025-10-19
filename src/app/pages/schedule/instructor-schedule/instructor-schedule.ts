import { Component, OnInit, ChangeDetectorRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, supabase } from '../../../services/supabaseClient';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
import { NoteComponent } from '../../Notes/note.component';
import { Lesson } from '../../../models/lesson-schedule.model';
import { EventClickArg } from '@fullcalendar/core';

interface Child {
  child_uuid: string;
  instructor_id?: string;
  parent_uid?: string;
  full_name?: string;
  instructor?: Instructor | null;
  parent?: Parent | null;
  [key: string]: any;
}

interface Instructor {
  id_number: string;
  full_name?: string;
  [key: string]: any;
}

interface Parent {
  id: string;
  [key: string]: any;
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

  children: Child[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  notes: any[] = [];
  selectedChild: Child | null = null;
  instructorId: string = '';
  items: ScheduleItem[] = [];

  constructor(
    public cu: CurrentUserService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    try {
      const user = await this.cu.loadUserDetails();
      if (!user) {
        console.warn('⚠️ No active session or user details. Please sign in.');
        return;
      }
      this.instructorId = String(user.id_number).trim();

      await this.loadChildren();
      if (this.children.length) {
        const startYmd = new Date().toISOString().slice(0, 10);
        const endDate = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000);
        const endYmd = endDate.toISOString().slice(0, 10);
        await this.loadLessons(startYmd, endYmd);
        this.filterLessons();
        this.setScheduleItems();
        await this.loadNotes();
      }
    } catch (err) {
      console.error('❌ Error initializing schedule:', err);
    }
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  private async loadChildren() {
    try {
      const user = await this.cu.loadUserDetails();
      if (!user?.id_number) {
        this.children = [];
        return;
      }

      this.instructorId = String(user.id_number).trim();
      const dbc = dbTenant();
      if (!supabase) {
        console.error('Supabase client not initialized');
        return;
      }

      // Load children
      const { data: kids, error: errKids } = await dbc
        .from('children')
        .select('*')
        .eq('status', 'Active')
        .eq('instructor_id', this.instructorId);

      if (errKids) {
        console.error('❌ Error loading children:', errKids);
        this.children = [];
        return;
      }

      const childList: Child[] = kids ?? [];

      // Load instructors
      const instructorIds: string[] = childList.map(c => c.instructor_id!).filter(Boolean);
      const { data: instructorsData } = await dbc
        .from('instructors')
        .select('*')
        .in('id_number', instructorIds);

      const instructorsMap: Record<string, Instructor> = (instructorsData ?? []).reduce(
        (acc: Record<string, Instructor>, i: Instructor) => {
          acc[i.id_number] = i;
          return acc;
        },
        {} as Record<string, Instructor>
      );

      // Load parents
      const parentUids: string[] = childList.map(c => c.parent_uid!).filter(Boolean);
      let parentsMap: Record<string, Parent> = {};
      if (parentUids.length > 0) {
        const { data: parentsData, error: errParents } = await supabase
          .from('users')
          .select('id, email, phone, full_name, created_at, last_sign_in_at')
          .in('id', parentUids);

        if (errParents) {
          console.error('❌ Error loading parents:', errParents);
        } else {
          parentsMap = (parentsData ?? []).reduce((acc: Record<string, Parent>, p: any) => {
            acc[p.id] = p;
            return acc;
          }, {} as Record<string, Parent>);
        }
      }

      this.children = childList.map(c => ({
        ...c,
        instructor: c.instructor_id ? instructorsMap[c.instructor_id] ?? null : null,
        parent: c.parent_uid ? parentsMap[c.parent_uid] ?? null : null
      }));

      console.log('✅ Loaded children with instructor and parent:', this.children);

    } catch (err) {
      console.error('❌ Exception in loadChildren:', err);
      this.children = [];
    }
  }

  private async loadLessons(startYmd: string, endYmd: string) {
    const dbc = dbTenant();
    const childIds = this.children.map(c => c.child_uuid);
    if (!childIds.length) { this.lessons = []; return; }

    const { data, error } = await dbc
      .from('lessons_occurrences')
      .select('*')
      .in('child_id', childIds)
      .gte('occur_date', startYmd)
      .lte('occur_date', endYmd);

    if (error) {
      console.error('❌ Error loading lesson occurrences:', error);
      this.lessons = [];
      return;
    }

    const rows = (data ?? []) as Lesson[];

    // Load instructor names
    const instructorIds = Array.from(new Set(rows.map(r => r.instructor_id).filter(Boolean)));
    let instructorNameById: Record<string, string> = {};
    if (instructorIds.length) {
      const { data: inst } = await dbc
        .from('instructors')
        .select('id_number, full_name')
        .in('id_number', instructorIds);

      instructorNameById = (inst ?? []).reduce((acc: Record<string, string>, row: any) => {
        acc[row.id_number] = row.full_name ?? '';
        return acc;
      }, {} as Record<string, string>);
    }

    this.lessons = rows.map(r => {
      const start = r.start_datetime || new Date().toISOString();
      const end = r.end_datetime || new Date().toISOString();
      return {
        ...r,
        start_datetime: start,
        end_datetime: end,
        instructor_name: r.instructor_id ? (instructorNameById[r.instructor_id] ?? '') : '',
        child_color: this.getColorForChild(r.child_id),
        child_name: this.children.find(c => c.child_uuid === r.child_id)?.full_name || ''
      } as Lesson;
    });

    this.filterLessons();
    this.setScheduleItems();
  }

  private filterLessons() {
    this.filteredLessons = this.lessons.filter(l => l.instructor_id === this.instructorId);
  }

  private setScheduleItems() {
    const sourceLessons = this.filteredLessons.length ? this.filteredLessons : this.lessons;
    this.items = sourceLessons.map(lesson => ({
      id: lesson.id ?? `${lesson.child_id}__${lesson.start_datetime}`,
      title: `${lesson.lesson_type}${lesson.instructor_name ? ' עם ' + lesson.instructor_name : ''}` || 'שיעור',
      start: lesson.start_datetime,
      end: lesson.end_datetime,
      color: lesson.child_color || '#b5ead7',
      meta: {
        child_id: lesson.child_id,
        child_name: lesson.child_name || 'לא ידוע',
        instructor_id: lesson.instructor_id,
        instructor_name: lesson.instructor_name,
        status: lesson.status || 'לא ידוע'
      },
      status: lesson.status || 'לא ידוע'
    } as ScheduleItem));

    this.cdr.detectChanges();
  }

  private async loadNotes() {
    try {
      const dbc = dbTenant();
      const { data: notes, error } = await dbc
        .from('list_notes')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.error('❌ Error loading notes:', error);
        this.notes = [];
        return;
      }
      this.notes = notes ?? [];
    } catch (err) {
      console.error('❌ Exception in loadNotes:', err);
      this.notes = [];
    }
  }

  private getColorForChild(child_id: string): string {
    const index = this.children.findIndex(c => c.child_uuid === child_id);
    const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
    return colors[(index >= 0 ? index : 0) % colors.length];
  }

  onEventClick(arg: EventClickArg) {
    const childId = arg.event.extendedProps['child_id'];
    const calendarApi = this.scheduleComp.calendarApi;

    if (calendarApi.view.type === 'dayGridMonth') {
      this.scheduleComp.changeView('timeGridWeek');
      calendarApi.changeView('timeGridWeek', arg.event.start!);
    }

    const child = this.children.find(c => c.child_uuid === childId);
    this.selectedChild = child ? { ...child } : null;
    this.cdr.detectChanges();
  }

  onDateClick(arg: any) {
    const date = arg.date ?? arg.dateStr ?? new Date().toISOString();

    const event = this.items.find(item => {
      const eventDate = new Date(item.start).toISOString().slice(0, 10);
      const clickedDate = new Date(date).toISOString().slice(0, 10);
      return eventDate === clickedDate;
    });

    if (event) {
      const childData = this.children.find(c => c.child_uuid === event.meta.child_id);
      this.selectedChild = childData ? { ...childData } : null;
    }

    this.cdr.detectChanges();
  }
}

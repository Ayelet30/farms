import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../../services/supabaseClient.service';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { CurrentUserService } from '../../../core/auth/current-user.service';
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
export class InstructorScheduleComponent implements OnInit {
  children: any[] = [];
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

      this.instructorId = user.id_number!;
      const dbc = dbTenant();
      const { data: kids, error } = await dbc
        .from('children')
        .select('*')
        .eq('status', 'active');

      if (error) { console.error(error); this.children = []; return; }

      this.children = kids ?? [];
    } catch (err) {
      console.error(err);
      this.children = [];
    }
  }

  async loadLessons() {
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

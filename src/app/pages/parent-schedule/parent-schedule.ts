import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getCurrentUserData } from '../../services/supabaseClient';
import { ScheduleComponent } from '../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../models/schedule-item.model';
import { Lesson } from '../../models/lesson-schedule.model';
import { EventClickArg } from '@fullcalendar/core';

@Component({
  selector: 'app-parent-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent],
  templateUrl: './parent-schedule.html',
  styleUrls: ['./parent-schedule.css']
})
export class ParentScheduleComponent implements OnInit {
  children: any[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  weekView = true;
  startDate: string = '';
  endDate: string = '';
  items: ScheduleItem[] = []; 
  selectedChildId: string = 'all';  
  dropdownOpen = false;

  async ngOnInit() {
    await this.loadChildren();
    await this.loadLessons();
    this.setScheduleItems(); 
    this.filterLessons();
    this.selectedChildId = 'all';
    this.refresh();                  
  }

  getStartOfWeek(): string {
    const today = new Date();
    const diff = today.getDate() - today.getDay() + 1;
    const start = new Date(today.setDate(diff));
    return start.toISOString().substring(0, 10);
  }

  getEndOfWeek(): string {
    const start = new Date(this.getStartOfWeek());
    start.setDate(start.getDate() + 6);
    return start.toISOString().substring(0, 10);
  }

  async loadChildren() {
    try {
      const user = await getCurrentUserData();
      if (!user?.uid) { this.children = []; return; }

      const dbc = dbTenant();

      const { data: parent, error: e1 } = await dbc
        .from('parents')
        .select('uid')
        .eq('uid', user.uid)
        .maybeSingle();

      if (e1 || !parent) {
        console.error('Parent not found', e1);
        this.children = [];
        return;
      }

      const { data: kids, error: e2 } = await dbc
        .from('children')
        .select('child_uuid, full_name, status')
        .eq('parent_uid', parent.uid)
        .eq('status', 'active');

      if (e2) { console.error('Error loading children:', e2); this.children = []; return; }

      this.children = kids ?? [];
    } catch (err) {
      console.error('Unexpected error loading children:', err);
      this.children = [];
    }
  }

  async loadLessons() {
    const dbc = dbTenant();
    const childIds = this.children.map(c => c.child_uuid);
    if (childIds.length === 0) { this.lessons = []; return; }

    const today = new Date().toISOString().slice(0, 10);
    const in8Weeks = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const { data, error } = await dbc
      .from('lessons_occurrences')
      .select('lesson_id, child_id, instructor_id, lesson_type, status, day_of_week, start_time, end_time, start_datetime, end_datetime')
      .in('child_id', childIds)
      .gte('occur_date', today)
      .lte('occur_date', in8Weeks);

    if (error) {
      console.error('Error loading lesson occurrences:', error);
      this.lessons = [];
      return;
    }

    const rows = (data ?? []) as Lesson[];

    const instructorIds = Array.from(
      new Set(
        rows
          .map((r: Lesson) => r.instructor_id)
          .filter((x: string | null): x is string => !!x)
      )
    );

    let instructorNameById: Record<string, string> = {};
    if (instructorIds.length > 0) {
      const { data: inst } = await dbc
        .from('instructors')
        .select('id_number, full_name')
        .in('id_number', instructorIds);

      const instRows = (inst ?? []) as { id_number: string; full_name: string }[];
      const map: Record<string, string> = {};
      for (const row of instRows) {
        map[row.id_number] = row.full_name ?? '';
      }
      instructorNameById = map;
    }

    this.lessons = rows.map((r: Lesson) => {
      const startFallback = this.getLessonDateTime(r.day_of_week, r.start_time);
      const endFallback   = this.getLessonDateTime(r.day_of_week, r.end_time);

      const start = this.isoWithTFallback(r.start_datetime, startFallback);
      const end   = this.isoWithTFallback(r.end_datetime,   endFallback);

      const occurrenceKey = `${r.child_id}__${start}`;

      return {
        id: occurrenceKey,
        child_id: r.child_id,
        day_of_week: r.day_of_week,
        start_time: r.start_time,
        end_time: r.end_time,
        lesson_type: r.lesson_type,
        status: r.status,
        instructor_id: r.instructor_id ?? '',
        instructor_name: r.instructor_id ? (instructorNameById[r.instructor_id] ?? '') : '',
        child_color: this.getColorForChild(r.child_id),
        child_name: this.children.find(c => c.child_uuid === r.child_id)?.full_name || '',
        start_datetime: start,
        end_datetime: end,
      } as Lesson;
    });
  }

  getLessonDateTime(dayName: string, timeStr: string): string {
    const dayMap: Record<string, number> = {
      'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6
    };
    const today = new Date();
    const currentDay = today.getDay();
    const targetDay = dayMap[dayName];
    const diff = (targetDay - currentDay + 7) % 7;

    const eventDate = new Date(today);
    eventDate.setDate(today.getDate() + diff);

    const [hours, minutes] = timeStr.split(':').map(Number);
    eventDate.setHours(hours, minutes, 0, 0);

    return this.toLocalIso(eventDate);
  }

  getColorForChild(child_id: string): string {
    const index = this.children.findIndex(c => c.child_uuid === child_id);  
    const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
    return colors[(index >= 0 ? index : 0) % colors.length];
  }

  selectChild(childId: string) {
    this.selectedChildId = childId;
    this.dropdownOpen = false;
    this.refresh();
  }

  getChildName(childId: string | null): string | null {
    if (!childId || childId === 'all') return null;
    return this.children.find(c => c.child_uuid === childId)?.full_name || null;
  }

  toggleDropdown() { this.dropdownOpen = !this.dropdownOpen; }

  toggleView() { this.weekView = !this.weekView; }

  refresh() {
    this.loadLessons().then(() => {
      this.filterLessons();
      this.setScheduleItems();
    });
  }

  filterLessons() {
    this.filteredLessons = (this.selectedChildId === 'all' || !this.selectedChildId)
      ? this.lessons
      : this.lessons.filter(l => l.child_id === this.selectedChildId);
  }

  private isoWithTFallback(s: string | undefined | null, fallbackIso: string): string {
    if (s && s.trim() !== '') {
      const v = s.trim();
      return v.includes('T') ? v : v.replace(' ', 'T');
    }
    return fallbackIso;
  }

  private toLocalIso(date: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  setScheduleItems() {
    const base = (this.filteredLessons && this.filteredLessons.length ? this.filteredLessons : this.lessons) || [];
    const uniq = new Map<string, ScheduleItem>();

    for (const lesson of base) {
      const startFallback = this.getLessonDateTime(lesson.day_of_week, lesson.start_time);
      const endFallback   = this.getLessonDateTime(lesson.day_of_week, lesson.end_time);

      const start = this.isoWithTFallback(lesson.start_datetime, startFallback);
      const end   = this.isoWithTFallback(lesson.end_datetime,   endFallback);

      if (!start || !end) continue;
      const startMs = Date.parse(start);
      const endMs   = Date.parse(end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;

      const color = lesson.child_color || this.getColorForChild(lesson.child_id);
      const childLabel = lesson.child_name || this.getChildName(lesson.child_id) || 'ילד';
      const title = `${childLabel} — ${lesson.lesson_type}` + (lesson.instructor_name ? ` עם ${lesson.instructor_name}` : '');
      const uid = `${lesson.id || 'occ'}__${lesson.child_id || 'child'}__${start}`;

      if (!uniq.has(uid)) {
        uniq.set(uid, {
          id: uid,
          title,
          start,
          end,
          color,
          meta: {
            status: lesson.status,
            child_id: lesson.child_id,
            child_name: lesson.child_name,
            instructor_id: lesson.instructor_id,
            instructor_name: lesson.instructor_name,
          },
        } as ScheduleItem);
      }
    }

    this.items = Array.from(uniq.values()).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  onEventClick(arg: EventClickArg) {
    const event = arg.event;
    const item: ScheduleItem = {
      id: event.id,
      title: event.title,
      start: event.start?.toISOString() ?? '',
      end: event.end?.toISOString() ?? '',
      color: event.backgroundColor,
      status: event.extendedProps['status'],
      meta: {
        child_id: event.extendedProps['child_id'],
        child_name: event.extendedProps['child_name'],
        instructor_id: event.extendedProps['instructor_id'],
        instructor_name: event.extendedProps['instructor_name'],
        status: event.extendedProps['status']
      }
    };
    console.log('event clicked', item);
  }

  onDateClick(dateIso: string) {
    console.log('date clicked', dateIso);
  }

  print() { window.print(); }

  // ✅ מתוקן
  canCancel(lesson: Lesson) {
    return !['הושלם', 'בוטל'].includes(lesson.status);
  }

  canView(lesson: Lesson) { return true; }

  cancelLesson(lesson: Lesson) {
    const confirmed = confirm('האם לבטל את השיעור?');
    if (confirmed) {
      // TODO: שליחת בקשת ביטול ל-Supabase
    }
  }

  viewDetails(lesson: Lesson) {
    // TODO: פתיחת דיאלוג עם מידע נוסף
  }

  openCompletionDialog() {
    // TODO: פתיחת בחירת סלוטים לשיעור השלמה
  }

  statusClass(status: string): string {
    switch (status) {
      case 'אושר': return 'status-approved';
      case 'בוטל': return 'status-cancelled';
      case 'הושלם': return 'status-done';
      case 'ממתין לאישור': return 'status-pending';
      default: return '';
    }
  }
}

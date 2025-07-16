import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getCurrentUserData, getSupabaseClient } from '../../services/supabase.service';
import { Lesson } from './parent-schedule.model';

// FullCalendar
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';

@Component({
  selector: 'app-parent-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './parent-schedule.html',
  styleUrls: ['./parent-schedule.css']
})
export class ParentScheduleComponent implements OnInit {
  children: any[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  selectedChildId: string = '';
  weekView = true;
  supabase = getSupabaseClient();
  startDate: string = '';
endDate: string = '';


  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: heLocale,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    events: [],
    height: 'auto',
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00'
    ,  allDaySlot: false,

  };

  async ngOnInit() {
    await this.loadChildren();
    await this.loadLessons();
    this.filterLessons();
    this.setCalendarEvents();
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
      if (!user?.uid) {
        console.error('User UID not found');
        this.children = [];
        return;
      }

      const { data: parentData, error: parentError } = await this.supabase
        .from('parents')
        .select('*')
        .eq('uid', user.uid)
        .single();

      if (parentError || !parentData) {
        console.error('Parent not found');
        this.children = [];
        return;
      }

      const { data: childrenData, error: childrenError } = await this.supabase
        .from('children')
        .select('id, full_name')
        .eq('parent_uid', parentData.uid)
        .eq('status', 'active');

      if (childrenError) {
        console.error('Error loading children:', childrenError.message);
        this.children = [];
        return;
      }

      this.children = childrenData ?? [];

      if (this.children.length > 0) {
        this.selectedChildId = this.children[0].id;
      }

    } catch (err) {
      console.error('Unexpected error loading children:', err);
      this.children = [];
    }
  }

  async loadLessons() {
    const { data, error } = await this.supabase
      .from('lessons')
      .select('*, instructors(full_name)')
      .in('child_id', this.children.map(c => c.id));

    if (!data || error) {
      this.lessons = [];
      return;
    }

    this.lessons = data.map((lesson: any) => ({
      ...lesson,
      instructor_name: lesson.instructors?.full_name || '',
      child_color: this.getColorForChild(lesson.child_id),
      child_name: this.children.find(c => c.id === lesson.child_id)?.full_name || ''
    }));
  }

  filterLessons() {
  if (this.selectedChildId === 'all') {
    this.filteredLessons = this.lessons;
  } else {
    this.filteredLessons = this.lessons.filter(
      l => l.child_id === this.selectedChildId
    );
  }
}


  setCalendarEvents() {
    this.calendarOptions.events = this.filteredLessons.map(lesson => ({
      id: lesson.id,
      title: `${lesson.lesson_type} עם ${lesson.instructor_name}`,
      start: this.getLessonDateTime(lesson.day_of_week, lesson.start_time),
      end: this.getLessonDateTime(lesson.day_of_week, lesson.end_time),
      backgroundColor: lesson.child_color,
      borderColor: lesson.child_color
    }));
  }

  getLessonDateTime(dayName: string, timeStr: string): string {
    const dayMap: Record<string, number> = {
      'ראשון': 0,
      'שני': 1,
      'שלישי': 2,
      'רביעי': 3,
      'חמישי': 4,
      'שישי': 5,
      'שבת': 6
    };

    const today = new Date();
    const currentDay = today.getDay(); // 0=Sunday
    const targetDay = dayMap[dayName];
    const diff = (targetDay - currentDay + 7) % 7;
    const eventDate = new Date(today);
    eventDate.setDate(today.getDate() + diff);

    const [hours, minutes] = timeStr.split(':');
    eventDate.setHours(+hours, +minutes, 0);

    return eventDate.toISOString();
  }

  getColorForChild(child_id: string): string {
  const index = this.children.findIndex(c => c.id === child_id);
  const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
  return colors[index % colors.length];
}
dropdownOpen = false;

selectChild(childId: string) {
  this.selectedChildId = childId;
  this.dropdownOpen = false;
  this.refresh(); // מרענן את הלוח לפי הילד
}

getChildName(childId: string): string | null {
  if (childId === 'all') return null;
  return this.children.find(c => c.id === childId)?.full_name || null;
}


  // שאר פעולות
  toggleView() {
    this.weekView = !this.weekView;
  }

  refresh() {
    this.loadLessons().then(() => {
      this.filterLessons();
      this.setCalendarEvents();
    });
  }

  print() {
    window.print();
  }

  canCancel(lesson: Lesson) {
    return lesson.status !== 'הושלם' && lesson.status !== 'בוטל';
  }

  canView(lesson: Lesson) {
    return true;
  }

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

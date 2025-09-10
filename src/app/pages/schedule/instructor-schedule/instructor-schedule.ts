import { Component, OnInit, ViewChild, NgZone, ChangeDetectorRef } from '@angular/core';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';
import { dbTenant, getCurrentUserData } from '../../../services/supabaseClient';
import { CommonModule } from '@angular/common';
import { ScheduleItem } from '../../../models/schedule-item.model'
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { Lesson } from '../../../models/lesson-schedule.model'
 
// interface Lesson {
//   id: string;
//   child_id: string;
//   lesson_type: string;
//   day_of_week: string;
//   start_time: string; // HH:mm:ss
//   end_time: string;   // HH:mm:ss
//   status: string;
// }

interface Child {
  child_uuid: string;
  full_name: string;
}

@Component({
  selector: 'app-instructor-schedule',
  standalone: true,
  imports: [CommonModule, ScheduleComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss']
})
export class InstructorScheduleComponent implements OnInit {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  items: ScheduleItem[] = [];

  calendarOptions: any = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: heLocale,
    headerToolbar: false,
    height: 600, // שינוי ל-600px במקום 'auto'
    events: [],
    dateClick: (info: any) => { console.log('Date clicked:', info.dateStr); },
    eventClick: (info: any) => { console.log('Event clicked:', info.event.title); }
  };

  children: Child[] = [];
  lessons: Lesson[] = [];

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    await this.loadSchedule();
  }

  private async loadSchedule() {
    try {
      const user = await getCurrentUserData();
      console.log('👤 Current user:', user);
      if (!user?.uid) {
        console.warn('⚠️ User UID not found');
        return;
      }

      const tenantDb = dbTenant();
      if (!tenantDb) return;

      const { data: instructorData, error: instructorError } = await tenantDb
        .from('instructors')
        .select('id_number')
        .eq('uid', user.uid)
        .single();

      if (instructorError) {
        console.error('❌ Error fetching instructor:', instructorError);
        return;
      }

      const instructorId = instructorData?.id_number;
      console.log('🧑‍🏫 Instructor ID:', instructorId);
      if (!instructorId) {
        console.warn('⚠️ Instructor ID not found');
        return;
      }

      const { data: childrenData, error: childrenError } = await tenantDb
        .from('children')
        .select('child_uuid, full_name')
        .eq('instructor_id', instructorId);

      if (childrenError) {
        console.error('❌ Error fetching children:', childrenError);
        return;
      }

      this.children = childrenData || [];
      console.log('👦 Children:', this.children);
      if (!this.children.length) return;

      const childIds = this.children.map(c => c.child_uuid);

      const { data: lessonsData, error: lessonsError } = await tenantDb
        .from('lessons')
        .select('id, child_id, lesson_type, start_time, end_time, day_of_week, status')
        .in('child_id', childIds);

      if (lessonsError) {
        console.error('❌ Error fetching lessons:', lessonsError);
        return;
      }

      this.items = lessonsData || [];
      console.log('📚 Lessons:', this.items);

      const events = this.lessons.map(l => {
        const child = this.children.find(c => c.child_uuid === l.child_id);
        const baseDate = new Date();
        const dayMap: Record<string, number> = {
          'ראשון': 0, 'שני': 1, 'שלישי': 2,
          'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6
        };
        let diff = (dayMap[l.day_of_week] ?? 0) - baseDate.getDay();
        if (diff < 0) diff += 7;
        baseDate.setDate(baseDate.getDate() + diff);

        // בדיקה שכל השעות בפורמט נכון
        const startTime = l.start_time.length === 8 ? l.start_time : '00:00:00';
        const endTime = l.end_time.length === 8 ? l.end_time : '01:00:00';
        const dateStr = baseDate.toISOString().split('T')[0];

        return {
          id: l.id,
          title: child ? `שיעור עם ${child.full_name}` : l.lesson_type,
          start: `${dateStr}T${startTime}`,
          end: `${dateStr}T${endTime}`,
          color: this.getEventColor(l.status)
        };
      });

      console.log('📆 Events:', events);

      console.log('✅ Calendar updated successfully');

    } catch (err) {
      console.error('❌ Error loading schedule:', err);
    }
  }

  private getEventColor(status: string): string {
    switch (status) {
      case 'אושר': return '#4caf50';
      case 'בוטל': return '#f44336';
      case 'ממתין לאישור': return '#ff9800';
      default: return '#2196f3';
    }
  }

    onEventClick(item: ScheduleItem) {
    console.log('event clicked', item);
  }
  onDateClick(dateIso: string) {
    console.log('date clicked', dateIso);
  }

}

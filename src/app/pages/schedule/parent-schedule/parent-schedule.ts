import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { NoteComponent } from '../../Notes/note.component';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { Lesson } from '../../../models/lesson-schedule.model';
import { dbTenant } from '../../../services/supabaseClient.service';
import { DateClickArg } from '@fullcalendar/interaction';
 
@Component({
  selector: 'app-parent-schedule',
  standalone: true,
  templateUrl: './parent-schedule.html',
  styleUrls: ['./parent-schedule.scss'],
  imports: [
    CommonModule,
    ScheduleComponent
  ]
})
export class ParentScheduleComponent implements OnInit {
  items: ScheduleItem[] = [];
  error: string | null = null;
  daySummary: { dateIso: string; total: number; done: number; cancelled: number } | null = null;
  selectedChild: any = null;
  selectedOccurrence: any;
 
  dropdownOpen = false;
  selectedChildId: string = 'all';
  children: any[] = [];
 
  private dbc = dbTenant();
 
  async ngOnInit() {
    await this.loadChildren();
    await this.loadSchedule();
  }
 
  /** טוען ילדים */
  async loadChildren() {
    try {
      const { data, error } = await this.dbc
        .from('children')
        .select('child_uuid, full_name, color')
        .order('full_name', { ascending: true });
 
      if (error) throw error;
      this.children = data ?? [];
    } catch (err) {
      console.error('❌ Error loading children:', err);
    }
  }
 
  /** טוען שיעורים */
  async loadSchedule() {
    try {
      const { data, error } = await this.dbc
        .from('lessons')
        .select('*')
        .order('start_time', { ascending: true });
 
      if (error) throw error;
      this.items = this.mapLessonsToItems(data as Lesson[]);
    } catch (err) {
      console.error('❌ Error loading schedule:', err);
      this.error = 'שגיאה בטעינת מערכת השיעורים';
    }
  }
 
  /** ממיר שיעור לאובייקט תואם ללוח */
  private mapLessonsToItems(src: Lesson[]): ScheduleItem[] {
    return src.map((l: Lesson) => {
      const startISO = this.ensureIso(l.start_datetime, l.start_time, l.occur_date);
      const endISO = this.ensureIso(l.end_datetime, l.end_time, l.occur_date);
 
      return {
        id: String(l.id ?? `${l.child_id}__${startISO}`),
        title: l.lesson_type || 'שיעור',
        start: startISO,
        end: endISO,
        color: l.child_color || '#b5ead7',
        status: l.status,
        meta: {
          lesson_id: l.id,
          child_id: l.child_id,
          child_name: l.child_name || '',
          instructor_id: l.instructor_id,
          instructor_name: l.instructor_name || '',
          start_datetime: l.start_datetime ?? startISO,
          occur_date: l.occur_date ?? '',
          status: l.status
        }
      } as ScheduleItem;
    });
  }
 
  /** תאריך תקין */
  private ensureIso(dt?: string, t?: string, d?: string): string {
    if (dt) return dt;
    if (d && t) return `${d}T${t}`;
    return new Date().toISOString();
  }
 
  /** 🧩 פונקציות שהיו חסרות ערך החזרה */
  getColorForChild(childId: string): string {
    if (!childId || childId === 'all') return '#f3f6e9';
    const child = this.children.find(c => c.child_uuid === childId);
    return child?.color || '#b5ead7';
  }
 
  getChildName(childId: string): string {
    if (childId === 'all') return 'כל הילדים';
    const child = this.children.find(c => c.child_uuid === childId);
    return child?.full_name || '';
  }
 
  toggleDropdown(): void {
    this.dropdownOpen = !this.dropdownOpen;
  }
 
  selectChild(childId: string): void {
    this.selectedChildId = childId;
    this.dropdownOpen = false;
    // אפשר להוסיף סינון כאן לפי הילד הנבחר
  }
 
  onViewRange(event: { start: string; end: string }): void {
    console.log('📅 View range changed:', event);
  }
 
  onDateClick(event: DateClickArg) {
    console.log('🎯 dateClick event fired:', event);
    const dateIso = event.dateStr?.slice(0, 10);
    if (!dateIso) return;
    this.calculateDaySummary(dateIso);
  }
 
  private calculateDaySummary(dateIso: string) {
    const cleanDate = dateIso.slice(0, 10);
    const dayItems = this.items.filter(it => {
      const occur = it.meta?.['occur_date'] || it.meta?.['start_datetime']?.slice(0, 10);
      return occur === cleanDate;
    });
 
    this.daySummary = {
      dateIso: cleanDate,
      total: dayItems.length,
      done: dayItems.filter(i => i.status === 'הושלם').length,
      cancelled: dayItems.filter(i => i.status === 'בוטל').length
    };
  }
 
  closeSummary() {
    this.daySummary = null;
  }
 
  onEventClick(event: any) {
    const data = event.event?.extendedProps?.meta;
    if (!data) return;
    this.selectedOccurrence = data;
    this.selectedChild = { full_name: data.child_name, child_uuid: data.child_id };
  }
}
 
 
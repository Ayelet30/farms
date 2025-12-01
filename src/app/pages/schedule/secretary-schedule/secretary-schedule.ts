import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  dbTenant,
  ensureTenantContextReady,
  onTenantChange
} from '../../../services/legacy-compat';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import { ScheduleItem } from '../../../models/schedule-item.model';
import { Lesson } from '../../../models/lesson-schedule.model';
import type { EventClickArg } from '@fullcalendar/core';
import { CurrentUserService } from '../../../core/auth/current-user.service';

type ChildRow = {
  child_uuid: string;
  first_name: string | null;
 last_name: string | null;

  status?: string | null;
};
type InstructorRow = {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  status?: string | null;
};

@Component({
  selector: 'app-secretary-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent],
  templateUrl: './secretary-schedule.html',
  styleUrls: ['./secretary-schedule.css'],
})
export class SecretaryScheduleComponent implements OnInit, OnDestroy {
  children: ChildRow[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  selectedChild: ChildRow | null = null;

  instructorId = '';
  items: ScheduleItem[] = [];
   instructors: InstructorRow[] = [];              // 👈 הוספה חדשה
  private nameByInstructor = new Map<string, string>(); // 👈 מפה id → שם

  private unsubTenantChange: (() => void) | null = null;

  public cu = inject(CurrentUserService);
  private cdr = inject(ChangeDetectorRef);

  async ngOnInit(): Promise<void> {
    try {
      // ✅ חובה לפני כל dbTenant(): מבטיח שקיים הקשר טננט פעיל
      await ensureTenantContextReady();

      // רענון אוטומטי אם מחליפים חווה/טננט בזמן שהמסך פתוח
      this.unsubTenantChange = onTenantChange(async () => {
        await this.reloadAll();
      });

      // טוען זהות המשתמש (אחרי שיש קונטקסט)
      const user = await this.cu.loadUserDetails();
      this.instructorId = (user?.id_number ?? '').toString();

      await this.reloadAll();
    } catch (e) {
      console.error('init error', e);
    } finally {
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {
    try { this.unsubTenantChange?.(); } catch {}
  }

  private async reloadAll() {
    await this.loadChildren();
      await this.loadInstructors();  // 👈 חדש

    await this.loadLessons();
    this.filterLessons();
    this.setScheduleItems();
    this.cdr.detectChanges();
  }

  /** ילדים פעילים – תומך ב-Active/active */
  private async loadChildren(): Promise<void> {
    try {
      const dbc = dbTenant();
      const { data, error } = await dbc
        .from('children')
        .select('child_uuid, first_name, last_name, status')
      .eq('status', 'Active'); 

      if (error) throw error;
      this.children = (data ?? []) as ChildRow[];
    } catch (err) {
      console.error('loadChildren failed', err);
      this.children = [];
    }
  }

  /** שיעורים לילדים שנמצאו, מהיום ועד 8 שבועות */
  private async loadLessons(): Promise<void> {
    try {
      const childIds = this.children.map((c) => c.child_uuid).filter(Boolean);
      if (!childIds.length) {
        this.lessons = [];
        return;
      }

      const dbc = dbTenant();
      const today = new Date().toISOString().slice(0, 10);
      const in8Weeks = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await dbc
        .from('lessons_occurrences')
        .select(
        'lesson_id, child_id, day_of_week, start_time, end_time, lesson_type, status, instructor_id, start_datetime, end_datetime, occur_date')
        .in('child_id', childIds)
        .gte('occur_date', today)
        .lte('occur_date', in8Weeks)
        .order('start_datetime', { ascending: true });

      if (error) throw error;

     const nameByChild = new Map(
     this.children.map(c => [c.child_uuid, `${c.first_name ?? ''} ${c.last_name ?? ''}`]));
      this.lessons = (data ?? []).map((r: any) => ({
        lesson_id: String(r.lesson_id ?? ''),
        id: String(r.lesson_id ?? ''),
        child_id: r.child_id,
        day_of_week: r.day_of_week,
        start_time: r.start_time,
        end_time: r.end_time,
        lesson_type: r.lesson_type,
        status: r.status,
        instructor_id: r.instructor_id ?? '',
        instructor_name: r.instructor_name ?? '',
        child_color: this.getColorForChild(r.child_id),
        child_name: nameByChild.get(r.child_id) || '',
        start_datetime: r.start_datetime ?? null,
        end_datetime: r.end_datetime ?? null,
        occur_date: r.occur_date ?? null,
      })) as unknown as Lesson[];
    } catch (err) {
      console.error('loadLessons failed', err);
      this.lessons = [];
    }
  }

  /** אם ה-secretary מחוברת כמדריכה – יציג רק שלה. אחרת יציג הכל */
  private filterLessons(): void {
    const id = this.instructorId?.trim();
    this.filteredLessons = id ? this.lessons.filter((l) => (l.instructor_id ?? '').toString() === id) : this.lessons;
  }
private async loadInstructors(): Promise<void> {
  try {
    const dbc = dbTenant();
    const { data, error } = await dbc
      .from('instructors') // 👈 שם הטבלה אצלך בסופבייס
  .select('uid, first_name, last_name, status')
      .eq('status', 'Active'); // או 'active' לפי מה שיש אצלך

    if (error) throw error;
    this.instructors = (data ?? []) as InstructorRow[];

    // בונים מפת id → "שם מלא"
  this.nameByInstructor = new Map(
  this.instructors.map(i => [
    String(i.uid),
    `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
  ])
);

  } catch (err) {
    console.error('loadInstructors failed', err);
    this.instructors = [];
    this.nameByInstructor = new Map();
  }
}

  private setScheduleItems(): void {
    const src = this.filteredLessons.length ? this.filteredLessons : this.lessons;

    this.items = src.map((lesson) => {
      // בניית תאריכים/שעות אמינים
      const start = this.ensureIso(
        lesson.start_datetime as any,
        lesson.start_time as any,
        lesson.occur_date as any
      );
      const end = this.ensureIso(
        lesson.end_datetime as any,
        lesson.end_time as any,
        lesson.occur_date as any
      );

      return {
        id: lesson.id,
        title: `${lesson.lesson_type ?? ''}${lesson.instructor_name ? ' עם ' + lesson.instructor_name : ''}`,
        start,
        end,
        color: (lesson as any).child_color,
        meta: {
          child_id: (lesson as any).child_id,
          child_name: (lesson as any).child_name,
          instructor_id: lesson.instructor_id,
          instructor_name: lesson.instructor_name,
          status: lesson.status,
        },
        status: lesson.status,
      } satisfies ScheduleItem;
    });
  }

  private ensureIso(datetime?: string | null, time?: string | null, baseDate?: string | null): string {
    // אם קיבלנו ISO מלא – מחזירים
    if (datetime && typeof datetime === 'string' && datetime.includes('T')) return datetime;

    // אם קיבלנו "YYYY-MM-DD HH:mm" – מתקנים ל-ISO
    if (datetime && typeof datetime === 'string' && datetime.trim() !== '') {
      return datetime.replace(' ', 'T');
    }

    // fallback: מרכיבים מתאריך בסיס ושעה
    const base = baseDate ? new Date(baseDate) : new Date();
    const d = new Date(base);
    if (time) {
      const [hh, mm] = String(time).split(':').map((x) => parseInt(x, 10) || 0);
      d.setHours(hh, mm, 0, 0);
    }
    return this.toLocalIso(d);
  }

  private toLocalIso(date: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private getColorForChild(child_id: string): string {
    const index = this.children.findIndex((c) => c.child_uuid === child_id);
    const colors = ['#d8f3dc', '#fbc4ab', '#cdb4db', '#b5ead7', '#ffdac1'];
    return colors[(index >= 0 ? index : 0) % colors.length];
  }

  onEventClick(arg: EventClickArg): void {
    const childId = arg.event.extendedProps['child_id'] as string | undefined;
    const child = childId ? this.children.find((c) => c.child_uuid === childId) : null;
    if (!child) {
      console.warn('לא נמצא ילד מתאים!', arg.event.extendedProps);
      this.selectedChild = null;
      return;
    }
    this.selectedChild = { ...child };
    this.cdr.detectChanges();
  }

  onDateClick(arg: any): void {
    console.log('תאריך נבחר:', arg?.dateStr ?? arg?.date ?? arg);
  }
}

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';
import type { ScheduleItem } from '../../../models/schedule-item.model';
import type { Lesson } from '../../../models/lesson-schedule.model';
import type { EventClickArg } from '@fullcalendar/core';
import { MatTooltipModule } from '@angular/material/tooltip';
imports: [
  CommonModule,
  ScheduleComponent,
  MatDialogModule,
  MatTooltipModule
]


import {
  dbTenant,
  ensureTenantContextReady,
  getCurrentUserData,
} from '../../../services/legacy-compat';

import {
  MatDialog,
  MatDialogModule,
} from '@angular/material/dialog';
import {
  CancelLessonDialogComponent,
  CancelLessonDialogData,
} from './cancel-lesson-dialog/cancel-lesson-dialog.component';

@Component({
  selector: 'app-parent-schedule',
  standalone: true,
  templateUrl: './parent-schedule.html',
  styleUrls: ['./parent-schedule.scss'],
  imports: [CommonModule, ScheduleComponent, MatDialogModule],
})

export class ParentScheduleComponent implements OnInit {
  children: Array<{
    child_uuid: string;
    first_name: string;
    last_name: string;
    status?: string | null;
  }> = [];
nextCanceledLessonNote: string | null = null;

  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];

  weekView = true;
  startDate: string = '';
  endDate: string = '';

  items: ScheduleItem[] = [];
  selectedChildId: string = 'all';
  dropdownOpen = false;

  constructor(private dialog: MatDialog) {}

  async ngOnInit() {
    await ensureTenantContextReady();

    this.startDate = this.getStartOfWeek();
    this.endDate = this.getEndOfWeek();

    await this.loadChildren();
    await this.loadLessons();
    this.filterLessons();
    this.setScheduleItems();
    this.calcNextCanceledLesson();

  }

 private getStartOfWeek(): string {
  const today = new Date();
  const diff = today.getDate() - today.getDay() + 1; // ראשון
  const start = new Date(today);
  start.setDate(diff);
  return start.toISOString().slice(0, 10);
}
private calcNextCanceledLesson() {
  console.log('🟦 calcNextCanceledLesson called');
console.log('🟦 filteredLessons:', this.filteredLessons);

  const now = new Date();
const relevant = this.filteredLessons
  .filter((l: Lesson) => {
    const status = String(l.status || '').trim();
    const canceledStatuses = [
      'בוטל',
      'מבוטל',
      'בקשת ביטול',
      'ממתין לאישור',
      'ממתין לאישור מזכירה'
    ];

    if (!canceledStatuses.includes(status)) return false;
    if (!l.start_datetime) return false;

    const start = new Date(l.start_datetime);
    if (isNaN(start.getTime())) return false;

    return start > now;   // 🔹 רק עתידי
  })
  .sort((a: Lesson, b: Lesson) => {
    const da = new Date(a.start_datetime!).getTime();
    const db = new Date(b.start_datetime!).getTime();
    return da - db;
  });


  if (!relevant.length) {
    this.nextCanceledLessonNote = null;
    return;
  }

  const lesson = relevant[0];

const childName = lesson.child_name || 'הילד';

const date = new Date(lesson.start_datetime!);
const formattedDate = date.toLocaleDateString('he-IL', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

this.nextCanceledLessonNote =
  `${childName} – השיעור הקרוב בוטל בתאריך ${formattedDate}`;
}


  private getEndOfWeek(): string {
    const start = new Date(this.getStartOfWeek());
    start.setDate(start.getDate() + 6);
    return start.toISOString().slice(0, 10);
  }

  private async loadChildren() {
    try {
      const user = await getCurrentUserData();
      if (!user?.uid) {
        this.children = [];
        return;
      }

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
        .select('child_uuid, first_name, last_name, status')
        .eq('parent_uid', parent.uid)
        .in('status', ['Active']);

      if (e2) {
        console.error('Error loading children:', e2);
        this.children = [];
        return;
      }

      this.children = (kids ?? []).map(
        (k: {
          child_uuid?: any;
          first_name?: any;
          last_name?: any;
          status?: any;
        }) => ({
          child_uuid: String(k.child_uuid ?? ''),
          first_name: String(k.first_name ?? ''),
          last_name: String(k.last_name ?? ''),
          status: k.status ?? null,
        })
      );
    } catch (err) {
      console.error('Unexpected error loading children:', err);
      this.children = [];
    }
  }

  private async loadLessons() {
    const dbc = dbTenant();
    const childIds = this.children.map((c) => c.child_uuid).filter(Boolean);
    if (!childIds.length) {
      this.lessons = [];
      return;
    }

 const fromDate = new Date(Date.now() - 8 * 7 * 24 * 3600 * 1000)
  .toISOString()
  .slice(0, 10);

const toDate = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000)
  .toISOString()
  .slice(0, 10);


  const { data, error } = await dbc
  .from('lessons_occurrences')
  .select(`
    lesson_id,
    child_id,
    instructor_id,
    lesson_type,
    status,
    day_of_week,
    start_time,
    end_time,
    start_datetime,
    end_datetime,

    lesson_occurrence_exceptions (
      is_makeup_allowed
    )
  `)
  .in('child_id', childIds)
 .gte('occur_date', fromDate)
.lte('occur_date', toDate)

  .order('start_datetime', { ascending: true });

    if (error) {
      console.error('Error loading lesson occurrences:', error);
      this.lessons = [];
      return;
    }

    const rows = (data ?? []) as Lesson[];

    const instructorIds = Array.from(
      new Set(
        rows
          .map((r) => r.instructor_id)
          .filter((x): x is string => !!x)
      )
    );
    let instructorNameById: Record<string, string> = {};
    if (instructorIds.length) {
      const { data: inst } = await dbc
        .from('instructors')
        .select('id_number, first_name, last_name')
        .in('id_number', instructorIds);

      for (const row of (inst ??
        []) as {
        id_number: string;
        first_name: string | null;
        last_name: string | null;
      }[]) {
        const first = (row.first_name ?? '').trim();
        const last = (row.last_name ?? '').trim();
        instructorNameById[row.id_number] = [first, last]
          .filter(Boolean)
          .join(' ');
      }
    }
this.lessons = rows.map((r) => {

 const exceptions = (r as any).lesson_occurrence_exceptions as any[] | null;

const isMakeupAllowed =
  exceptions && exceptions.length > 0
    ? exceptions[0].is_makeup_allowed ?? null
    : null;

  const startFallback = this.getLessonDateTime(
    r.day_of_week,
    r.start_time
  );

  const endFallback = this.getLessonDateTime(
    r.day_of_week,
    r.end_time
  );

  const start = this.isoWithTFallback(r.start_datetime, startFallback);
  const end = this.isoWithTFallback(r.end_datetime, endFallback);

  const occurrenceKey = `${r.child_id}__${start}`;

  const child = this.children.find((c) => c.child_uuid === r.child_id);

  return {
    id: occurrenceKey,
    child_id: r.child_id,
    day_of_week: r.day_of_week,
    start_time: r.start_time,
    end_time: r.end_time,
    lesson_type: r.lesson_type,
    status: r.status,
    instructor_id: r.instructor_id ?? '',
    instructor_name: r.instructor_id
      ? instructorNameById[r.instructor_id] ?? ''
      : '',
    child_color: this.getColorForChild(r.child_id),
    child_name: `${child?.first_name || ''} ${child?.last_name || ''}`.trim(),
    start_datetime: start,
    end_datetime: end,
    lesson_id: (r as any).lesson_id,

    // ✅ זה השדה שמעניין אותנו
    is_makeup_allowed: isMakeupAllowed,
  } as Lesson;
});

  }

  private getLessonDateTime(dayName: string, timeStr: string): string {
    const dayMap: Record<string, number> = {
      ראשון: 0,
      שני: 1,
      שלישי: 2,
      רביעי: 3,
      חמישי: 4,
      שישי: 5,
      שבת: 6,
    };
    const today = new Date();
    const currentDay = today.getDay();
    const targetDay = dayMap[dayName] ?? currentDay;
    const diff = (targetDay - currentDay + 7) % 7;

    const eventDate = new Date(today);
    eventDate.setDate(today.getDate() + diff);

    const [hours, minutes] = timeStr.split(':').map(Number);
    eventDate.setHours(hours || 0, minutes || 0, 0, 0);

    return this.toLocalIso(eventDate);
  }

  getColorForChild(child_id: string): string {
    const index = this.children.findIndex((c) => c.child_uuid === child_id);
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
    const child = this.children.find((c) => c.child_uuid === childId);
    return child ? `${child.first_name} ${child.last_name}`.trim() || null : null;
  }

  toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
  }

  toggleView() {
    this.weekView = !this.weekView;
  }

  refresh() {
    this.loadLessons().then(() => {
      this.filterLessons();
      this.setScheduleItems();
       this.calcNextCanceledLesson(); 
      this.items = [...this.items];
    });
  }

  private filterLessons() {
    this.filteredLessons =
      !this.selectedChildId || this.selectedChildId === 'all'
        ? this.lessons
        : this.lessons.filter((l) => l.child_id === this.selectedChildId);
  }

  private isoWithTFallback(
    s: string | undefined | null,
    fallbackIso: string
  ): string {
    if (s && s.trim() !== '') {
      const v = s.trim();
      return v.includes('T') ? v : v.replace(' ', 'T');
    }
    return fallbackIso;
  }

  private toLocalIso(date: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  }

  private setScheduleItems() {
    const base =
      (this.filteredLessons?.length ? this.filteredLessons : this.lessons) ||
      [];

    const uniq = new Map<string, ScheduleItem>();

    for (const lesson of base) {
      const startFallback = this.getLessonDateTime(
        lesson.day_of_week,
        lesson.start_time
      );
      const endFallback = this.getLessonDateTime(
        lesson.day_of_week,
        lesson.end_time
      );

      const start = this.isoWithTFallback(lesson.start_datetime, startFallback);
      const end = this.isoWithTFallback(lesson.end_datetime, endFallback);

      if (!start || !end) continue;
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (
        Number.isNaN(startMs) ||
        Number.isNaN(endMs) ||
        endMs <= startMs
      )
        continue;

      const color = lesson.child_color || this.getColorForChild(lesson.child_id);
      const childLabel =
        lesson.child_name || this.getChildName(lesson.child_id) || 'ילד';
let displayTitle = childLabel;

if (lesson.status === 'בוטל') {
  if (lesson['is_makeup_allowed'] === true) {
  displayTitle = `🔁 ${childLabel} (להשלמה)`;
} else if (lesson['is_makeup_allowed'] === false) {
  displayTitle = `❌ ${childLabel} (לא להשלמה)`;
} else {
  displayTitle = `❌ ${childLabel} (בוטל)`;
}

}

      const uid = `${
        (lesson as any).lesson_id || lesson.id || 'occ'
      }__${lesson.child_id || 'child'}__${start}`;

      // האם מותר לבטל?
      const canCancelFlag = this.canCancel(lesson as Lesson);
      const lessonOccId =
        (lesson as any).lesson_id || (lesson as any).id || uid;

      if (!uniq.has(uid)) {
        uniq.set(uid, {
          id: uid,
           title: displayTitle, 
          start,
          end,
          color,
          status: lesson.status,
          meta: {
            status: lesson.status,
            child_id: lesson.child_id,
            child_name: lesson.child_name,
            instructor_id: lesson.instructor_id,
            instructor_name: lesson.instructor_name,
            lesson_type: lesson.lesson_type,
            canCancel: canCancelFlag,
            lesson_occurrence_id: lessonOccId,
            displayTitle,
             is_makeup_allowed: lesson['is_makeup_allowed'],
             

          },
        } as unknown as ScheduleItem);
      }
    }

    this.items = Array.from(uniq.values()).sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start)
    );
  }

  // 🔹 פופאפ + קריאה ל־RPC
  onEventClick(arg: EventClickArg) {
    const ev = arg.event;
    const ext: any = ev.extendedProps;

    const data: CancelLessonDialogData = {
      lessonId: ext['lesson_occurrence_id'] ?? ev.id,
      childName: ext['child_name'] ?? ev.title ?? '',
      instructorName: ext['instructor_name'] ?? '',
      dateStr: ev.start
        ? ev.start.toLocaleDateString('he-IL')
        : '',
      timeStr: ev.start
        ? ev.start.toLocaleTimeString('he-IL', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
      lessonType: ext['lesson_type'] ?? '',
      status: ext['status'] ?? '',
      canCancel: !!ext['canCancel'],
       isMakeupAllowed: !!ext['is_makeup_allowed'],
    };

    const dialogRef = this.dialog.open(CancelLessonDialogComponent, {
      width: '420px',
      data,
      direction: 'rtl',
    });

   dialogRef.afterClosed().subscribe((result) => {
  if (result?.cancelRequested) {
    const startIso = ev.start
      ? ev.start.toISOString()
      : '';

    this.handleCancelRequest(
      data.lessonId,     // lesson_id
      result.reason,     // סיבת הביטול
      startIso           // start_datetime
    );
  }
});

  }


  private async handleCancelRequest(
  lessonId: string,
  reason: string,
  startDateTimeIso: string
) {
  try {
    await ensureTenantContextReady();

    const user = await getCurrentUserData(); // יש לך כבר בפרויקט
    if (!user?.uid) throw new Error('Missing user uid');

    const dbc = dbTenant();

    const occurDateIso = startDateTimeIso ? startDateTimeIso.slice(0, 10) : '';
    if (!occurDateIso) throw new Error('Missing occur date');

    const { error } = await dbc
      .schema('bereshit_farm')
      .rpc('parent_request_cancel_lesson', {
        p_requested_by_uid: String(user.uid),
        p_lesson_id: lessonId,
        p_occur_date: occurDateIso,
        p_reason: reason,
      });

    if (error) throw error;

    this.markLessonAsPendingCancel(lessonId);
    alert('בקשת הביטול נשלחה למזכירה.');
  } catch (err) {
    console.error('cancel request error', err);
    alert('אירעה שגיאה בעת שליחת בקשת הביטול');
  }
}

  





private markLessonAsPendingCancel(lessonOccId: string) {
  // עדכון lessons
  this.lessons = this.lessons.map((l) =>
    (l as any).lesson_id === lessonOccId
      ? { ...l, status: 'בקשת ביטול' as any }
      : l
  );

  // עדכון items
  this.items = this.items.map((it) =>
    (it.meta as any)?.['lesson_occurrence_id'] === lessonOccId
      ? {
          ...it,
          status: 'בקשת ביטול' as any,
          meta: { ...(it.meta as any), status: 'בקשת ביטול' },
        }
      : it
  );
}

  onDateClick(dateIso: string) {
  }

  print() {
    window.print();
  }

  canCancel(lesson: Lesson) {
    // אפשר לחדד את הכלל – כרגע לפי סטטוס בלבד
    return lesson.status !== 'הושלם' && lesson.status !== 'בוטל';
  }
  canView(_lesson: Lesson) {
    return true;
  }

  cancelLesson(_lesson: Lesson) {
    const confirmed = confirm('האם לבטל את השיעור?');
    if (confirmed) {
      // (לא בשימוש יותר – עברנו לדיאלוג)
    }
  }

  viewDetails(_lesson: Lesson) {
    return;
  }

  openCompletionDialog() {}

  statusClass(status: string): string {
    switch (status) {
      case 'אושר':
        return 'status-approved';
      case 'בוטל':
        return 'status-cancelled';
      case 'הושלם':
        return 'status-done';
      case 'ממתין לאישור':
        return 'status-pending';
      default:
        return '';
    }
  }
  
}



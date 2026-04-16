import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject, ViewChild, signal, computed } from '@angular/core';import { CommonModule } from '@angular/common';
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
import { NoteComponent } from '../../Notes/note.component';
import { UiDialogService } from '../../../services/ui-dialog.service';
import { requireTenant, supabase } from '../../../services/supabaseClient.service';
import { QuickAppointmentComponent } from './quick-appointment/quick-appointment.component';


type ChildRow = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  birth_date?: string | null;
  status?: string | null;
};

type InstructorRow = {
  id_number: string;
  first_name: string | null;
  last_name: string | null;
  status?: string | null;
    color_hex?: string | null;
};
type RequestType = 'holiday' | 'sick' | 'personal' | 'other';
type RequestStatus = 'pending' | 'approved' | 'rejected';



interface AffectedChild {
  child_uuid: string;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  status?: string | null;
}

interface DayRequestRow {
  id: string;
  instructor_id: string;
  request_date: string;
  request_type: RequestType;
  status: RequestStatus;
  note?: string | null;
  all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  sick_note_file_path?: string | null;
}

type ContextMenuMode = 'root' | 'dayOff';

type QuickBookingContext = {
  open: boolean;
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:mm
  endTime: string;       // HH:mm
  instructorId: string;
  instructorName: string;
};

@Component({
  selector: 'app-secretary-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent, QuickAppointmentComponent],
  templateUrl: './secretary-schedule.html',
  styleUrls: ['./secretary-schedule.css'],
})
export class SecretaryScheduleComponent implements OnInit, OnDestroy {
  @ViewChild(ScheduleComponent) scheduleCmp!: ScheduleComponent;

  children: ChildRow[] = [];
  lessons: Lesson[] = [];
  filteredLessons: Lesson[] = [];
  selectedChild: ChildRow | null = null;
farmDaysOff: any[] = [];
  instructors: InstructorRow[] = [];
  selectedInstructorIds: string[] = [];

  instructorResources: { id: string; title: string }[] = [];

  instructorId = '';
  items: ScheduleItem[] = [];

  isFullscreen = false;

  currentRange: { start: string; end: string; viewType: string } | null = null;
  currentViewType:
  | 'timeGridDay'
  | 'timeGridWeek'
  | 'dayGridMonth'
  | 'resourceTimeGridDay'
  | 'resourceTimeGridWeek' = 'timeGridDay';

  autoAssignLoading = false;
  selectedOccurrence: any = null;

  contextMenuMode: ContextMenuMode = 'root';
  blockedDayCells: Array<{
  date: string;
  resourceId: string;
  startTime: string;
  endTime?: string | null;
  reason?: string | null;
  kind?: 'day_off' | 'not_working' | 'farm_off';
}> = [];

instructorWeeklyAvailability: Array<{
  instructor_id_number: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}> = [];

quickBooking: QuickBookingContext = {
  open: false,
  date: '',
  startTime: '',
  endTime: '',
  instructorId: '',
  instructorName: '',
};

  instructorsAll: InstructorRow[] = [];    // כל המדריכים (פעילים)
instructorsToday: InstructorRow[] = [];  // רק העובדים היום (פעילים + זמינות)

dayRequests: DayRequestRow[] = [];
affectedChildren: AffectedChild[] = [];
impactReviewMode = false;
impactLoading = false;
error: string | null = null;

selectedSickFile: File | null = null;
private pendingSickFile: File | null = null;
busyAction = signal<'check-impact' | 'submit-day-off' | null>(null);

busyText = computed(() => {
  switch (this.busyAction()) {
    case 'check-impact':
      return 'בודק השפעת בקשה…';
    case 'submit-day-off':
      return 'היעדרות בתהליך עדכון ושליחת מיילים…';
    default:
      return 'מעבד…';
  }
});


contextMenu = {
  visible: false,
  x: 0,
  y: 0,
  date: '' as string,
  time: '' as string,
  instructorId: '' as string,
  instructorName: '' as string,
};

rangeModal = {
  open: false,
  from: '',
  to: '',
  allDay: false,
  fromTime: '',
  toTime: '',
  type: 'holiday' as RequestType,
  text: '',
  reviewedImpact: false,
  instructorId: '',
};
timeOptions: string[] = Array.from({ length: 24 * 2 }, (_, i) => {
  const hours = Math.floor(i / 2).toString().padStart(2, '0');
  const minutes = ((i % 2) * 30).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
});
private lastAllDayPref = true;
   childAgeById = new Map<string, string>();
public instructorColorById = new Map<string, string>();

  weekInstructorStats: { instructor_id: string; instructor_name: string; totalLessons: number }[] = [];

  private unsubTenantChange: (() => void) | null = null;
private ui = inject(UiDialogService);

  public cu = inject(CurrentUserService);
  private cdr = inject(ChangeDetectorRef);
  occurrence: any;

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();

const { data: ridingTypes } = await dbTenant()
  .from('riding_types')
  .select('id, name');

this.ridingTypes = ridingTypes || [];

      await ensureTenantContextReady();

      this.unsubTenantChange = onTenantChange(async () => {
        await this.reloadAll();
      });

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

  private getTodayDow(): number {
  return new Date().getDay();
}

private extractYmd(iso: string): string {
  return String(iso).slice(0, 10);
}

private extractHm(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

private addMinutesToHm(hm: string, minutesToAdd: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = h * 60 + m + minutesToAdd;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}



private hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // להפוך ל-32bit
  }
  return Math.abs(hash);
}

private rebuildInstructorResources(): void {
  const ids = new Set(this.selectedInstructorIds.map(String));

  this.instructorResources = this.instructors
    .filter(i => ids.has(String(i.id_number)))
    .map(i => ({
      id: String(i.id_number),
      title: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
    }));

}

  private async reloadAll() {
  await this.loadChildren();
  await this.loadInstructors();
  await this.loadInstructorWeeklyAvailability();
  await this.loadLessons(this.currentRange ?? undefined);

  if (this.currentRange) {
    await this.loadRequestsForRange(
      this.currentRange.start.slice(0, 10),
      this.currentRange.end.slice(0, 10)
    );
  }

  this.filterLessons();
  this.setScheduleItems();
  this.buildBlockedDayCells(this.currentRange ?? undefined);
  this.buildWeekStats();
  this.cdr.detectChanges();
}

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';
  }
private async loadRequestsForRange(startYmd: string, endYmd: string): Promise<void> {
  const dbc = dbTenant();

  const { data, error } = await dbc
    .from('secretarial_requests')
    .select(`
      id,
      instructor_id,
      request_type,
      status,
      from_date,
      to_date,
      payload,
      decision_note,
      sick_note_file_path
    `)
    .eq('request_type', 'INSTRUCTOR_DAY_OFF')
    .lte('from_date', endYmd)
    .gte('to_date', startYmd);

  if (error) throw error;

  const rows = data ?? [];
  this.dayRequests = rows.flatMap((row: any) => this.expandRequestRow(row));
}

private expandRequestRow(row: any): DayRequestRow[] {
  const res: DayRequestRow[] = [];

  if (row.request_type !== 'INSTRUCTOR_DAY_OFF') return res;
  if (!row.from_date) return res;
  if (typeof row.payload?.category !== 'string') return res;

  let current = String(row.from_date).slice(0, 10);
  const end = String(row.to_date || row.from_date).slice(0, 10);

  const type: RequestType = this.mapDbRequestType(row.payload?.category);
  const status: RequestStatus = this.mapDbStatus(row.status);
  const note: string | null = row.payload?.note ?? row.decision_note ?? null;

  let guard = 0;
  while (current <= end) {
    res.push({
      id: row.id,
      instructor_id: row.instructor_id,
      request_date: current,
      request_type: type,
      status,
      note,
      all_day: row.payload?.all_day === true || row.payload?.all_day === 'true',
      start_time: row.payload?.requested_start_time ?? null,
      end_time: row.payload?.requested_end_time ?? null,
      sick_note_file_path: row.sick_note_file_path ?? null,
    });

    const next = this.addOneDayYmd(current);
    if (next <= current) break;

    current = next;
    if (++guard > 400) break;
  }

  return res;
}

private async loadInstructorWeeklyAvailability(): Promise<void> {
  const { data, error } = await dbTenant()
    .from('instructor_weekly_availability')
    .select('instructor_id_number, day_of_week, start_time, end_time');

  if (error) {
    console.error('availability load error', error);
    this.instructorWeeklyAvailability = [];
    return;
  }

  this.instructorWeeklyAvailability = (data ?? []) as Array<{
    instructor_id_number: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>;
}

private addOneDayYmdSafe(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);

  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');

  return `${yy}-${mm}-${dd}`;
}

private buildBlockedDayCells(range?: { start: string; end: string }): void {
  const blocked: Array<{
    date: string;
    resourceId: string;
    startTime: string;
    endTime?: string | null;
    reason?: string | null;
    kind?: 'day_off' | 'not_working' | 'farm_off';
  }> = [];

  const from = range?.start?.slice(0, 10) ?? '';
  const to = range?.end?.slice(0, 10) ?? '';

  const dateList: string[] = [];
if (from && to) {
  let cur = from;
  let guard = 0;

  while (cur <= to) {
    dateList.push(cur);

    const next = this.addOneDayYmdSafe(cur);
    if (next <= cur) break;

    cur = next;

    if (++guard > 400) break;
  }
}

  // 1) היעדרויות מדריך
  for (const req of this.dayRequests) {
    if (!req.instructor_id || !req.request_date) continue;
    if (req.status !== 'approved' && req.status !== 'pending') continue;

    blocked.push({
      date: req.request_date,
      resourceId: req.instructor_id,
      startTime: req.all_day ? '07:00' : (req.start_time?.slice(0, 5) || '07:00'),
      endTime: req.all_day ? '21:00' : (req.end_time?.slice(0, 5) || '21:00'),
      reason:
        req.request_type === 'sick'
          ? 'מדריך ביום מחלה'
          : req.request_type === 'holiday'
          ? 'מדריך ביום חופש'
          : req.request_type === 'personal'
          ? 'מדריך ביום אישי'
          : 'מדריך לא זמין',
      kind: 'day_off',
    });
  }

  // 2) שעות שהמדריך בכלל לא עובד
  const availabilityByInstructorAndDow = new Map<string, Array<{ start: string; end: string }>>();

  for (const row of this.instructorWeeklyAvailability || []) {
    const key = `${row.instructor_id_number}|${row.day_of_week}`;
    if (!availabilityByInstructorAndDow.has(key)) {
      availabilityByInstructorAndDow.set(key, []);
    }

    availabilityByInstructorAndDow.get(key)!.push({
      start: String(row.start_time).slice(0, 5),
      end: String(row.end_time).slice(0, 5),
    });
  }

  const visibleInstructorIds = new Set(this.instructorResources.map(r => String(r.id)));

  for (const inst of this.instructors) {
    if (!visibleInstructorIds.has(String(inst.id_number))) continue;

    for (const ymd of dateList) {
      const d = new Date(ymd + 'T00:00:00');
      const dow = d.getDay();
      const key = `${inst.id_number}|${dow}`;
      const spans = (availabilityByInstructorAndDow.get(key) ?? [])
        .sort((a, b) => a.start.localeCompare(b.start));

      if (!spans.length) {
        blocked.push({
          date: ymd,
          resourceId: inst.id_number,
          startTime: '07:00',
          endTime: '21:00',
          reason: 'המדריך אינו עובד ביום זה',
          kind: 'not_working',
        });
        continue;
      }

      let cursor = '07:00';

      for (const span of spans) {
        if (cursor < span.start) {
          blocked.push({
            date: ymd,
            resourceId: inst.id_number,
            startTime: cursor,
            endTime: span.start,
            reason: 'המדריך אינו עובד בשעות אלה',
            kind: 'not_working',
          });
        }

        if (cursor < span.end) {
          cursor = span.end;
        }
      }

      if (cursor < '21:00') {
        blocked.push({
          date: ymd,
          resourceId: inst.id_number,
          startTime: cursor,
          endTime: '21:00',
          reason: 'המדריך אינו עובד בשעות אלה',
          kind: 'not_working',
        });
      }
    }
  }

  this.blockedDayCells = blocked;
}


onRightClickDay(e: any): void {
  if (!e?.jsEvent) return;

  e.jsEvent.preventDefault();
  e.jsEvent.stopPropagation();

  const dateStr = typeof e.dateStr === 'string' ? e.dateStr : '';
  if (!dateStr) return;

  const localYmd = this.extractYmd(dateStr);
  const localHm = dateStr.includes('T') ? this.extractHm(dateStr) : '';

  const MENU_WIDTH = 210;
  const MENU_HEIGHT = this.contextMenuMode === 'dayOff' ? 260 : 150;
  const EDGE_GAP = 12;

  let x = e.jsEvent.clientX;
  let y = e.jsEvent.clientY;

  const maxX = window.innerWidth - MENU_WIDTH - EDGE_GAP;
  const maxY = window.innerHeight - MENU_HEIGHT - EDGE_GAP;

  x = Math.max(EDGE_GAP, Math.min(x, maxX));
  y = Math.max(EDGE_GAP, Math.min(y, maxY));

  this.contextMenu.visible = true;
  this.contextMenu.x = x;
  this.contextMenu.y = y;
  this.contextMenu.date = localYmd;
  this.contextMenu.time = localHm;
  this.contextMenu.instructorId = String(e.resourceId ?? '');
  this.contextMenu.instructorName = String(e.resourceTitle ?? '');
  this.contextMenuMode = 'root';

  this.cdr.detectChanges();
}


private repositionContextMenu(mode: ContextMenuMode): void {
  const EDGE_GAP = 12;
  const MENU_WIDTH = 210;
  const MENU_HEIGHT = mode === 'dayOff' ? 260 : 150;

  const maxX = window.innerWidth - MENU_WIDTH - EDGE_GAP;
  const maxY = window.innerHeight - MENU_HEIGHT - EDGE_GAP;

  this.contextMenu.x = Math.max(EDGE_GAP, Math.min(this.contextMenu.x, maxX));
  this.contextMenu.y = Math.max(EDGE_GAP, Math.min(this.contextMenu.y, maxY));
}

openDayOffMenu(): void {
  this.contextMenuMode = 'dayOff';
  this.repositionContextMenu('dayOff');
  this.cdr.detectChanges();
}

backToRootContextMenu(): void {
  this.contextMenuMode = 'root';
  this.repositionContextMenu('root');
  this.cdr.detectChanges();
}

openQuickBookingFromContext(): void {
  const { date, time, instructorId, instructorName } = this.contextMenu;

  if (!date || !time || !instructorId) {
    this.closeContextMenu();
    return;
  }

  this.quickBooking = {
    open: true,
    date,
    startTime: time,
    endTime: this.addMinutesToHm(time, 60), // ברירת מחדל שעה
    instructorId,
    instructorName,
  };

  this.closeContextMenu();
  this.cdr.detectChanges();
}

closeQuickBooking(): void {
  this.quickBooking.open = false;
}

async onQuickBookingSaved(): Promise<void> {
  this.quickBooking.open = false;

  if (this.currentRange) {
    await this.loadLessons({
      start: this.currentRange.start,
      end: this.currentRange.end,
    });

    await this.loadRequestsForRange(
      this.currentRange.start.slice(0, 10),
      this.currentRange.end.slice(0, 10)
    );

    await this.loadInstructorWeeklyAvailability();

    this.filterLessons();
    this.setScheduleItems();
    this.buildBlockedDayCells(this.currentRange);
    this.buildWeekStats();
    this.cdr.detectChanges();
  }
}

closeContextMenu(): void {
  this.contextMenu.visible = false;
}
async openRequest(type: RequestType): Promise<void> {
  const date = this.contextMenu.date;
  this.closeContextMenu();
  if (!date) return;

  const allDay = this.lastAllDayPref;

this.affectedChildren = [];
  this.impactReviewMode = false;
  this.impactLoading = false;
  this.selectedSickFile = null;
  this.pendingSickFile = null;

  this.rangeModal = {
    open: true,
    from: date,
    to: date,
    allDay,
    fromTime: allDay ? '' : '08:00',
    toTime: allDay ? '' : '12:00',
    type,
    text: '',
    reviewedImpact: false,
    instructorId: this.selectedInstructorIds.length === 1 ? this.selectedInstructorIds[0] : '',
  };

  this.cdr.detectChanges();
}

closeRangeModal(): void {
  this.rangeModal.open = false;
  this.rangeModal.reviewedImpact = false;
  this.impactReviewMode = false;
  this.impactLoading = false;
this.affectedChildren = [];
  this.selectedSickFile = null;
  this.pendingSickFile = null;
}
onSickFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  this.selectedSickFile = file;
  this.pendingSickFile = file;
}
async submitRange(): Promise<void> {
  if (this.busyAction()) return;
  this.error = null;

  const {
    from,
    to,
    allDay,
    fromTime,
    toTime,
    type,
    text,
    reviewedImpact,
    instructorId,
  } = this.rangeModal;

  this.lastAllDayPref = !!allDay;

  if (!instructorId) {
    this.error = 'חובה לבחור מדריך';
    return;
  }

  if (!from || !to) {
    this.error = 'חובה לבחור מתאריך ועד תאריך';
    return;
  }

  if (!allDay) {
    if (!fromTime || !toTime) {
      this.error = 'חובה לבחור שעות התחלה וסיום';
      return;
    }

    if (fromTime >= toTime) {
      this.error = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה';
      return;
    }
  }
if (!reviewedImpact) {
  try {
    this.busyAction.set('check-impact');
    this.impactLoading = true;
this.affectedChildren = [];
    const hasLessons = await this.hasLessonsInRangeFromDb(instructorId, from, to);

    if (hasLessons) {
    await this.loadAffectedChildrenFromDb(
  instructorId,
  from,
  to,
  allDay,
  allDay ? null : fromTime,
  allDay ? null : toTime
);
    }

    this.rangeModal.reviewedImpact = true;
    this.impactReviewMode = true;
    this.cdr.detectChanges();
    return;
  } catch (err: any) {
    console.error('submitRange impact check error', err);
    this.error = err?.message || 'שגיאה בבדיקת ההשפעה של הבקשה';
    return;
  } finally {
    this.impactLoading = false;
    this.busyAction.set(null);
    this.cdr.detectChanges();
  }
}
 try {
  this.busyAction.set('submit-day-off');
  this.cdr.detectChanges(); // 🔥 חשוב!!

  // נותן ל-UI רינדור לפני ה-call
  await new Promise(res => setTimeout(res, 50));

  await this.executeInstructorDayOffBySecretary(
    instructorId,
    from,
    to,
    allDay,
    allDay ? null : fromTime,
    allDay ? null : toTime,
    type,
    text?.trim() || null
  );

  this.closeRangeModal();

  if (this.currentRange) {
    await this.loadLessons({
      start: this.currentRange.start,
      end: this.currentRange.end,
    });

    await this.loadRequestsForRange(
      this.currentRange.start.slice(0, 10),
      this.currentRange.end.slice(0, 10)
    );

    this.filterLessons();
    this.setScheduleItems();
    this.buildWeekStats();
  }

  this.cdr.detectChanges();
} catch (err: any) {
  console.error('submitRange save error', err);
  this.error = err?.message || 'שגיאה בשמירת הבקשה';
  this.cdr.detectChanges();
} finally {
  this.busyAction.set(null);
}
}
private async hasLessonsInRangeFromDb(
  instructorId: string,
  from: string,
  to: string
): Promise<boolean> {
  const dbc = dbTenant();

  const { data, error } = await dbc
    .from('lessons_occurrences')
    .select('lesson_id')
    .eq('instructor_id', instructorId)
    .gte('occur_date', from)
    .lte('occur_date', to)
    .limit(1);

  if (error) {
    console.error('hasLessonsInRangeFromDb error', error);
    return false;
  }

  return (data?.length ?? 0) > 0;
}
private async loadAffectedChildrenFromDb(
  instructorId: string,
  from: string,
  to: string,
  allDay: boolean,
  fromTime: string | null,
  toTime: string | null,
): Promise<void> {
  const dbc = dbTenant();

  const { data: lessons, error: lessonsError } = await dbc
    .from('lessons_occurrences')
    .select(`
      lesson_id,
      child_id,
      occur_date,
      start_time,
      end_time,
      start_datetime,
      end_datetime,
      status
    `)
    .eq('instructor_id', instructorId)
    .gte('occur_date', from)
    .lte('occur_date', to);

  if (lessonsError) {
    console.error('lessons fetch error', lessonsError);
    this.affectedChildren = [];
    return;
  }

  const relevantLessons = (lessons ?? []).filter((l: any) => {
    const rawStatus = String(l.status ?? '').toLowerCase();
    const isCancelled =
      rawStatus.includes('cancel') ||
      rawStatus.includes('בוטל') ||
      rawStatus.includes('מבוטל');

    if (isCancelled) return false;

    const lessonDate = String(l.occur_date ?? '').slice(0, 10);
    if (!lessonDate) return false;

    if (allDay) return true;

    if (!fromTime || !toTime) return false;

    const lessonStartIso = l.start_datetime
      ? l.start_datetime
      : `${lessonDate}T${String(l.start_time ?? '00:00').slice(0, 5)}:00`;

    const lessonEndIso = l.end_datetime
      ? l.end_datetime
      : `${lessonDate}T${String(l.end_time ?? '00:00').slice(0, 5)}:00`;

    const reqStart = new Date(`${lessonDate}T${fromTime}:00`);
    const reqEnd = new Date(`${lessonDate}T${toTime}:00`);
    const lessonStart = new Date(lessonStartIso);
    const lessonEnd = new Date(lessonEndIso);

    return lessonStart < reqEnd && lessonEnd > reqStart;
  });

  if (!relevantLessons.length) {
    this.affectedChildren = [];
    return;
  }

  const childIds = [
    ...new Set(relevantLessons.map((l: any) => l.child_id).filter(Boolean)),
  ];

  const { data: children, error: childrenError } = await dbc
    .from('children')
    .select('child_uuid, first_name, last_name, birth_date, status')
    .in('child_uuid', childIds);

  if (childrenError) {
    console.error('children fetch error', childrenError);
    this.affectedChildren = [];
    return;
  }

  this.affectedChildren = children ?? [];
}
async onAllDayToggle(allDay: boolean): Promise<void> {
  this.error = null;
  this.rangeModal.allDay = allDay;

  if (!allDay) {
    if (!this.rangeModal.fromTime) this.rangeModal.fromTime = '08:00';
    if (!this.rangeModal.toTime) this.rangeModal.toTime = '12:00';
  } else {
    this.rangeModal.fromTime = '';
    this.rangeModal.toTime = '';
  }

  this.impactLoading = false;
this.affectedChildren = [];
  // אם כבר בוצעה בדיקה בעבר – טוענים מחדש אוטומטית
  if (this.rangeModal.reviewedImpact) {
    await this.refreshAffectedChildrenPreview();
  } else {
    this.impactReviewMode = false;
  }

  this.cdr.detectChanges();
}
async onTimeChanged(): Promise<void> {
  this.error = null;
  this.impactLoading = false;
this.affectedChildren = [];
  if (this.rangeModal.reviewedImpact && !this.rangeModal.allDay) {
    await this.refreshAffectedChildrenPreview();
  } else if (!this.rangeModal.reviewedImpact) {
    this.impactReviewMode = false;
  }

  this.cdr.detectChanges();
}
async onDateRangeChanged(): Promise<void> {
  this.error = null;
  this.impactLoading = false;
this.affectedChildren = [];
  if (this.rangeModal.reviewedImpact) {
    await this.refreshAffectedChildrenPreview();
  } else {
    this.impactReviewMode = false;
  }

  this.cdr.detectChanges();
}
async onRequestInstructorChanged(): Promise<void> {
  this.error = null;
  this.impactLoading = false;
this.affectedChildren = [];
  if (this.rangeModal.reviewedImpact) {
    await this.refreshAffectedChildrenPreview();
  } else {
    this.impactReviewMode = false;
  }

  this.cdr.detectChanges();
}

private async refreshAffectedChildrenPreview(): Promise<void> {
  const { from, to, allDay, fromTime, toTime, instructorId } = this.rangeModal;

  if (!from || !to || !instructorId) return;

  if (!allDay) {
    if (!fromTime || !toTime) return;
    if (fromTime >= toTime) return;
  }

  try {
    this.impactLoading = true;
this.affectedChildren = [];
    const hasLessons = await this.hasLessonsInRangeFromDb(instructorId, from, to);

    if (hasLessons) {
    await this.loadAffectedChildrenFromDb(
  instructorId,
  from,
  to,
  allDay,
  allDay ? null : fromTime,
  allDay ? null : toTime
);
    }

    this.rangeModal.reviewedImpact = true;
    this.impactReviewMode = true;
  } catch (err: any) {
    console.error('refreshAffectedChildrenPreview error', err);
    this.error = err?.message || 'שגיאה בטעינת ההשפעה';
  } finally {
    this.impactLoading = false;
    this.cdr.detectChanges();
  }
}
private async executeInstructorDayOffBySecretary(
  instructorId: string,
  fromDate: string,
  toDate: string,
  allDay: boolean,
  fromTime: string | null,
  toTime: string | null,
  type: RequestType,
  note: string | null,
): Promise<void> {
  const authMod = await import('firebase/auth');
  const auth = authMod.getAuth();
  const token = await auth.currentUser?.getIdToken();

  if (!token) {
    throw new Error('לא נמצא טוקן משתמש');
  }

  await ensureTenantContextReady();
  const tenant = requireTenant();

  const tenantSchema = tenant.schema;
  const tenantId = tenant.id;

  const url =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/secretaryCreateInstructorDayOffAndNotify';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tenantSchema,
      tenantId,
      instructorId,
      fromDate,
      toDate,
      allDay,
      startTime: allDay ? null : fromTime,
      endTime: allDay ? null : toTime,
      requestType: this.mapRequestTypeToDb(type),
      decisionNote: note ?? null,
    }),
  });

  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }

  if (!resp.ok) {
    throw new Error(json?.message || json?.error || 'הפעולה נכשלה');
  }

  const mailOk = json?.mailOk ?? true;
  const warning = String(json?.warning ?? '').trim();

  if (mailOk === false) {
    console.warn('Instructor day off executed but mail failed', json);
    await this.ui.alert(
      `יום החופש עודכן, אבל שליחת מייל נכשלה${warning ? `: ${warning}` : ''}`,
      'אזהרה'
    );
    return;
  }

  if (warning) {
    await this.ui.alert(warning, 'אזהרה');
  }
}
private async uploadSickFile(file: File, requestId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client is not initialized');
  }

  const ext = file.name.split('.').pop();
  if (!ext) {
    throw new Error('Invalid file extension');
  }

  const path = `secretary_request_${requestId}.${ext}`;

  const { error } = await supabase.storage
    .from('sick_notes')
    .upload(path, file, { upsert: true });

  if (error) throw error;

  return path;
}
private mapDbRequestType(x: string | null | undefined): RequestType {
  const val = String(x ?? '').toUpperCase().trim();

  switch (val) {
    case 'HOLIDAY':
      return 'holiday';
    case 'SICK':
      return 'sick';
    case 'PERSONAL':
      return 'personal';
    case 'OTHER':
      return 'other';
    default:
      return 'other';
  }
}

private mapDbStatus(x: string | null | undefined): RequestStatus {
  const map: Record<string, RequestStatus> = {
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REJECTED_BY_SYSTEM: 'rejected',
    PENDING: 'pending',
  };

  const key = String(x ?? '').toUpperCase();
  return map[key] ?? 'pending';
}

private mapRequestTypeToDb(t: RequestType): string {
  const map: Record<RequestType, string> = {
    holiday: 'HOLIDAY',
    sick: 'SICK',
    personal: 'PERSONAL',
    other: 'OTHER',
  };
  return map[t];
}

getRequestLabel(type: RequestType): string {
  switch (type) {
    case 'holiday':
      return 'יום חופש';
    case 'sick':
      return 'יום מחלה';
    case 'personal':
      return 'יום אישי';
    default:
      return 'בקשה אחרת';
  }
}
  /** ילדים פעילים */
  private async loadChildren(): Promise<void> {
    try {
      const dbc = dbTenant();
      const { data, error } = await dbc
  .from('children')
  .select('child_uuid, first_name, last_name, birth_date, status')
  .in('status', ['Active']);


      if (error) throw error;

      this.children = (data ?? []) as ChildRow[];
    } catch (err) {
      console.error('loadChildren failed', err);
      this.children = [];
    }
      this.childAgeById = new Map(
  this.children.map(c => [c.child_uuid, this.calcChildAge(c.birth_date ?? null)])
);


  }

private calcChildAge(birthDate: string | null): string {
  if (!birthDate) return '';
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return years > 0 ? years.toString() : '';
}
ridingTypes: { id: string; name: string }[] = [];

private async loadInstructors(): Promise<void> {
  try {
    const dbc = dbTenant();

    // 1) כל המדריכים
    const { data: all, error: e1 } = await dbc
      .from('instructors')
      .select('id_number, first_name, last_name, status, color_hex');

    if (e1) throw e1;

    const allRows = (all ?? []) as InstructorRow[];

    // UI למעלה: כל הפעילים
    this.instructorsAll = allRows;
    this.instructors = allRows.filter(i => i.status === 'Active');

    // צבעים מכל המדריכים
    this.instructorColorById = new Map(
      this.instructorsAll
        .filter(i => i.color_hex && i.color_hex.trim() !== '')
        .map(i => [String(i.id_number), i.color_hex!.trim()])
    );

    // 2) עובדים היום לפי זמינות
    const dow = new Date().getDay(); // 0..6
    const { data: avail, error: e2 } = await dbc
      .from('instructor_weekly_availability')
      .select('instructor_id_number')
      .eq('day_of_week', dow);

    if (e2) throw e2;

    const todayIds = new Set((avail ?? []).map((r: any) => String(r.instructor_id_number)));

    this.instructorsToday = this.instructors.filter(i => todayIds.has(String(i.id_number)));

    // 3) ברירת מחדל לבחירה: רק של היום (או אני אם אני עובד היום)
    if (!this.selectedInstructorIds.length) {
      const me = String(this.instructorId || '');

      if (me && this.instructorsToday.some(i => String(i.id_number) === me)) {
        this.selectedInstructorIds = [me];
      } else {
        this.selectedInstructorIds = this.instructorsToday.map(i => String(i.id_number));
      }

      // אם אין בכלל זמינות היום → fallback: כל הפעילים
      if (!this.selectedInstructorIds.length) {
        this.selectedInstructorIds = this.instructors.map(i => String(i.id_number));
      }
    }

    // 4) resources ללוח נקבעים לפי הבחירה הנוכחית
    this.rebuildInstructorResources();

  } catch (err) {
    console.error('loadInstructors failed', err);
    this.instructorsAll = [];
    this.instructorsToday = [];
    this.instructors = [];
  }
}


  get isAllInstructorsSelected(): boolean {
    return (
      this.instructors.length > 0 &&
      this.selectedInstructorIds.length === this.instructors.map(i => i.id_number).length
    );
  }

toggleAllInstructors() {
  if (this.isAllInstructorsSelected) {
    this.selectedInstructorIds = [];
  } else {
    this.selectedInstructorIds = this.instructors
      .filter(i => i.status === 'Active')
      .map(i => i.id_number);
  }

  this.rebuildInstructorResources();
  this.filterLessons();
  this.setScheduleItems();
  this.buildBlockedDayCells(this.currentRange ?? undefined);
  this.buildWeekStats();
}


 toggleInstructor(id: string) {
  if (this.selectedInstructorIds.includes(id)) {
    this.selectedInstructorIds = this.selectedInstructorIds.filter(x => x !== id);
  } else {
    this.selectedInstructorIds = [...this.selectedInstructorIds, id];
  }

  this.rebuildInstructorResources();
  this.filterLessons();
  this.setScheduleItems();
  this.buildBlockedDayCells(this.currentRange ?? undefined);
  this.buildWeekStats();
}

 async onViewRange(range: { start: string; end: string; viewType: string }) {
  this.currentRange = range;
  this.currentViewType = range.viewType as any;

  await this.loadLessons({ start: range.start, end: range.end });
  await this.loadFarmDaysOffForRange(
    range.start.slice(0, 10),
    range.end.slice(0, 10)
  );
  await this.loadRequestsForRange(
    range.start.slice(0, 10),
    range.end.slice(0, 10)
  );
  await this.loadInstructorWeeklyAvailability();

  this.filterLessons();
  this.setScheduleItems();
  this.buildBlockedDayCells(range);
  this.buildWeekStats();
  this.cdr.detectChanges();
}


private async loadLessons(
  range?: { start: string; end: string }
): Promise<void> {
  try {
    const childIds = this.children.map(c => c.child_uuid).filter(Boolean);
    if (!childIds.length) {
      this.lessons = [];
      return;
    }

    const dbc = dbTenant();

    const today = new Date().toISOString().slice(0, 10);
    const in8Weeks = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    const from = range?.start ?? today;
    const to   = range?.end   ?? in8Weeks;

    // 1) השיעורים עצמם (כמו שהיה)
    const { data: occData, error: err1 } = await dbc
  .from('lessons_occurrences')
.select(`
  lesson_id,
  child_id,
  day_of_week,
  start_time,
  end_time,
  lesson_type,
  status,
  instructor_id,
  start_datetime,
  end_datetime,
  occur_date,

  lesson_occurrence_exceptions (
    status,
    is_makeup_allowed
  )
`)

      .in('child_id', childIds)
      .gte('occur_date', from)
      .lte('occur_date', to)
      .order('start_datetime', { ascending: true });

    if (err1) throw err1;

    // 2) משאבי סוס+מגרש לפי אותו טווח
    const { data: resData, error: err2 } = await dbc
      .from('lessons_with_children')
      .select('lesson_id, occur_date, horse_name, arena_name')
      .in('child_id', childIds)
      .gte('occur_date', from)
      .lte('occur_date', to);

    if (err2) throw err2;

    // 3) בניית Map לפי (lesson_id + occur_date)
    const resourceByKey = new Map<
      string,
      { horse_name: string | null; arena_name: string | null }
    >();

    for (const row of resData ?? []) {
      const key = `${row.lesson_id}::${row.occur_date}`;
      resourceByKey.set(key, {
        horse_name: row.horse_name ?? null,
        arena_name: row.arena_name ?? null,
      });
    }

    // 4) מיפוי לשיעורים + הוספת horse/arena מה-Map
    const nameByChild = new Map(
      this.children.map(c => [
        c.child_uuid,
        `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
      ])
    );

    const instructorNameById = new Map(
  this.instructorsAll.map(i => [
    i.id_number,
    `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),  ]));

    this.lessons = (occData ?? []).map((r: any) => {
      const ex = r.lesson_occurrence_exceptions;
const finalStatus =
  ex?.status === 'בוטל'
    ? 'בוטל'
    : r.status;

const isMakeupAllowed =
  ex?.is_makeup_allowed ?? false;

      const key = `${r.lesson_id}::${r.occur_date}`;
      const res = resourceByKey.get(key);

      return {
        lesson_id: String(r.lesson_id ?? ''),
        id:        String(r.lesson_id ?? ''),
        child_id:  r.child_id,
        day_of_week: r.day_of_week,
        start_time:  r.start_time,
        end_time:    r.end_time,
        lesson_type: r.lesson_type,
      
        instructor_id:   r.instructor_id ?? '',
        instructor_name: instructorNameById.get(r.instructor_id) || '',
        child_color: this.getColorForChild(r.child_id),
        child_name:  nameByChild.get(r.child_id) || '',
        start_datetime: r.start_datetime ?? null,
          status: finalStatus,   // 🔥 חובה
        end_datetime:   r.end_datetime ?? null,
        occur_date:     r.occur_date ?? null,
  is_makeup_allowed: isMakeupAllowed,
        // 👇 עכשיו באמת מגיע מהנתונים של ה-view
        horse_name: res?.horse_name ?? null,
        arena_name: res?.arena_name ?? null,
      } as Lesson;
    });
  } catch (err) {
    console.error('loadLessons failed', err);
    this.lessons = [];
  }
}
private async loadFarmDaysOffForRange(startYmd: string, endYmd: string): Promise<void> {
  const dbc = dbTenant();

  const { data, error } = await dbc
    .from('farm_days_off')
    .select(`
      id,
      reason,
      start_date,
      end_date,
      day_type,
      start_time,
      end_time,
      is_active
    `)
    .eq('is_active', true)
    .lte('start_date', endYmd)
    .gte('end_date', startYmd);

  if (error) throw error;

  this.farmDaysOff = data ?? [];
}

  /** סינון שיעורים לפי מדריכים מסומנים + טווח תצוגה */
 private filterLessons(): void {
  let src = [...this.lessons];

  const selected = this.selectedInstructorIds.filter(Boolean);
  if (selected.length) {
    src = src.filter(l => selected.includes(String(l.instructor_id ?? '')));
  } else {
    src = [];
  }

  if (this.currentRange) {
    const { start, end } = this.currentRange;
    src = src.filter(l => {
      const d =
        (l as any).occur_date ||
        ((l as any).start_datetime
          ? (l as any).start_datetime.slice(0, 10)
          : '');
      if (!d) return true;
      return d >= start && d <= end;
    });
  }

  // ✅ כאן בדיוק מוסיפים את הסינון של חופשת מדריך
  src = src.filter((l: any) => {
    const lessonDate =
      l.occur_date ||
      (l.start_datetime ? String(l.start_datetime).slice(0, 10) : '');

    if (!lessonDate) return true;

    const startIso =
      this.buildDateTime(l.occur_date, l.start_time) ??
      this.ensureIso(
        l.start_datetime as any,
        l.start_time as any,
        l.occur_date as any
      );

    const endIsoRaw =
      this.buildDateTime(l.occur_date, l.end_time) ??
      this.ensureIso(
        l.end_datetime as any,
        l.end_time as any,
        l.occur_date as any
      );

    const endIso = this.ensureEndAfterStart(startIso, endIsoRaw);

    return !this.isLessonBlockedByInstructorOff(
      String(l.instructor_id ?? ''),
      lessonDate,
      new Date(startIso),
      new Date(endIso)
    );
  });

  this.filteredLessons = src;
}
private addOneDayYmd(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);

  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
 private setScheduleItems(): void {
  const src = this.filteredLessons;

  const getDate = (l: any): string | null => {
    if (l.occur_date) return l.occur_date;
    if (l.start_datetime) return String(l.start_datetime).slice(0, 10);
    return null;
  };

  const makeLessonEvent = (lesson: any): ScheduleItem => {
    const instructorId = String(lesson.instructor_id || '');

    const colorFromDb = this.instructorColorById.get(instructorId);

    const instructorBorderColor =
      colorFromDb && colorFromDb.trim() !== ''
        ? colorFromDb
        : this.getColorForInstructor(instructorId);

    const start =
      this.buildDateTime(lesson.occur_date, lesson.start_time) ??
      this.ensureIso(
        lesson.start_datetime as any,
        lesson.start_time as any,
        lesson.occur_date as any
      );

    let end =
      this.buildDateTime(lesson.occur_date, lesson.end_time) ??
      this.ensureIso(
        lesson.end_datetime as any,
        lesson.end_time as any,
        lesson.occur_date as any
      );

    end = this.ensureEndAfterStart(start, end);

    const childName = lesson.child_name ?? '';
    const lessonType = lesson.lesson_type ?? '';
    const age = this.childAgeById.get(lesson.child_id) || '';
    const childDisplay = age ? `${childName} (${age})` : childName;

    return {
      id: lesson.id,
      title: childDisplay,
      start,
      end,
      color: lesson.child_color,
      status: lesson.status,
      meta: {
        status: lesson.status ?? '',
        child_id: lesson.child_id,
        child_name: childDisplay,
        instructor_id: lesson.instructor_id,
        instructor_name: lesson.instructor_name,
        instructor_color: instructorBorderColor,
        lesson_type: lessonType,
        children: childDisplay,
        horse_name: lesson.horse_name,
        arena_name: lesson.arena_name,
        lesson_id: lesson.lesson_id,
        occur_date: lesson.occur_date,
        is_makeup_allowed: lesson['is_makeup_allowed'] ?? false,
      },
    } as ScheduleItem;
  };

  // ✅ מגדירים פעם אחת בתחילת הפונקציה
  const farmOffItems = this.farmDaysOffToItems();
  const instructorOffItems = this.instructorDaysOffToItems();

  // ===== חודשי =====
  if (this.currentViewType === 'dayGridMonth') {
    const perDay = new Map<string, number>();

    src.forEach(l => {
      const d = getDate(l);
      if (!d) return;
      perDay.set(d, (perDay.get(d) || 0) + 1);
    });

    this.items = Array.from(perDay.entries()).map(([date, count]) => ({
      id: `sum-day-${date}`,
      title: `${count} שיעורים`,
      start: `${date}T00:00:00`,
      end: `${date}T23:59:59`,
      color: 'transparent',
      status: 'אושר',
      meta: {
        status: '',
        child_id: '',
        child_name: '',
        instructor_id: '',
        instructor_name: '',
        lesson_type: 'summary-day',
        isSummaryDay: '1',
      },
    })) as any;

    this.items = [...this.items, ...farmOffItems, ...instructorOffItems];
    return;
  }

  // ===== שבוע =====
  if (this.currentViewType === 'timeGridWeek') {
    type Key = string;

    const perDayInstructor = new Map<Key, {
      date: string;
      instructor_id: string;
      instructor_name: string;
      count: number;
    }>();

    for (const l of src) {
      const d = getDate(l);
      if (!d) continue;

      const instId = (l as any).instructor_id || '';
      const instName = (l as any).instructor_name || 'ללא מדריך';
      const key: Key = `${d}|${instId}`;

      if (!perDayInstructor.has(key)) {
        perDayInstructor.set(key, {
          date: d,
          instructor_id: instId,
          instructor_name: instName,
          count: 0,
        });
      }
      perDayInstructor.get(key)!.count++;
    }

    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);

    const perDate = new Map<string, {
      date: string;
      instructor_id: string;
      instructor_name: string;
      count: number;
    }[]>();

    for (const g of perDayInstructor.values()) {
      if (!perDate.has(g.date)) perDate.set(g.date, []);
      perDate.get(g.date)!.push(g);
    }

    const result: ScheduleItem[] = [];

    for (const [date, groups] of perDate.entries()) {
      groups.sort((a, b) =>
        a.instructor_name.localeCompare(b.instructor_name, 'he')
      );

      groups.forEach((g, idxInDay) => {
        const baseHour = 7;
        const startHour = baseHour + idxInDay;
        const endHour = startHour;

        const start = `${date}T${pad(startHour)}:00:00`;
        const end = `${date}T${pad(endHour)}:50:00`;

        result.push({
          id: `sum-week-${date}-${g.instructor_id}`,
          title: `${g.instructor_name} · ${g.count} שיעורים`,
          start,
          end,
          status: 'אושר',
          meta: {
            status: '',
            child_id: '',
            child_name: '',
            instructor_id: g.instructor_id,
            instructor_name: g.instructor_name,
            lesson_type: 'summary-week',
            isSummarySlot: '1',
          },
        } as ScheduleItem);
      });
    }

    this.items = [...result, ...farmOffItems, ...instructorOffItems];
    return;
  }

  // ===== יום =====
  if (this.currentViewType === 'timeGridDay') {
    this.items = src.map(makeLessonEvent);
    this.items = [...this.items, ...farmOffItems, ...instructorOffItems];
    return;
  }

  // ===== ברירת מחדל =====
  this.items = src.map(makeLessonEvent);
  this.items = [...this.items, ...farmOffItems, ...instructorOffItems];
}
private instructorDaysOffToItems(): ScheduleItem[] {
  return (this.dayRequests ?? [])
    .filter(r => r.status === 'approved' || r.status === 'pending')
    .map(r => {
      const isPending = r.status === 'pending';

      let bg = '#e5e7eb';
      let text = '#374151';

      switch (r.request_type) {
        case 'holiday':
          bg = isPending ? '#fff8e7' : '#fef3c7';
          text = '#92400e';
          break;
        case 'sick':
          bg = isPending ? '#fff4e5' : '#ffe4e6';
          text = isPending ? '#9a6700' : '#9f1239';
          break;
        case 'personal':
          bg = isPending ? '#fff7e8' : '#ede9fe';
          text = isPending ? '#9a6700' : '#5b21b6';
          break;
        default:
          bg = isPending ? '#fff8e7' : '#e5e7eb';
          text = isPending ? '#9a6700' : '#374151';
          break;
      }

      const start = r.all_day || !r.start_time
        ? `${r.request_date}T00:00:00`
        : `${r.request_date}T${r.start_time}:00`;

      const end = r.all_day || !r.end_time
        ? `${r.request_date}T23:59:59`
        : `${r.request_date}T${r.end_time}:00`;

      const inst = this.instructorsAll.find(
        i => String(i.id_number) === String(r.instructor_id)
      );
      const instructorName = `${inst?.first_name ?? ''} ${inst?.last_name ?? ''}`.trim();

      return {
        id: `instructor_off_${r.id}_${r.request_date}_${r.instructor_id}`,
        title: isPending
          ? `${instructorName} — ${this.getRequestLabel(r.request_type)}`
          : `${instructorName} — ${this.getRequestLabel(r.request_type)}`,
        start,
        end,
        allDay: false,
        display: 'block',
        overlap: false,
        color: bg,
        textColor: text,
        classNames: [isPending ? 'pending-instructor-day-off' : 'instructor-day-off'],
        status: isPending ? 'PENDING' as any : 'APPROVED' as any,
        meta: {
          isInstructorDayOff: isPending ? undefined : 'true',
          isPendingInstructorDayOff: isPending ? 'true' : undefined,
          request_type: r.request_type,
          note: r.note ?? null,
          instructor_id: r.instructor_id,
          instructor_name: instructorName,
        } as any,
      } as ScheduleItem;
    });
}

private isLessonBlockedByInstructorOff(
  instructorId: string,
  lessonDate: string,
  lessonStart?: Date,
  lessonEnd?: Date
): boolean {
  return (this.dayRequests ?? []).some(r => {
    if (r.status !== 'approved') return false;
    if (String(r.instructor_id) !== String(instructorId)) return false;
    if (r.request_date !== lessonDate) return false;

    // יום מלא
    if (r.all_day === true) return true;

    // אם אין שעות - לא לחסום
    if (!r.start_time || !r.end_time) return false;
    if (!lessonStart || !lessonEnd) return false;

    const offStart = new Date(`${lessonDate}T${r.start_time}`);
    const offEnd = new Date(`${lessonDate}T${r.end_time}`);

    return lessonStart < offEnd && lessonEnd > offStart;
  });
}
private farmDaysOffToItems(): ScheduleItem[] {
  return (this.farmDaysOff ?? []).map((d: any) => {
    const isFullDay = String(d.day_type || '').toUpperCase() === 'FULL_DAY';

    const start = isFullDay
      ? String(d.start_date).slice(0, 10)
      : `${d.start_date}T${String(d.start_time).slice(0,5)}:00`;

    const end = isFullDay
      ? `${String(d.end_date).slice(0, 10)}T23:59:59`
      : `${d.start_date}T${String(d.end_time).slice(0,5)}:00`;

    return {
      id: `farm_off_${d.id}`,
      title: d.reason?.trim()
        ? ` ${d.reason}`
        : ' חופשת חווה',
      start,
      end,
      allDay: isFullDay,
      display: 'block',
      color: 'rgba(255, 183, 77, 0.35)',
      textColor: '#1f2a1f',
      status: 'farm_day_off' as any,
      meta: {
        isFarmDayOff: 'true',
      } as any,
    };
  });
}
  private ensureIso(datetime?: string | null, time?: string | null, baseDate?: string | null): string {
    if (datetime && typeof datetime === 'string' && datetime.includes('T')) return datetime;

    if (datetime && typeof datetime === 'string' && datetime.trim() !== '') {
      return datetime.replace(' ', 'T');
    }

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
private getColorForInstructor(id: string): string {
  const palette = ['#ff6b6b', '#4dabf7', '#51cf66', '#f59f00', '#845ef7'];
  const idx = this.hashString(id) % palette.length;
  return palette[idx];
}

  onEventClick(arg: EventClickArg): void {
  const ext: any = arg.event.extendedProps || {};
  const meta: any = ext.meta || ext;

  const childId =
    meta.child_id ||
    ext.child_id ||
    null;

  if (!childId) {
    console.warn('❌ secretary onEventClick – no child_id', ext);
    this.selectedChild = null;
    this.selectedOccurrence = null;
    return;
  }

  const child =
    this.children.find(c => c.child_uuid === childId) ?? null;

  this.selectedChild = child ? { ...child } : null;

  // 🔑 lesson_id – לוקחים מה-meta או מה-id של האירוע
let lessonId: string | null = meta.lesson_id ?? null;


  if (!lessonId && arg.event.id) {
    lessonId = String(arg.event.id);
  }

  // 🔑 occur_date
  const occurDate =
    meta.occur_date ??
    (arg.event.start
      ? arg.event.start.toISOString().slice(0, 10)
      : null);

       const rawStatus = String(meta.status ?? '').toLowerCase();
const isCancelled =
  rawStatus.includes('בוטל') ||
  rawStatus.includes('מבוטל') ||
  rawStatus.includes('cancel');

  this.selectedOccurrence = {
    lesson_id: lessonId,
    child_id: childId,
    occur_date: occurDate,
    status: meta.status ?? null,
    lesson_type: meta.lesson_type ?? null,
    start: arg.event.start,
    end: arg.event.end,
    is_makeup_allowed: !!meta.is_makeup_allowed,
  };

  
  this.cdr.detectChanges();
}

  onDateClick(arg: any): void {
    const dateStr = arg?.dateStr ??
      (arg?.date ? arg.date.toISOString().slice(0, 10) : '');

    if (!dateStr) return;

    if (this.currentViewType === 'dayGridMonth' || this.currentViewType === 'timeGridWeek') {
      if (this.scheduleCmp) {
        this.scheduleCmp.goToDay(dateStr);
      }
      return;
    }
  }

  private buildDateTime(dateStr?: string | null, timeStr?: string | null): string | null {
  if (!dateStr || !timeStr) return null;

  // time יכול להגיע HH:mm או HH:mm:ss
  const t = String(timeStr).length === 5 ? `${timeStr}:00` : String(timeStr);
  return `${dateStr}T${t}`;
}

private ensureEndAfterStart(startIso: string, endIso: string): string {
  // אם בטעות end קטן מ-start (בעיה של נתונים/יום מתחלף) – נשאיר מינימום 30 דק
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (isNaN(s) || isNaN(e)) return endIso;
  if (e > s) return endIso;

  // fallback: +30 דקות
  return this.toLocalIso(new Date(s + 30 * 60 * 1000));
}


  private buildWeekStats(): void {
    if (this.currentViewType !== 'timeGridWeek') {
      this.weekInstructorStats = [];
      return;
    }

    const stats = new Map<string, { instructor_id: string; instructor_name: string; totalLessons: number }>();

    for (const l of this.filteredLessons) {
      const id = (l as any).instructor_id || '';
      if (!id) continue;
      const key = id;
      const name = (l as any).instructor_name || id;

      if (!stats.has(key)) {
        stats.set(key, { instructor_id: id, instructor_name: name, totalLessons: 0 });
      }
      stats.get(key)!.totalLessons++;
    }

    this.weekInstructorStats = Array.from(stats.values()).sort((a, b) =>
      a.instructor_name.localeCompare(b.instructor_name, 'he')
    );
  }

  async autoAssignForCurrentDay(): Promise<void> {
  // רק בתצוגת יום, ובלוח של המזכירה
  if (
    !this.currentRange ||
    !(
      this.currentViewType === 'timeGridDay' ||
      this.currentViewType === 'resourceTimeGridDay'
    )
  ) {
    return;
  }

  const day = this.currentRange.start; // start==end בתצוגת יום
  if (!day) return;

  if (this.autoAssignLoading) return;
  this.autoAssignLoading = true;

  try {
    const dbc = dbTenant();

    const p_date = String(day).slice(0, 10); // YYYY-MM-DD


    const { data, error } = await dbc.rpc(
      'auto_assign_horses_and_arenas',
      { p_date: day } // טיפוס DATE ב-Postgres
    );

    if (error) throw error;

    // אחרי השיבוץ – לטעון מחדש את השיעורים של היום
    await this.loadLessons({ start: day, end: day });
    this.filterLessons();
    this.setScheduleItems();
    this.buildWeekStats();
    this.cdr.detectChanges();

  await this.ui.alert(
    'שובצו סוסים ומגרשים לשיעורים של היום. ניתן לערוך שיעור-שיעור בממשק המתאים.',
    'הצלחה'
  );
  } catch (e: any) {
    console.error('autoAssignForCurrentDay failed', e);
   await this.ui.alert(
    'שיבוץ סוסים ומגרשים נכשל: ' + (e?.message ?? e),
    'שגיאה'
  );

  } finally {
    this.autoAssignLoading = false;
  }
}

async onToggleMakeupAllowed(checked: boolean) {
  try {
    await ensureTenantContextReady();

    const lessonId = this.occurrence?.lesson_id;
    const occurDate = this.occurrence?.occur_date;

    if (!lessonId || !occurDate) {
      console.warn('❌ Missing lesson_id / occur_date', this.occurrence);
      return;
    }

    const dbc = dbTenant();

    const { error } = await dbc
      .from('lesson_occurrence_exceptions')
      .upsert(
        {
          lesson_id: lessonId,
          occur_date: occurDate,
          status: 'בוטל',                // חייב לפי CHECK
          is_makeup_allowed: checked,
          canceller_role: 'secretary',
          cancelled_at: new Date().toISOString(),
        },
        { onConflict: 'lesson_id,occur_date' }
      );

    if (error) throw error;

    // ✅ עדכון מיידי ב-UI
    this.occurrence = {
      ...this.occurrence,
      is_makeup_allowed: checked,
    };

  } catch (e) {
    console.error('toggle makeup failed', e);
     await this.ui.alert('שגיאה בעדכון "ניתן להשלמה"', 'שגיאה');

  }
}

}

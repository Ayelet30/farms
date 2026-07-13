import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject, ViewChild, signal, computed, HostListener } from '@angular/core'; import { CommonModule } from '@angular/common';
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
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';


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
  imports: [CommonModule, FormsModule, ScheduleComponent, NoteComponent, QuickAppointmentComponent, MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,],
  templateUrl: './secretary-schedule.html',
  styleUrls: ['./secretary-schedule.css'],
})
export class SecretaryScheduleComponent implements OnInit, OnDestroy {
  @ViewChild(ScheduleComponent) scheduleCmp!: ScheduleComponent;
  cancelLessonModal = {
    open: false,
    saving: false,
    error: '',

    lessonId: '',
    occurDate: '',
    childId: '',
    childName: '',
    instructorId: '',
    instructorName: '',
    startTime: '',
    endTime: '',
    lateCancelWarning: '',
    makeupDefaultReason: '',
    note: '',
    isMakeupAllowed: false,
    isBillable: false,
  };
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
  moveChoiceModal = {
    open: false,
    lessonId: '',
    occurDate: '',
    childId: '',
    childName: '',
    instructorId: '',
    instructorName: '',
    startTime: '',
    endTime: '',
    isOpenEnded: false,
  };


  deleteLessonModal = {
    open: false,
    saving: false,
    error: '',
    lessonId: '',
    occurDate: '',
    childName: '',
    instructorName: '',
    lessonType: '',
    isSeries: false,
  };

moveConfirmModal = {
  open: false,
  mode: 'single' as 'single' | 'series',

  childName: '',
  originalDate: '',
  originalTime: '',
  originalInstructor: '',

  newDate: '',
  newStartTime: '',
  newEndTime: '',
  newInstructor: '',

  isPastDate: false,

  slot: null as any | null,
};

  compactScheduleBars = false;

@HostListener('window:scroll')
onWindowScroll(): void {
  this.compactScheduleBars = window.scrollY > 80;
}

  moveSlotsModal = {
    open: false,
    mode: 'single' as 'single' | 'series',
    loading: false,
    saving: false,
    error: '',
    slots: [] as any[],
    selectedSlot: null as any | null,
  };

  moveSlotFilters = {
    instructorId: '',
    dayOfWeek: '',
  };
  moveSearch = {
  fromDate: null as Date | null,
  isPastDate: false,
};
  readonly weekDays = [
    { value: '', label: 'כל הימים' },
    { value: 'ראשון', label: 'ראשון' },
    { value: 'שני', label: 'שני' },
    { value: 'שלישי', label: 'שלישי' },
    { value: 'רביעי', label: 'רביעי' },
    { value: 'חמישי', label: 'חמישי' },
    { value: 'שישי', label: 'שישי' },
    { value: 'שבת', label: 'שבת' },
  ];

  currentRange: { start: string; end: string; viewType: string } | null = null;
  currentViewType:
    | 'timeGridDay'
    | 'timeGridWeek'
    | 'dayGridMonth'
    | 'resourceTimeGridDay'
    | 'resourceTimeGridWeek' = 'timeGridDay';

  autoAssignLoading = false;
  selectedOccurrence: any = null;

  endSeriesModal = {
    open: false,
    lessonId: '',
    occurDate: '',
    childName: '',
    instructorName: '',
    startTime: '',
    saving: false,
  };

  contextMenuMode: ContextMenuMode = 'root';
  blockedDayCells: Array<{
    date: string;
    resourceId: string;
    startTime: string;
    endTime?: string | null;
    reason?: string | null;
    kind?: 'day_off' | 'not_working' | 'farm_off';
  }> = [];

  availableDayCells: Array<{
    date: string;
    resourceId: string;
    startTime: string;
    endTime: string;
    color: string;
    lessonType?: string;
  }> = [];

  instructorWeeklyAvailability: Array<{
    instructor_id_number: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    lesson_ridding_type?: string | null;
    riding_types?: {
      id: string;
      name?: string | null;
      code?: string | null;
    } | null;
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
    endTime: '' as string,
    instructorId: '' as string,
    instructorName: '' as string,

    hasEvent: false,
    eventId: '' as string,
    lessonId: '' as string,
    childId: '' as string,
    childName: '' as string,
    lessonType: '' as string,
    status: '' as string,

    seriesId: '' as string,
    appointmentKind: '' as string,
    repeatWeeks: null as number | null,
    isOpenEnded: null as boolean | null,
    seriesEndDate: '' as string,
    occurDate: '' as string,
    startTimeOnly: '' as string,

    canDeleteLesson: false as boolean,
    deleteBlockedReason: '' as string,
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

  private isRestoringScheduleState = false;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.contextMenu.visible) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('.context-menu')) return;

    this.closeContextMenu();
    this.cdr.detectChanges();
  }

  @HostListener('document:contextmenu', ['$event'])
  onDocumentContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('.context-menu')) return;

    if (this.contextMenu.visible) {
      this.closeContextMenu();
      this.cdr.detectChanges();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseContextMenu(): void {
    if (!this.contextMenu.visible) return;
    this.closeContextMenu();
    this.cdr.detectChanges();
  }

  private router = inject(Router);
  private static didClearStateOnThisPageLoad = false;

  private currentCalendarDate: string | null = null;

  timeOptions: string[] = Array.from({ length: 24 * 4 }, (_, i) => {
    const hours = Math.floor(i / 4).toString().padStart(2, '0');
    const minutes = ((i % 4) * 15).toString().padStart(2, '0');
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
      this.clearScheduleStateOnFreshEntry();

      const { data: ridingTypes } = await dbTenant()
        .from('riding_types')
        .select('id, name, code');

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

 onMoveSearchDateChanged(): void {
  this.moveSlotsModal.error = '';
  this.moveSlotsModal.selectedSlot = null;

  const selectedDate = this.moveSearch.fromDate;

  if (!selectedDate) {
    this.moveSearch.isPastDate = false;
    this.cdr.detectChanges();
    return;
  }

  const selected = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate()
  );

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  this.moveSearch.isPastDate = selected < today;

  if (
    this.moveSlotsModal.mode === 'series' &&
    this.moveSearch.isPastDate
  ) {
    this.moveSlotsModal.error =
      'לא ניתן להעביר סדרה לתאריך שכבר עבר';
  }

  this.cdr.detectChanges();
}

async recalculateMoveSlots(): Promise<void> {
  if (!this.moveSearch.fromDate) {
    this.moveSlotsModal.error = 'יש לבחור תאריך';
    return;
  }

  if (
    this.moveSlotsModal.mode === 'series' &&
    this.moveSearch.isPastDate
  ) {
    this.moveSlotsModal.error =
      'לא ניתן להעביר סדרה לתאריך שכבר עבר';
    return;
  }

  this.moveSlotsModal.error = '';
  this.moveSlotsModal.selectedSlot = null;
  this.moveSlotsPage = 0;

  if (this.moveSlotsModal.mode === 'single') {
    await this.chooseMoveSingleOccurrence();
    return;
  }

  await this.chooseMoveWholeSeries();
}

  private clearScheduleStateOnFreshEntry(): void {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    const isFreshEntry =
      nav?.type === 'reload' ||
      nav?.type === 'navigate';

    const alreadyOpenedInThisTab = sessionStorage.getItem(this.APP_SESSION_KEY) === '1';

    if (isFreshEntry && !alreadyOpenedInThisTab) {
      sessionStorage.removeItem(this.STATE_KEY);
    }

    sessionStorage.setItem(this.APP_SESSION_KEY, '1');
  }


  ngOnDestroy(): void {
    try { this.unsubTenantChange?.(); } catch { }
  }

  private getTodayDow(): number {
    return new Date().getDay();
  }

  private extractYmd(iso: string): string {
    return String(iso).slice(0, 10);
  }

  openEndSeriesModal(): void {
    this.endSeriesModal = {
      open: true,
      lessonId: this.contextMenu.lessonId,
      occurDate: this.contextMenu.occurDate || this.contextMenu.date,
      childName: this.contextMenu.childName,
      instructorName: this.contextMenu.instructorName,
      startTime: this.contextMenu.startTimeOnly || this.contextMenu.time,
      saving: false,
    };

    this.closeContextMenu();
    this.cdr.detectChanges();
  }

  closeEndSeriesModal(): void {
    if (this.endSeriesModal.saving) return;

    this.endSeriesModal = {
      open: false,
      lessonId: '',
      occurDate: '',
      childName: '',
      instructorName: '',
      startTime: '',
      saving: false,
    };

    this.cdr.detectChanges();
  }

  async confirmEndSeries(): Promise<void> {
    if (!this.endSeriesModal.lessonId || !this.endSeriesModal.occurDate) return;

    this.endSeriesModal.saving = true;
    this.cdr.detectChanges();

    try {
      const { error } = await dbTenant().rpc('end_lesson_series', {
        p_lesson_id: this.endSeriesModal.lessonId,
        p_effective_occur_date: this.endSeriesModal.occurDate,
        p_note: null,
      });

      if (error) throw error;

      this.endSeriesModal = {
        open: false,
        lessonId: '',
        occurDate: '',
        childName: '',
        instructorName: '',
        startTime: '',
        saving: false,
      };

      if (this.currentRange) {
        await this.loadLessons({
          start: this.currentRange.start,
          end: this.currentRange.end,
        });

        this.filterLessons();
        this.setScheduleItems();
        this.buildBlockedDayCells(this.currentRange);
        this.buildAvailableDayCells(this.currentRange);
        this.buildWeekStats();
      }

      this.cdr.detectChanges();
    } catch (e) {
      console.error('end series failed', e);
      this.endSeriesModal.saving = false;
      this.cdr.detectChanges();
      await this.ui.alert('שגיאה בסיום הסדרה', 'שגיאה');
    }
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

  private buildAvailableDayCells(range?: { start: string; end: string }): void {
    const available: Array<{
      date: string;
      resourceId: string;
      startTime: string;
      endTime: string;
      color: string;
      lessonType?: string;
    }> = [];

    const from = range?.start?.slice(0, 10) ?? '';
    const to = range?.end?.slice(0, 10) ?? '';

    if (!from || !to) {
      this.availableDayCells = [];
      return;
    }

    const visibleInstructorIds = new Set(
      this.instructorResources.map(r => String(r.id))
    );

    let cur = from;
    let guard = 0;

    const ridingTypeById = new Map(
      this.ridingTypes.map(rt => [
        String(rt.id),
        rt
      ])
    );

    while (cur <= to) {
      const dow = this.dbDowFromYmd(cur);

      for (const row of this.instructorWeeklyAvailability || []) {
        const instructorId = String(row.instructor_id_number);

        if (!visibleInstructorIds.has(instructorId)) continue;
        if (Number(row.day_of_week) !== dow) continue;

        const color =
          this.instructorColorById.get(instructorId) ||
          this.getColorForInstructor(instructorId);

        const ridingType = ridingTypeById.get(String(row.lesson_ridding_type || ''));

        available.push({
          date: cur,
          resourceId: instructorId,
          startTime: String(row.start_time).slice(0, 5),
          endTime: String(row.end_time).slice(0, 5),
          color,
          lessonType: ridingType?.name || ridingType?.code || ''
        });
      }


      const next = this.addOneDayYmdSafe(cur);
      if (next <= cur) break;
      cur = next;

      if (++guard > 400) break;
    }

    this.availableDayCells = available;
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

    this.restorePageState();

    this.isRestoringScheduleState = true;

    await this.loadInstructors();
    await this.loadInstructorWeeklyAvailability();

    if (!this.selectedInstructorIds.length) {
      this.selectedInstructorIds = this.instructors.map(i => String(i.id_number));
    }

    this.rebuildInstructorResources();

    const range = this.currentRange ?? this.ensureInitialDayRange();

    await this.loadLessons(range);

    await this.loadFarmDaysOffForRange(range.start.slice(0, 10), range.end.slice(0, 10));
    await this.loadRequestsForRange(range.start.slice(0, 10), range.end.slice(0, 10));

    this.filterLessons();

    this.setScheduleItems();

    this.buildBlockedDayCells(range);
    this.buildAvailableDayCells(range);
    this.buildWeekStats();

    this.savePageState();

    const restoredRange = this.currentRange
      ? { ...this.currentRange }
      : null;

    const restoredViewType = this.currentViewType;

    setTimeout(() => {
      const view =
        restoredViewType === 'resourceTimeGridDay'
          ? 'timeGridDay'
          : restoredViewType === 'resourceTimeGridWeek'
            ? 'timeGridWeek'
            : restoredViewType;

      const gotoDate =
        this.currentCalendarDate ||
        restoredRange?.start?.slice(0, 10) ||
        null;

      const api: any = this.scheduleCmp as any;

      api?.changeView?.(view);

      setTimeout(() => {
        api?.goToDay?.(gotoDate);

        if (restoredRange) {
          this.currentRange = restoredRange;
        }

        this.currentViewType = restoredViewType as any;
        this.currentCalendarDate = gotoDate;

        this.isRestoringScheduleState = false;
        this.savePageState();
        this.cdr.detectChanges();
      }, 100);
    }, 300);

    this.cdr.detectChanges();
  }

  private readonly APP_SESSION_KEY = 'bereshit-app-opened-v1';
  private readonly STATE_KEY = 'secretary-schedule-state-v1';

  private savePageState(): void {
    const state = {
      selectedInstructorIds: this.selectedInstructorIds,
      selectedChildId: this.selectedChild?.child_uuid ?? null,
      currentRange: this.currentRange,
      currentViewType: this.currentViewType,
      currentCalendarDate: this.currentCalendarDate,
    };

    sessionStorage.setItem(this.STATE_KEY, JSON.stringify(state));
  }

  private restorePageState(): void {
    const raw = sessionStorage.getItem(this.STATE_KEY);

    if (!raw) {
      console.warn('🟠 RESTORE skipped - no saved state');
      return;
    }

    try {
      const state = JSON.parse(raw);

      this.selectedInstructorIds = Array.isArray(state.selectedInstructorIds)
        ? state.selectedInstructorIds
        : [];

      this.currentRange = state.currentRange ?? null;
      this.currentViewType = state.currentViewType ?? 'timeGridDay';
      this.currentCalendarDate = state.currentCalendarDate ?? state.currentRange?.start ?? null;

      if (state.selectedChildId) {
        this.selectedChild =
          this.children.find(c => c.child_uuid === state.selectedChildId) ?? null;
      }
    } catch (err) {
      sessionStorage.removeItem(this.STATE_KEY);
    }
  }

  private ensureInitialDayRange(): { start: string; end: string; viewType: string } {
    if (this.currentRange) return this.currentRange;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;

    this.currentRange = {
      start: ymd,
      end: ymd,
      viewType: 'timeGridDay',
    };

    this.currentViewType = 'timeGridDay';
    return this.currentRange;
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';
  }
  private async loadRequestsForRange(startYmd: string, endYmd: string): Promise<void> {
    const dbc = dbTenant();

    // 1) בקשות ממתינות בלבד
    const { data: pendingRequests, error: pendingError } = await dbc
      .from('secretarial_requests')
      .select(`
      id,
      instructor_id,
      request_type,
      status,
      from_date,
      to_date,
      payload,
      decision_note
    `)
      .eq('request_type', 'INSTRUCTOR_DAY_OFF')
      .eq('status', 'PENDING')
      .lte('from_date', endYmd)
      .gte('to_date', startYmd);

    if (pendingError) throw pendingError;

    const pendingRows = (pendingRequests ?? [])
      .flatMap((row: any) => this.expandRequestRow(row));

    // 2) היעדרויות שאושרו בפועל
    const { data: unavailabilityRows, error: unavailabilityError } = await dbc
      .from('instructor_unavailability')
      .select(`
      id,
      instructor_id_number,
      from_ts,
      to_ts,
      reason,
      all_day,
      category,
      sick_note_file_path
    `)
      .lte('from_ts', `${endYmd}T23:59:59`)
      .gte('to_ts', `${startYmd}T00:00:00`);

    if (unavailabilityError) throw unavailabilityError;

    const approvedRows: DayRequestRow[] = (unavailabilityRows ?? []).map((row: any) => {
      const from = new Date(row.from_ts);
      const to = new Date(row.to_ts);

      return {
        id: row.id,
        instructor_id: String(row.instructor_id_number),
        request_date: String(row.from_ts).slice(0, 10),
        request_type: this.mapUnavailabilityCategory(row.category),
        status: 'approved',
        note: row.reason ?? null,
        all_day: row.all_day === true,
        start_time: row.all_day ? null : from.toTimeString().slice(0, 5),
        end_time: row.all_day ? null : to.toTimeString().slice(0, 5),
        sick_note_file_path: row.sick_note_file_path ?? null,
      };
    });

    this.dayRequests = [...pendingRows, ...approvedRows];
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
        sick_note_file_path: row.payload?.sick_note_file_path ?? null,
      });

      const next = this.addOneDayYmd(current);
      if (next <= current) break;

      current = next;
      if (++guard > 400) break;
    }

    return res;
  }

  private async loadInstructorWeeklyAvailability(): Promise<void> {
    await ensureTenantContextReady();
    const { data, error } = await dbTenant()
      .from('instructor_weekly_availability')
      .select(`
      instructor_id_number,
      day_of_week,
      start_time,
      end_time,
      lesson_ridding_type
    `);

    if (error) {
      console.error('availability load error', error);
      this.instructorWeeklyAvailability = [];
      return;
    }

    this.instructorWeeklyAvailability = data ?? [];
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
    this.contextMenu.endTime = '';
    this.contextMenu.instructorId = String(e.resourceId ?? '');
    this.contextMenu.instructorName = String(e.resourceTitle ?? '');
    this.contextMenu.hasEvent = false;
    this.contextMenu.eventId = '';
    this.contextMenu.lessonId = '';
    this.contextMenu.childId = '';
    this.contextMenu.childName = '';
    this.contextMenu.lessonType = '';
    this.contextMenu.status = '';
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
    const { date, time, endTime, instructorId, instructorName, hasEvent } = this.contextMenu;

    if (!date || !time || !instructorId) {
      this.closeContextMenu();
      return;
    }

    this.quickBooking = {
      open: true,
      date,
      startTime: time,
      endTime: hasEvent && endTime ? endTime : this.addMinutesToHm(time, 60),
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
      this.buildAvailableDayCells(this.currentRange);
      this.buildWeekStats();
      this.cdr.detectChanges();
    }
  }

  closeContextMenu(): void {
    this.contextMenu.visible = false;
    this.contextMenuMode = 'root';
  }

  async openCancelLessonDialog(): Promise<void> {
    const lessonId = this.contextMenu.lessonId;
    const occurDate = this.contextMenu.occurDate || this.contextMenu.date;

    if (!lessonId || !occurDate) {
      this.closeContextMenu();
      return;
    }

    this.cancelLessonModal = {
      open: true,
      saving: false,
      error: '',

      lessonId,
      occurDate,
      childId: this.contextMenu.childId,
      childName: this.contextMenu.childName || 'ללא שם',
      instructorId: this.contextMenu.instructorId,
      instructorName: this.contextMenu.instructorName || 'ללא מדריך',
      startTime: this.contextMenu.startTimeOnly || this.contextMenu.time,
      endTime: this.contextMenu.endTime || '',
      lateCancelWarning: '',
      makeupDefaultReason: '',
      note: '',
      isMakeupAllowed: false,
      isBillable: false,
    };

    this.closeContextMenu();

    await this.loadSecretaryCancelDefaults();

    this.cdr.detectChanges();
  }
  private async loadSecretaryCancelDefaults(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('farm_settings')
      .select(`
      cancel_before_hours,
      max_makeups_in_period,
      makeups_period_days,
      farm_cancel_charge_target
    `)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('load cancel defaults failed', error);
      return;
    }

    let isMakeupAllowedDefault = true;
    let makeupReason = '';

    const childId = this.cancelLessonModal.childId;

    const cancelBeforeHours =
      data?.cancel_before_hours == null
        ? null
        : Number(data.cancel_before_hours);

    const lessonStart = new Date(
      `${this.cancelLessonModal.occurDate}T${this.cancelLessonModal.startTime}:00`
    );

    const diffHours =
      (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60);
    const hoursText =
      cancelBeforeHours === 1
        ? 'שעה'
        : `${cancelBeforeHours} שעות`;
    // אזהרה על ביטול מאוחר
    const isPastLesson = diffHours < 0;


    this.cancelLessonModal.lateCancelWarning =
      isPastLesson
        ? 'לתשומת ליבך, השיעור שבכוונתך לבטל כבר התקיים.'
        : cancelBeforeHours != null &&
          cancelBeforeHours > 0 &&
          diffHours < cancelBeforeHours
          ? `לתשומת ליבך, מועד תחילת השיעור חל בעוד פחות מ־${hoursText}.`
          : '';

    if (isPastLesson) {
      isMakeupAllowedDefault = false;
      makeupReason =
        'ברירת המחדל היא שלא ניתן להשלמה, כי השיעור כבר התקיים.';
    } else if (
      cancelBeforeHours != null &&
      cancelBeforeHours > 0 &&
      diffHours < cancelBeforeHours
    ) {
      isMakeupAllowedDefault = false;
      makeupReason =
        `ברירת המחדל היא שלא ניתן להשלמה, כי הביטול מתבצע פחות מ־${cancelBeforeHours} שעות לפני תחילת השיעור.`;
    }

    // 2. רק אם עבר את בדיקת השעות — בודקים מכסת השלמות בתקופה
    if (isMakeupAllowedDefault) {
      const maxMakeupsInPeriod =
        data?.max_makeups_in_period == null
          ? null
          : Number(data.max_makeups_in_period);

      const makeupsPeriodDays =
        data?.makeups_period_days == null
          ? null
          : Number(data.makeups_period_days);

      if (
        childId &&
        maxMakeupsInPeriod != null &&
        makeupsPeriodDays != null &&
        maxMakeupsInPeriod >= 0 &&
        makeupsPeriodDays > 0
      ) {
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - makeupsPeriodDays);

        const fromDateStr = fromDate.toISOString().slice(0, 10);

        const { count, error: countError } = await dbTenant()
          .from('lessons_occurrences')
          .select('*', { count: 'exact', head: true })
          .eq('child_id', childId)
          .eq('lesson_type', 'השלמה')
          .gte('occur_date', fromDateStr);

        if (countError) {
          console.error('makeup count failed', countError);
        } else {
          const usedMakeups = count ?? 0;

          if (usedMakeups >= maxMakeupsInPeriod) {
            isMakeupAllowedDefault = false;

            makeupReason =
              `ברירת המחדל היא שלא ניתן להשלמה, כי לילד/ה כבר קיימים ${usedMakeups} שיעורי השלמה בתקופה של ${makeupsPeriodDays} ימים. המקסימום המותר הוא ${maxMakeupsInPeriod}.`;
          }
        }
      }
    }

    this.cancelLessonModal.isMakeupAllowed = isMakeupAllowedDefault;
    this.cancelLessonModal.makeupDefaultReason = makeupReason;

    const chargeTarget =
      String(data?.farm_cancel_charge_target || 'makeup_lesson');

    this.cancelLessonModal.isBillable =
      chargeTarget === 'cancelled_lesson';
  }
  closeCancelLessonDialog(): void {
    if (this.cancelLessonModal.saving) return;

    this.cancelLessonModal.open = false;
    this.cancelLessonModal.error = '';
  }

  async confirmCancelLesson(): Promise<void> {
    if (!this.cancelLessonModal.lessonId || !this.cancelLessonModal.occurDate) return;

    this.cancelLessonModal.saving = true;
    this.cancelLessonModal.error = '';
    this.cdr.detectChanges();

    try {
      const authMod = await import('firebase/auth');
      const auth = authMod.getAuth();
      const token = await auth.currentUser?.getIdToken();

      if (!token) throw new Error('לא נמצא טוקן משתמש');

      await ensureTenantContextReady();
      const tenant = requireTenant();

      const resp = await fetch(
        'https://us-central1-bereshit-ac5d8.cloudfunctions.net/secretaryCancelOccurrenceAndNotify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tenantSchema: tenant.schema,
            tenantId: tenant.id,
            lessonId: this.cancelLessonModal.lessonId,
            occurDate: this.cancelLessonModal.occurDate,
            note: this.cancelLessonModal.note?.trim() || null,
            isMakeupAllowed: this.cancelLessonModal.isMakeupAllowed,
            isBillable: this.cancelLessonModal.isBillable,
          }),
        }
      );

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        throw new Error(json?.message || json?.error || 'ביטול השיעור נכשל');
      }
      this.cancelLessonModal.open = false;
      this.cdr.detectChanges();
      this.closeCancelLessonDialog();

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
        this.buildBlockedDayCells(this.currentRange);
        this.buildAvailableDayCells(this.currentRange);
        this.buildWeekStats();
      }

      this.cdr.detectChanges();
    } catch (e: any) {
      console.error('confirmCancelLesson failed', e);
      this.cancelLessonModal.error = e?.message || 'שגיאה בביטול השיעור';
    } finally {
      this.cancelLessonModal.saving = false;
      this.cdr.detectChanges();
    }
  }
  async openRequest(type: RequestType): Promise<void> {
    const date = this.contextMenu.date;
    const instructorId = this.contextMenu.instructorId; // המדריך שעליו לחצת בלוז

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
      instructorId: instructorId || '',
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
      status,
      series_id,
      appointment_kind,
      repeat_weeks,
      is_open_ended,
      series_end_date

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
    let medicalCertificateUrl: string | null = null;

    if (type === 'sick' && this.pendingSickFile) {
      const tempRequestId = crypto.randomUUID();
      medicalCertificateUrl = await this.uploadSickFile(this.pendingSickFile, tempRequestId);
    }
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
        medicalCertificateUrl,
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
  private mapUnavailabilityCategory(x: string | null | undefined): RequestType {
    const val = String(x ?? '').toUpperCase().trim();

    switch (val) {
      case 'HOLIDAY':
        return 'holiday';
      case 'SICK':
        return 'sick';
      case 'PERSONAL':
        return 'personal';
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
    await ensureTenantContextReady();
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
  ridingTypes: { id: string; name: string; code?: string | null }[] = [];

  private async loadInstructors(): Promise<void> {
    await ensureTenantContextReady();
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
      const dow = this.jsDowToDbDow(new Date().getDay());
      const { data: avail, error: e2 } = await dbc
        .from('instructor_weekly_availability')
        .select('instructor_id_number')
        .eq('day_of_week', dow);

      if (e2) throw e2;

      const todayIds = new Set((avail ?? []).map((r: any) => String(r.instructor_id_number)));

      this.instructorsToday = this.instructors.filter(i => todayIds.has(String(i.id_number)));

      // 3) ברירת מחדל לבחירה: רק של היום (או אני אם אני עובד היום)

      // אם אין מדריכים מסומנים — תמיד מציגים זמינים היום
      if (!this.selectedInstructorIds.length) {
        const me = String(this.instructorId || '');

        if (me && this.instructorsToday.some(i => String(i.id_number) === me)) {
          this.selectedInstructorIds = [me];
        } else {
          this.selectedInstructorIds = this.instructorsToday.map(i => String(i.id_number));
        }

        // אם אין מדריכים זמינים היום — fallback לכל הפעילים
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
    this.buildAvailableDayCells(this.currentRange ?? undefined);
    this.buildWeekStats();
    this.savePageState();
  }


  toggleInstructor(id: string) {
    if (this.selectedInstructorIds.includes(id)) {
      this.selectedInstructorIds =
        this.selectedInstructorIds.filter(x => x !== id);
    } else {
      this.selectedInstructorIds = [
        ...this.selectedInstructorIds,
        id
      ];
    }

    this.rebuildInstructorResources();
    this.filterLessons();
    this.setScheduleItems();
    this.buildBlockedDayCells(this.currentRange ?? undefined);
    this.buildAvailableDayCells(this.currentRange ?? undefined);
    this.buildWeekStats();

    this.savePageState(); // להוסיף
  }

  async onViewRange(range: { start: string; end: string; viewType: string }) {
    if (this.isRestoringScheduleState) {
      return;
    }

    this.currentRange = range;
    this.currentViewType = range.viewType as any;

    this.currentCalendarDate = range.start?.slice(0, 10) ?? null;

    await this.loadLessons({ start: range.start, end: range.end });
    await this.loadFarmDaysOffForRange(range.start.slice(0, 10), range.end.slice(0, 10));
    await this.loadRequestsForRange(range.start.slice(0, 10), range.end.slice(0, 10));
    await this.loadInstructorWeeklyAvailability();

    this.filterLessons();
    this.setScheduleItems();
    this.buildBlockedDayCells(range);
    this.buildAvailableDayCells(range);
    this.buildWeekStats();

    if (!this.isRestoringScheduleState) {
      this.savePageState();


    }

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
      const to = range?.end ?? in8Weeks;

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
  series_id,
  appointment_kind,
  repeat_weeks,
  is_open_ended,
  series_end_date
`)

        .in('child_id', childIds)
        .gte('occur_date', from)
        .lte('occur_date', to)
        .order('start_datetime', { ascending: true });

      if (err1) throw err1;

      const lessonIds = [...new Set((occData ?? []).map((r: any) => r.lesson_id).filter(Boolean))];

      const { data: attendanceData, error: attendanceError } = await dbc
        .from('lesson_attendance')
        .select('lesson_id, child_id, occur_date, attendance_status')
        .in('lesson_id', lessonIds);

      if (attendanceError) throw attendanceError;

      const attendanceByKey = new Map<string, string>();

      for (const a of attendanceData ?? []) {
        const key = `${a.lesson_id}::${a.child_id}::${a.occur_date}`;
        attendanceByKey.set(key, String(a.attendance_status || ''));
      }

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
          `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),]));

      this.lessons = (occData ?? []).map((r: any) => {
        const finalStatus = r.status;
        const isMakeupAllowed = r.is_makeup_allowed ?? false;

        const key = `${r.lesson_id}::${r.occur_date}`;
        const res = resourceByKey.get(key);
        const attendanceKey = `${r.lesson_id}::${r.child_id}::${r.occur_date}`;
        const attendanceStatus = attendanceByKey.get(attendanceKey) || '';

        return {
          lesson_id: String(r.lesson_id ?? ''),
          id: String(r.lesson_id ?? ''),
          child_id: r.child_id,
          day_of_week: r.day_of_week,
          start_time: r.start_time,
          end_time: r.end_time,
          lesson_type: r.lesson_type,
          instructor_id: r.instructor_id ?? '',
          instructor_name: instructorNameById.get(r.instructor_id) || '',
          child_color: this.getColorForChild(r.child_id),
          child_name: nameByChild.get(r.child_id) || '',
          start_datetime: r.start_datetime ?? null,
          status: finalStatus,
          end_datetime: r.end_datetime ?? null,
          occur_date: r.occur_date ?? null,
          horse_name: res?.horse_name ?? null,
          arena_name: res?.arena_name ?? null,
          series_id: r.series_id,
          appointment_kind: r.appointment_kind,
          repeat_weeks: r.repeat_weeks,
          is_open_ended: r.is_open_ended,
          series_end_date: r.series_end_date,
          attendance_status: attendanceStatus,
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

        // צבע מלא של המדריך בשיעור תפוס
        color: instructorBorderColor,
        backgroundColor: instructorBorderColor,
        borderColor: instructorBorderColor,
        textColor: '#ffffff',

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

          series_id: lesson.series_id,
          appointment_kind: lesson.appointment_kind,
          repeat_weeks: lesson.repeat_weeks,
          is_open_ended: lesson.is_open_ended,
          series_end_date: lesson.series_end_date,
          attendance_status: lesson.attendance_status ?? '',
        },
      } as any;
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

      this.items = [
        ...this.items,
        ...farmOffItems,
        ...instructorOffItems,
      ];
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
      this.items = [
        ...this.items,
        ...farmOffItems,
        ...instructorOffItems,
      ];
      return;
    }

    // ===== ברירת מחדל =====
    this.items = src.map(makeLessonEvent);
    this.items = [
      ...this.items,
      ...farmOffItems,
      ...instructorOffItems,
    ];
  }


  isCancelledContext(): boolean {
    const status = String(this.contextMenu.status || '').toLowerCase();
    return status.includes('בוטל') || status.includes('cancel');
  }

  isInstructorOffContext(): boolean {
    const type = String(this.contextMenu.lessonType || this.contextMenu.appointmentKind || '').toLowerCase();
    const title = String(this.contextMenu.childName || '').toLowerCase();

    return (
      type.includes('day_off') ||
      type.includes('unavailability') ||
      type.includes('holiday') ||
      title.includes('חופש') ||
      title.includes('מחלה') ||
      title.includes('לא זמין')
    );
  }

  onAttendanceChangedFromNote(
    status: 'present' | 'absent' | null
  ): void {
    if (
      !this.selectedOccurrence?.lesson_id ||
      !this.selectedOccurrence?.occur_date ||
      !this.selectedChild?.child_uuid
    ) {
      return;
    }

    const lessonId = String(this.selectedOccurrence.lesson_id);
    const occurDate = String(
      this.selectedOccurrence.occur_date
    ).slice(0, 10);

    const childId = String(this.selectedChild.child_uuid);

    const normalized =
      status === 'present'
        ? 'present'
        : status === 'absent'
          ? 'absent'
          : null;

    const isSameOccurrence = (obj: any): boolean => {
      const meta = obj?.meta ?? {};

      const objLessonId = String(
        meta.lesson_id ??
        obj?.lesson_id ??
        ''
      );

      const objChildId = String(
        meta.child_id ??
        obj?.child_id ??
        ''
      );

      const objOccurDate = String(
        meta.occur_date ??
        obj?.occur_date ??
        ''
      ).slice(0, 10);

      return (
        objLessonId === lessonId &&
        objChildId === childId &&
        objOccurDate === occurDate
      );
    };

    // עדכון האירוע בלוח
    this.items = this.items.map((item: any) =>
      isSameOccurrence(item)
        ? {
          ...item,
          meta: {
            ...(item.meta ?? {}),
            attendance_status: normalized,
          },
        }
        : item
    );

    // עדכון רשימת השיעורים המקומית
    this.lessons = this.lessons.map((lesson: any) =>
      isSameOccurrence(lesson)
        ? {
          ...lesson,
          attendance_status: normalized,
        }
        : lesson
    ) as any;

    // עדכון הרשימה המסוננת
    this.filteredLessons = this.filteredLessons.map((lesson: any) =>
      isSameOccurrence(lesson)
        ? {
          ...lesson,
          attendance_status: normalized,
        }
        : lesson
    ) as any;

    /*
     * חשוב מאוד:
     * לא ליצור selectedOccurrence חדש,
     * כי זה מפעיל מחדש את ngOnChanges של app-note.
     */
    if (this.selectedOccurrence) {
      this.selectedOccurrence.attendance_status = normalized;
    }

    this.cdr.detectChanges();
  }

  canCancelContextLesson(): boolean {
    return !!this.contextMenu.hasEvent &&
      !!this.contextMenu.lessonId &&
      !this.isCancelledContext() &&
      !this.isInstructorOffContext();
  }

  canMoveContextLesson(): boolean {
    return !!this.contextMenu.hasEvent &&
      !!this.contextMenu.lessonId &&
      !this.isCancelledContext() &&
      !this.isInstructorOffContext();
  }

  canEndContextSeries(): boolean {
    return this.canMoveContextLesson() && this.isSeriesContext();
  }

  private instructorDaysOffToItems(): ScheduleItem[] {
    const selected = new Set(this.selectedInstructorIds.map(String));

    return (this.dayRequests ?? [])
      .filter(r => r.status === 'approved' || r.status === 'pending')
      .filter(r => selected.size === 0 || selected.has(String(r.instructor_id)))
      .map(r => {
        // המשך הקוד שלך כרגיל
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
        : `${d.start_date}T${String(d.start_time).slice(0, 5)}:00`;

      const end = isFullDay
        ? `${String(d.end_date).slice(0, 10)}T23:59:59`
        : `${d.start_date}T${String(d.end_time).slice(0, 5)}:00`;

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

  private addDaysYmd(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);

    return [
      dt.getFullYear(),
      String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0'),
    ].join('-');
  }

  isSeriesContext(): boolean {
    return (
      this.contextMenu.appointmentKind === 'therapy_series' ||
      !!this.contextMenu.seriesId ||
      !!this.contextMenu.isOpenEnded ||
      (this.contextMenu.repeatWeeks ?? 0) > 1
    );
  }

  onRightClickEvent(e: any): void {
    if (!e?.jsEvent) return;

    e.jsEvent.preventDefault();
    e.jsEvent.stopPropagation();

    const dateStr = typeof e.dateStr === 'string' ? e.dateStr : '';
    if (!dateStr) return;

    const localYmd = this.extractYmd(dateStr);
    const localHm = dateStr.includes('T') ? this.extractHm(dateStr) : '';

    let localEndHm = '';
    if (typeof e.endStr === 'string' && e.endStr.includes('T')) {
      localEndHm = this.extractHm(e.endStr);
    }

    const MENU_WIDTH = 220;
    const MENU_HEIGHT = 230;
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
    this.contextMenu.endTime = localEndHm;
    this.contextMenu.instructorId = String(e.resourceId ?? '');
    this.contextMenu.instructorName = String(e.resourceTitle ?? '');
    this.contextMenu.hasEvent = true;
    this.contextMenu.eventId = String(e.eventId ?? '');
    this.contextMenu.lessonId = String(e.lessonId ?? '');
    this.contextMenu.childId = String(e.childId ?? '');
    this.contextMenu.childName = String(e.childName ?? '');
    this.contextMenu.lessonType = String(e.lessonType ?? '');
    this.contextMenu.status = String(e.status ?? '');
    this.contextMenuMode = 'root';
    this.contextMenu.seriesId = String(e.seriesId ?? '');
    this.contextMenu.appointmentKind = String(e.appointmentKind ?? '');
    this.contextMenu.repeatWeeks = e.repeatWeeks != null ? Number(e.repeatWeeks) : null;
    this.contextMenu.isOpenEnded = e.isOpenEnded != null ? !!e.isOpenEnded : null;
    this.contextMenu.seriesEndDate = String(e.seriesEndDate ?? '');
    this.contextMenu.occurDate = String(e.occurDate ?? this.contextMenu.date ?? '');
    this.contextMenu.startTimeOnly = String(e.startTime ?? this.contextMenu.time ?? '');
    this.contextMenu.canDeleteLesson = false;
    this.contextMenu.deleteBlockedReason = '';

    this.checkDeletePermissionForContext();

    this.cdr.detectChanges();
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
      end: arg.event.end
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

  private async checkDeletePermissionForContext(): Promise<void> {
    const lessonId = this.contextMenu.lessonId;
    const occurDate = this.contextMenu.occurDate || this.contextMenu.date;

    this.contextMenu.canDeleteLesson = false;
    this.contextMenu.deleteBlockedReason = '';

    if (!lessonId || !occurDate) {
      this.cdr.detectChanges();
      return;
    }

    try {
      const { data: clicked, error: clickedError } = await dbTenant()
        .from('lessons_occurrences')
        .select(`
        lesson_id,
        child_id,
        occur_date,
        series_id,
        appointment_kind,
        repeat_weeks,
        is_open_ended
      `)
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate)
        .maybeSingle();

      if (clickedError) throw clickedError;

      if (!clicked) {
        this.contextMenu.deleteBlockedReason = 'השיעור לא נמצא';
        return;
      }

      const isSeries =
        !!clicked.series_id ||
        clicked.appointment_kind === 'therapy_series' ||
        clicked.is_open_ended === true ||
        Number(clicked.repeat_weeks || 1) > 1;

      // שיעור חד פעמי: מותר רק אם אין לו נוכחות
      if (!isSeries) {
        const { count, error } = await dbTenant()
          .from('lesson_attendance')
          .select('*', { count: 'exact', head: true })
          .eq('lesson_id', clicked.lesson_id)
          .eq('child_id', clicked.child_id)
          .eq('occur_date', occurDate)
          .in('attendance_status', ['present', 'absent', 'הגיע', 'לא הגיע']);

        if (error) throw error;

        this.contextMenu.canDeleteLesson = (count ?? 0) === 0;
        this.contextMenu.deleteBlockedReason =
          this.contextMenu.canDeleteLesson ? '' : 'כבר נרשמה נוכחות לשיעור';
        return;
      }

      // סדרה: קודם בודקים שזה המופע הראשון
      const q = dbTenant()
        .from('lessons_occurrences')
        .select('lesson_id, child_id, occur_date')
        .order('occur_date', { ascending: true });

      const { data: seriesRows, error: seriesError } = clicked.series_id
        ? await q.eq('series_id', clicked.series_id)
        : await q.eq('lesson_id', clicked.lesson_id).eq('child_id', clicked.child_id);

      if (seriesError) throw seriesError;

      const rows = seriesRows ?? [];
      const firstDate = rows[0]?.occur_date?.slice(0, 10);

      if (!firstDate || firstDate !== occurDate.slice(0, 10)) {
        this.contextMenu.canDeleteLesson = false;
        this.contextMenu.deleteBlockedReason = 'מחיקת סדרה אפשרית רק מהמופע הראשון';
        return;
      }

      // סדרה: אסור אם יש נוכחות באחד השיעורים
      const lessonIds = [...new Set(rows.map((r: { lesson_id: any; }) => r.lesson_id).filter(Boolean))];
      const dates = [...new Set(rows.map((r: { occur_date: any; }) => r.occur_date).filter(Boolean))];

      const { count: attendanceCount, error: attendanceError } = await dbTenant()
        .from('lesson_attendance')
        .select('*', { count: 'exact', head: true })
        .in('lesson_id', lessonIds)
        .in('occur_date', dates)
        .in('attendance_status', ['present', 'absent', 'הגיע', 'לא הגיע']);

      if (attendanceError) throw attendanceError;

      this.contextMenu.canDeleteLesson = (attendanceCount ?? 0) === 0;
      this.contextMenu.deleteBlockedReason =
        this.contextMenu.canDeleteLesson ? '' : 'כבר נרשמה נוכחות באחד משיעורי הסדרה';

    } catch (err) {
      console.error('checkDeletePermissionForContext failed', err);
      this.contextMenu.canDeleteLesson = false;
      this.contextMenu.deleteBlockedReason = 'שגיאה בבדיקת אפשרות מחיקה';
    } finally {
      this.cdr.detectChanges();
    }
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

  private jsDowToDbDow(jsDow: number): number {
    return jsDow;
  }

  private dbDowFromYmd(ymd: string): number {
    const d = new Date(`${ymd}T12:00:00`);
    return this.jsDowToDbDow(d.getDay());
  }

  openMoveChoiceModal(): void {
    this.moveChoiceModal = {
      open: true,
      lessonId: this.contextMenu.lessonId,
      occurDate: this.contextMenu.occurDate || this.contextMenu.date,
      childId: this.contextMenu.childId,
      childName: this.contextMenu.childName,
      instructorId: this.contextMenu.instructorId,
      instructorName: this.contextMenu.instructorName,
      startTime: this.contextMenu.startTimeOnly || this.contextMenu.time,
      endTime: this.contextMenu.endTime || '',
      isOpenEnded: this.contextMenu.isOpenEnded === true,
    };

    this.moveSearch.fromDate = this.ymdToDate(
      this.moveChoiceModal.occurDate
    );

    this.closeContextMenu();
    this.cdr.detectChanges();
  }
  private ymdToDate(ymd: string): Date | null {
    if (!ymd) return null;

    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private dateToYmd(date: Date | null): string {
    if (!date) return '';

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
  }
  private getMoveSearchFromDateYmd(): string {
    return this.dateToYmd(this.moveSearch.fromDate) || this.moveChoiceModal.occurDate;
  }
  closeMoveChoiceModal(): void {
    this.moveChoiceModal = {
      open: false,
      lessonId: '',
      occurDate: '',
      childId: '',
      childName: '',
      instructorId: '',
      instructorName: '',
      startTime: '',
      endTime: '',
      isOpenEnded: false,
    };

    this.cdr.detectChanges();
  }
  async chooseMoveSingleOccurrence(): Promise<void> {
    if (this.moveSlotsModal.loading) return;

    const childId = this.moveChoiceModal.childId;
    const searchFromDate =
      this.getMoveSearchFromDateYmd() ||
      this.moveChoiceModal.occurDate;


    this.moveChoiceModal.open = false;

    this.moveSlotsModal = {
      open: true,
      mode: 'single',
      loading: true,
      saving: false,
      error: '',
      slots: [],
      selectedSlot: null,
    };

    this.moveSlotFilters = {
      instructorId: '',
      dayOfWeek: '',
    };

    this.moveSlotsPage = 0;
    this.cdr.detectChanges();

    try {
      const { data, error } = await dbTenant().rpc(
        'find_makeup_slots_week_to_week',
        {
          p_child_id: childId,
          p_instructor_id: null,
          p_lesson_date: searchFromDate,
        }
      );

      if (error) throw error;

      this.moveSlotsModal.slots = (data ?? [])
        .filter((s: any) => {
          const slotDate = String(
            s.occur_date || s.lesson_date || ''
          ).slice(0, 10);

          // לא מציגים שום תוצאה לפני התאריך שנבחר
          if (!slotDate || slotDate < searchFromDate) {
            return false;
          }

          const slotStart = String(
            s.start_time || s.start || ''
          ).slice(0, 5);

          const slotInstructor = String(
            s.instructor_id ||
            s.instructor_id_number ||
            ''
          );

          const sameDate =
            slotDate ===
            String(this.moveChoiceModal.occurDate).slice(0, 10);

          const sameStart =
            slotStart ===
            String(this.moveChoiceModal.startTime).slice(0, 5);

          const sameInstructor =
            slotInstructor ===
            String(this.moveChoiceModal.instructorId);

          return !(sameDate && sameStart && sameInstructor);
        })
        .sort((a: any, b: any) => {
          const dateA = String(a.occur_date || a.lesson_date || '');
          const dateB = String(b.occur_date || b.lesson_date || '');

          const dateCompare = dateA.localeCompare(dateB);
          if (dateCompare !== 0) return dateCompare;

          return String(a.start_time || a.start || '')
            .localeCompare(String(b.start_time || b.start || ''));
        })
        .slice(0, 10);

      if (!this.moveSlotsModal.slots.length) {
        this.moveSlotsModal.error =
          'לא נמצאו אפשרויות פנויות החל מהתאריך שנבחר.';
      }
    } catch (e: any) {
      console.error('load single move slots failed', e);

      this.moveSlotsModal.error =
        e?.message || 'שגיאה בטעינת אפשרויות להזזת שיעור';
    } finally {
      this.moveSlotsModal.loading = false;
      this.cdr.detectChanges();
    }
  }

  selectMoveSlot(slot: any): void {
    this.moveSlotsModal.selectedSlot = slot;
  }

  private isYmdBeforeToday(ymd: string): boolean {
  if (!ymd) return false;

  const [year, month, day] = ymd.split('-').map(Number);
  const selected = new Date(year, month - 1, day);

  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  return selected < today;
}

  confirmMove(): void {
  const slot = this.moveSlotsModal.selectedSlot;
  if (!slot) return;

  const date = String(
    slot.occur_date ||
    slot.lesson_date ||
    ''
  ).slice(0, 10);

  const start = String(
    slot.start_time ||
    slot.start ||
    ''
  ).slice(0, 5);

  const end = String(
    slot.end_time ||
    slot.end ||
    ''
  ).slice(0, 5);

  const instructorId = String(
    slot.instructor_id ||
    slot.instructor_id_number ||
    ''
  );

  if (!date || !start || !end || !instructorId) {
    this.moveSlotsModal.error =
      'חסרים פרטים באפשרות שנבחרה';

    return;
  }

  if (
    this.moveSlotsModal.mode === 'series' &&
    this.isYmdBeforeToday(date)
  ) {
    this.moveSlotsModal.error =
      'לא ניתן להעביר סדרה לתאריך שכבר עבר';

    this.moveSlotsModal.selectedSlot = null;
    this.cdr.detectChanges();
    return;
  }

  this.moveConfirmModal = {
    open: true,
    mode: this.moveSlotsModal.mode,

    childName:
      this.moveChoiceModal.childName,

    /*
     * כאן מציגים למשתמש את המיקום הנוכחי
     * של השיעור, גם אם הוא כבר הוזז בעבר.
     */
    originalDate:
      this.moveChoiceModal.occurDate,

    originalTime:
      `${this.moveChoiceModal.startTime}` +
      `${this.moveChoiceModal.endTime
        ? `–${this.moveChoiceModal.endTime}`
        : ''
      }`,

    originalInstructor:
      this.moveChoiceModal.instructorName,

    newDate:
      date,

    newStartTime:
      start,

    newEndTime:
      end,

    newInstructor:
      slot.instructor_name ||
      slot.instructorName ||
      instructorId,

    isPastDate:
      this.isYmdBeforeToday(date),

    slot,
  };

  this.cdr.detectChanges();
}

private buildLocalDateTime(
  ymd: string,
  hm: string
): string {
  const normalizedDate = String(ymd || '').slice(0, 10);
  const normalizedTime = String(hm || '').slice(0, 5);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) ||
    !/^\d{2}:\d{2}$/.test(normalizedTime)
  ) {
    throw new Error('תאריך או שעה אינם תקינים');
  }

  /*
   * אין כאן Date ואין toISOString.
   * השעה נשלחת בדיוק כפי שנבחרה.
   */
  return `${normalizedDate}T${normalizedTime}:00`;
}

  closeMoveConfirmModal(): void {
    this.moveConfirmModal.open = false;
    this.cdr.detectChanges();
  }

  async approveMoveConfirm(): Promise<void> {
  if (this.moveSlotsModal.saving) return;

  const slot =
    this.moveConfirmModal.slot ||
    this.moveSlotsModal.selectedSlot;

  if (!slot) {
    console.error(
      'No slot found for move approval',
      {
        moveConfirmModal: this.moveConfirmModal,
        moveSlotsModal: this.moveSlotsModal,
      }
    );

    await this.ui.alert(
      'לא נמצא סלוט להזזה. בחרי שוב אפשרות מהרשימה.',
      'שגיאה'
    );

    return;
  }

  await this.executeMove(slot);
}

  async executeMove(slot: any): Promise<void> {
  if (this.moveSlotsModal.saving) return;

  this.moveSlotsModal.saving = true;
  this.moveSlotsModal.error = '';
  this.cdr.detectChanges();

  try {
    const targetDate = String(
      slot?.occur_date ||
      slot?.lesson_date ||
      ''
    ).slice(0, 10);

    const start = String(
      slot?.start_time ||
      slot?.start ||
      ''
    ).slice(0, 5);

    const end = String(
      slot?.end_time ||
      slot?.end ||
      ''
    ).slice(0, 5);

    const newInstructorId = String(
      slot?.instructor_id ||
      slot?.instructor_id_number ||
      ''
    );

    if (!targetDate) {
      throw new Error('לא נמצא תאריך יעד');
    }

    if (!start || !end) {
      throw new Error('לא נמצאו שעות היעד');
    }

    if (!newInstructorId) {
      throw new Error('לא נמצא מדריך יעד');
    }

    if (start >= end) {
      throw new Error(
        'שעת הסיום חייבת להיות אחרי שעת ההתחלה'
      );
    }

    /*
     * סדרה אינה יכולה לעבור לתאריך עבר.
     */
    if (
      this.moveSlotsModal.mode === 'series' &&
      this.isYmdBeforeToday(targetDate)
    ) {
      throw new Error(
        'לא ניתן להעביר סדרה לתאריך שכבר עבר'
      );
    }

    if (this.moveSlotsModal.mode === 'single') {
  const date = String(
    slot.occur_date ||
    slot.lesson_date ||
    ''
  ).slice(0, 10);

  const start = String(
    slot.start_time ||
    slot.start ||
    ''
  ).slice(0, 5);

  const end = String(
    slot.end_time ||
    slot.end ||
    ''
  ).slice(0, 5);

  const newInstructorId = String(
    slot.instructor_id ||
    slot.instructor_id_number ||
    ''
  );

  if (!date || !start || !end) {
    throw new Error('חסרים תאריך או שעות יעד');
  }

  if (!newInstructorId) {
    throw new Error('לא נמצא מדריך יעד');
  }

  const newStartDatetime =
    this.buildLocalDateTime(date, start);

  const newEndDatetime =
    this.buildLocalDateTime(date, end);

  console.log('move datetime values', {
    selectedDate: date,
    selectedStart: start,
    selectedEnd: end,
    sentStart: newStartDatetime,
    sentEnd: newEndDatetime,
  });

  const { data, error } = await dbTenant().rpc(
    'move_lesson_occurrence',
    {
      p_lesson_id:
        this.moveChoiceModal.lessonId,

      p_occur_date:
        this.moveChoiceModal.occurDate,

      p_new_instructor_id:
        newInstructorId,

      p_new_start_datetime:
        newStartDatetime,

      p_new_end_datetime:
        newEndDatetime,

      p_note: null,
      p_created_by_role: 'secretary',
      p_created_by_uid: null,
    }
  );

  if (error) throw error;

  console.log('move result', data);
}

    if (this.moveSlotsModal.mode === 'series') {
      const { data, error } = await dbTenant().rpc(
        'move_lesson_series',
        {
          p_lesson_id:
            this.moveChoiceModal.lessonId,

          /*
           * זה התאריך שממנו מפצלים את הסדרה הישנה.
           */
          p_effective_occur_date:
            this.moveChoiceModal.occurDate,

          /*
           * אם כבר הוספת את הפרמטר החדש ל-RPC
           * של הסדרה, השאירי אותו.
           */
          p_new_first_occur_date:
            targetDate,

          p_new_instructor_id:
            newInstructorId,

          p_new_day_of_week:
            this.dayNameFromYmd(targetDate),

          p_new_start_time:
            start,

          p_new_end_time:
            end,
        }
      );

      if (error) throw error;

      if (data?.ok === false) {
        throw new Error(
          data?.message ||
          'הזזת הסדרה נכשלה'
        );
      }
    }

    /*
     * סגירת החלונות רק אחרי הצלחה.
     */
    this.moveConfirmModal.open = false;
    this.moveSlotsModal.open = false;
    this.moveSlotsModal.selectedSlot = null;
    this.moveConfirmModal.slot = null;

    /*
     * טעינה מחדש של הטווח הנוכחי.
     */
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
      this.buildBlockedDayCells(this.currentRange);
      this.buildAvailableDayCells(this.currentRange);
      this.buildWeekStats();
    }

    await this.ui.alert(
      this.moveSlotsModal.mode === 'series'
        ? 'הסדרה הוזזה בהצלחה'
        : 'השיעור הוזז בהצלחה',
      'בוצע'
    );
  } catch (e: any) {
    console.error('move failed', e);

    const message =
      e?.message ||
      e?.details ||
      e?.hint ||
      'שגיאה בהזזת השיעור';

    this.moveSlotsModal.error = message;

    await this.ui.alert(
      message,
      'שגיאה'
    );
  } finally {
    this.moveSlotsModal.saving = false;
    this.cdr.detectChanges();
  }
}


  private dayNameFromYmd(ymd: string): string {
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const [y, m, d] = ymd.split('-').map(Number);
    return days[new Date(y, m - 1, d).getDay()];
  }
  private getHebrewDayNameFromDate(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    return days[d.getDay()];
  }

  async chooseMoveWholeSeries(): Promise<void> {
    if (this.moveSlotsModal.loading) return;

    const childId = this.moveChoiceModal.childId;
    const lessonId = this.moveChoiceModal.lessonId;
    const effectiveDate = this.moveChoiceModal.occurDate;

    if (!childId || !lessonId || !effectiveDate) {
      await this.ui.alert(
        'לא נמצאו פרטי הסדרה או הילד. יש לסגור ולנסות שוב.',
        'שגיאה'
      );
      return;
    }

    this.moveChoiceModal.open = false;

    this.moveSlotsModal = {
      open: true,
      mode: 'series',
      loading: true,
      saving: false,
      error: '',
      slots: [],
      selectedSlot: null,
    };

    this.moveSlotFilters = {
      instructorId: '',
      dayOfWeek: '',
    };

    this.moveSlotsPage = 0;
    this.cdr.detectChanges();

    try {
      const from =
        this.getMoveSearchFromDateYmd() ||
        effectiveDate;

      // טווח החיפוש רחב, אך יוצגו רק 10 מועמדים
      const to = this.addDaysYmd(from, 10);

      /*
       * אנחנו מחפשים מועדים מועמדים להתחלת הסדרה.
       * האימות המלא של כל הסדרה יתבצע בזמן move_lesson_series.
       *
       * שימוש בכל מספר השיעורים שנותרו יחד עם חלון מוגבל
       * גורם לכך שכמעט תמיד חוזרות אפס תוצאות.
       */
      const lessonCountForSearch = 1;

      const payload = {
        p_child_id: childId,
        p_lesson_count: lessonCountForSearch,
        p_instructor_id_number: null,
        p_from_date: from,
        p_to_date: to,
      };



      const { data, error } = await dbTenant().rpc(
        'find_series_slots_with_skips',
        payload
      );



      if (error) throw error;

      this.moveSlotsModal.slots = (data ?? [])
        .map((s: any) => {
          const instructorId = String(
            s.instructor_id ||
            s.instructor_id_number ||
            ''
          );

          const inst = this.instructors.find(
            i => String(i.id_number) === instructorId
          );

          const occurDate =
            s.lesson_date ||
            s.occur_date ||
            '';

          return {
            occur_date: occurDate,
            lesson_date: occurDate,
            start_time: String(
              s.start_time || s.start || ''
            ).slice(0, 5),
            end_time: String(
              s.end_time || s.end || ''
            ).slice(0, 5),
            instructor_id: instructorId,
            instructor_name: inst
              ? `${inst.first_name ?? ''} ${inst.last_name ?? ''}`.trim()
              : instructorId,
            day_of_week:
              s.day_of_week ||
              this.getHebrewDayNameFromDate(occurDate),
            lesson_ridding_type:
              s.riding_type_id ?? null,
            riding_type_name:
              s.riding_type_name ?? null,
            remaining_capacity:
              s.remaining_capacity ?? 1,
            raw: s,
          };
        })
        .filter((s: any) => {
          if (
            !s.occur_date ||
            !s.start_time ||
            !s.instructor_id
          ) {
            return false;
          }

          const sameDate =
            String(s.occur_date).slice(0, 10) ===
            String(effectiveDate).slice(0, 10);

          const sameStart =
            String(s.start_time).slice(0, 5) ===
            String(this.moveChoiceModal.startTime).slice(0, 5);

          const sameInstructor =
            String(s.instructor_id) ===
            String(this.moveChoiceModal.instructorId);

          return !(sameDate && sameStart && sameInstructor);
        })
        .sort((a: any, b: any) => {
          const dateCompare =
            String(a.occur_date).localeCompare(
              String(b.occur_date)
            );

          if (dateCompare !== 0) return dateCompare;

          return String(a.start_time).localeCompare(
            String(b.start_time)
          );
        })
        .slice(0, 10);

      if (!this.moveSlotsModal.slots.length) {
        this.moveSlotsModal.error =
          `לא נמצאו אפשרויות פנויות בין ${from} ל־${to}.`;
      }
    } catch (e: any) {
      console.error('load series move slots failed', e);

      this.moveSlotsModal.error =
        e?.message ||
        'שגיאה בטעינת אפשרויות להזזת סדרה';
    } finally {
      this.moveSlotsModal.loading = false;
      this.cdr.detectChanges();
    }
  }

  async confirmMoveSelectedSlot(): Promise<void> {
    const slot = this.moveSlotsModal.selectedSlot;
    if (!slot) return;

    if (this.moveSlotsModal.mode === 'single') {
      //await this.confirmMoveSingle(slot);
      return;
    }

    
  }

  moveSlotsPage = 0;
  moveSlotsPageSize = 4;

  get filteredMoveSlots(): any[] {
    return (this.moveSlotsModal.slots || []).filter((slot: any) => {
      const slotInstructorId = String(
        slot.instructor_id ||
        slot.instructor_id_number ||
        ''
      );

      const slotDate = slot.occur_date || slot.lesson_date || '';
      const slotDay =
        slot.day_of_week ||
        this.getHebrewDayNameFromDate(slotDate);

      const byInstructor =
        !this.moveSlotFilters.instructorId ||
        slotInstructorId === String(this.moveSlotFilters.instructorId);

      const byDay =
        !this.moveSlotFilters.dayOfWeek ||
        slotDay === this.moveSlotFilters.dayOfWeek;

      return byInstructor && byDay;
    });
  }

  get pagedMoveSlots(): any[] {
    const start = this.moveSlotsPage * this.moveSlotsPageSize;
    return this.filteredMoveSlots.slice(start, start + this.moveSlotsPageSize);
  }

  get moveSlotsTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMoveSlots.length / this.moveSlotsPageSize));
  }

  get canPrevMoveSlots(): boolean {
    return this.moveSlotsPage > 0;
  }

  get canNextMoveSlots(): boolean {
    return this.moveSlotsPage < this.moveSlotsTotalPages - 1;
  }

  onMoveSlotFiltersChanged(): void {
    this.moveSlotsPage = 0;
    this.moveSlotsModal.selectedSlot = null;
  }

  prevMoveSlotsPage(): void {
    if (!this.canPrevMoveSlots) return;
    this.moveSlotsPage--;
  }

  nextMoveSlotsPage(): void {
    if (!this.canNextMoveSlots) return;
    this.moveSlotsPage++;
  }
  formatCancelDate(value: string): string {
    if (!value) return '';

    const [year, month, day] = value.slice(0, 10).split('-');
    if (!year || !month || !day) return value;

    return `${day}/${month}/${year.slice(2)}`;
  }

  formatCancelTimeRange(start: string, end: string): string {
    const s = String(start || '').slice(0, 5);
    const e = String(end || '').slice(0, 5);

    if (!s && !e) return '';
    if (s && !e) return s;
    if (!s && e) return e;

    return `${s}-${e}`;
  }

  openDeleteLessonModal(): void {
    this.deleteLessonModal = {
      open: true,
      saving: false,
      error: '',
      lessonId: this.contextMenu.lessonId,
      occurDate: this.contextMenu.occurDate || this.contextMenu.date,
      childName: this.contextMenu.childName || 'ללא שם',
      instructorName: this.contextMenu.instructorName || 'ללא מדריך',
      lessonType: this.contextMenu.lessonType || '',
      isSeries: this.isSeriesContext(),
    };

    this.closeContextMenu();
    this.cdr.detectChanges();
  }

  closeDeleteLessonModal(): void {
    if (this.deleteLessonModal.saving) return;
    this.deleteLessonModal.open = false;
    this.deleteLessonModal.error = '';
  }

  async confirmDeleteLesson(): Promise<void> {
    if (!this.deleteLessonModal.lessonId || !this.deleteLessonModal.occurDate) return;

    this.deleteLessonModal.saving = true;
    this.deleteLessonModal.error = '';
    this.cdr.detectChanges();

    try {
      const { data, error } = await dbTenant().rpc('delete_lesson_or_series', {
        p_lesson_id: this.deleteLessonModal.lessonId,
        p_occur_date: this.deleteLessonModal.occurDate,
      });

      if (error) throw error;

      const res = Array.isArray(data) ? data[0] : data;

      if (res?.ok !== true) {
        this.deleteLessonModal.error = res?.message || 'לא ניתן למחוק';
        return;
      }

      this.deleteLessonModal.open = false;

      if (this.currentRange) {
        await this.loadLessons({
          start: this.currentRange.start,
          end: this.currentRange.end,
        });

        this.filterLessons();
        this.setScheduleItems();
        this.buildBlockedDayCells(this.currentRange);
        this.buildAvailableDayCells(this.currentRange);
        this.buildWeekStats();
      }
    } catch (e: any) {
      console.error('delete lesson failed', e);
      this.deleteLessonModal.error = e?.message || 'שגיאה במחיקה';
    } finally {
      this.deleteLessonModal.saving = false;
      this.cdr.detectChanges();
    }
  }

  private canDeleteLessonFromContext(): boolean {
    const lessonId = this.contextMenu.lessonId;
    const occurDate = this.contextMenu.occurDate || this.contextMenu.date;

    if (!lessonId || !occurDate) return false;

    const lesson: any =
      this.lessons.find((l: any) =>
        String(l.lesson_id || l.id) === String(lessonId) &&
        String(l.occur_date || '').slice(0, 10) === String(occurDate).slice(0, 10)
      );

    if (!lesson) return true; // ה-RPC עדיין יבדוק סופית

    const attendance = String(lesson.attendance_status || '').trim();

    const hasAttendance =
      attendance === 'present' ||
      attendance === 'absent' ||
      attendance === 'הגיע' ||
      attendance === 'לא הגיע';

    if (hasAttendance) return false;

    const isSeries =
      String(lesson.appointment_kind || this.contextMenu.appointmentKind || '') === 'therapy_series' &&
      (
        lesson.is_open_ended === true ||
        this.contextMenu.isOpenEnded === true ||
        Number(lesson.repeat_weeks || this.contextMenu.repeatWeeks || 1) > 1 ||
        ['רגיל', 'סידרה'].includes(String(lesson.lesson_type || this.contextMenu.lessonType || ''))
      );

    if (!isSeries) return true;

    const firstDate =
      lesson.first_occur_date ||
      lesson.series_first_occur_date ||
      lesson.anchor_occur_date;

    if (firstDate) {
      return String(firstDate).slice(0, 10) === String(occurDate).slice(0, 10);
    }

    // אם אין firstDate באובייקט — עדיף לא להציג, כדי לא לתת פעולה שאולי תיחסם
    return false;
  }
  private async getRemainingSeriesLessonsCountForMove(
    lessonId: string,
    fromOccurDate: string
  ): Promise<number> {
    const { data, error } = await dbTenant().rpc(
      'count_remaining_series_lessons_for_move',
      {
        p_lesson_id: lessonId,
        p_from_date: fromOccurDate,
      }
    );

    if (error) {
      console.error('count remaining series failed', error);
      return 1;
    }

    return Number(data || 1);
  }
}

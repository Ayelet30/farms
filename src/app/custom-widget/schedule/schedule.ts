import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  OnChanges,
  SimpleChanges,
  ViewEncapsulation,
  AfterViewInit,
  OnDestroy,
  HostListener,
  ChangeDetectorRef,
  NgZone,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import {
  CalendarOptions,
  EventClickArg,
  DatesSetArg,
  EventInput,
} from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';

import { ScheduleItem } from '../../models/schedule-item.model';

type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

type ScheduleResource = {
  id: string;
  title: string;
};

interface CustomDaySlot {
  label: string;
  iso: string;
  minutes: number;
}

interface CustomDayCluster {
  key: string;
  col: number;
  row: number;
  span: number;
  items: ScheduleItem[];
}

interface BlockedDayCell {
  date: string;              // YYYY-MM-DD
  resourceId: string;        // instructor_id
  startTime: string;         // HH:mm
  endTime?: string | null;   // HH:mm
  reason?: string | null;
  kind?: 'day_off' | 'not_working' | 'farm_off';
}

interface CustomDayBlockedCell {
  key: string;
  col: number;
  row: number;
  span: number;
  reason?: string | null;
  kind?: 'day_off' | 'not_working' | 'farm_off';
}

type ViewerMode = 'manager' | 'secretary' | 'instructor' | 'parent';



@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class ScheduleComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('calendar') calendarComponent?: FullCalendarComponent;
  @ViewChild('calendarHost', { static: false }) calendarHost?: ElementRef<HTMLElement>;

  private boundContextMenuHandler?: (e: MouseEvent) => void;

  private lessonsLoadRequestId = 0;

  @Input() items: ScheduleItem[] = [];
  @Input() initialView: ViewName = 'timeGridDay';
  @Input() rtl = true;
  @Input() locale: any = heLocale;
  @Input() slotMinTime = '07:00:00';
  @Input() slotMaxTime = '21:00:00';
  @Input() allDaySlot = false;
  @Input() resources: any[] = [];
  @Input() showToolbar = true;
  @Input() enableAutoAssign = false;
  @Input() viewerMode: ViewerMode = 'secretary';
  @Input() blockedDayCells: BlockedDayCell[] = [];
  @Input() reloadLoading = false;
  @Input() availableDayCells: Array<{
    date: string;
    resourceId: string;
    startTime: string;
    endTime: string;
    color: string;
    lessonType?: string;
  }> = [];


  @Output() autoAssignRequested = new EventEmitter<void>();
  @Output() eventClick = new EventEmitter<EventClickArg>();
  @Output() dateClick = new EventEmitter<DateClickArg>();
  @Output() viewRange = new EventEmitter<{
    start: string;
    end: string;
    viewType: string;
  }>();
  @Output() rightClickDay = new EventEmitter<{
    jsEvent: MouseEvent;
    dateStr: string;
    resourceId?: string | null;
    resourceTitle?: string | null;
    sourceView?: 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';
  }>();

  @Output() reloadRequested = new EventEmitter<{
  start: string;
  end: string;
  viewType: ViewName;
}>();

  @Output() rightClickEvent = new EventEmitter<{
    jsEvent: MouseEvent;
    dateStr: string;
    endStr?: string | null;
    resourceId?: string | null;
    resourceTitle?: string | null;
    sourceView?: 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';
    eventId?: string | null;
    lessonId?: string | null;
    childId?: string | null;
    childName?: string | null;
    lessonType?: string | null;
    status?: string | null;
    seriesId?: string | null;
    appointmentKind?: string | null;
    repeatWeeks?: number | null;
    isOpenEnded?: boolean | null;
    seriesEndDate?: string | null;
    occurDate?: string | null;
    startTime?: string | null;
    endTimeOnly?: string | null;
  }>();

  customDayBlockedCells: CustomDayBlockedCell[] = [];

  currentView: ViewName = this.initialView;
  currentDate = '';
  isFullscreen = false;

  showDayResourceInfo = true;

  customDayDate = new Date();
  customDayResources: ScheduleResource[] = [];
  customDaySlots: CustomDaySlot[] = [];
  customDayClusters: CustomDayCluster[] = [];

  private isNarrow600 = window.innerWidth < 600;

  @HostListener('window:resize')

  

  onResize() {
    const next = window.innerWidth < 600;
    if (next === this.isNarrow600) return;
    this.isNarrow600 = next;

    const api = this.calendarApi;
    if (api) {
      api.setOption('dayHeaderContent', this.dayHeaderContentFactory());
    }
  }

  private lastRangeKey = '';

  readonly monthLegend = [
    { className: 'legend-approved', label: 'שיעורים פעילים' },
    { className: 'legend-canceled', label: 'שיעורים מבוטלים' },
    { className: 'legend-pending', label: 'בקשות / ממתינים' },
    { className: 'legend-farm-off', label: 'חופשת חווה' },
    { className: 'legend-instructor-off', label: 'חופשת מדריך' },
  ];


  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    changeDetection: ChangeDetectionStrategy.OnPush
  }
  get legendItems() {
    if (this.viewerMode === 'parent') {
      return this.monthLegend.filter(
        x => x.className !== 'legend-instructor-off'
      );
    }

    return this.monthLegend;
  }
  get calendarApi() {
    return this.calendarComponent?.getApi();
  }

  get shouldSplitDayByInstructor(): boolean {
    return this.viewerMode === 'manager' || this.viewerMode === 'secretary';
  }

  get isParentView(): boolean {
    return this.viewerMode === 'parent';
  }

  get isInstructorView(): boolean {
    return this.viewerMode === 'instructor';
  }

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  private toYmd(date: Date): string {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
  }

  private cloneDate(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private parseTimeToMinutes(time: string): number {
    const safe = String(time || '00:00').slice(0, 5);
    const [hh, mm] = safe.split(':').map(Number);
    return (hh || 0) * 60 + (mm || 0);
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${this.pad(h)}:${this.pad(m)}`;
  }

  private swipeStartX = 0;
  private swipeStartY = 0;

  onSwipeStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    this.swipeStartX = touch.clientX;
    this.swipeStartY = touch.clientY;
  }

  onSwipeEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0];

    const deltaX = touch.clientX - this.swipeStartX;
    const deltaY = touch.clientY - this.swipeStartY;

    const minSwipe = 60;
    const maxVerticalMove = 45;

    if (Math.abs(deltaX) < minSwipe) return;
    if (Math.abs(deltaY) > maxVerticalMove) return;

    // RTL:
    // גרירה שמאלה = הבא
    // גרירה ימינה = הקודם
    if (deltaX < 0) {
      this.next();
    } else {
      this.prev();
    }
  }

  reloadCurrentView(): void {
  let start: string;
  let end: string;

  if (this.currentView === 'timeGridDay') {
    const ymd = this.toYmd(this.customDayDate);

    start = ymd;
    end = ymd;
  } else {
    const api = this.calendarApi;

    if (!api) return;

    start = this.toYmd(api.view.activeStart);

    /*
     * activeEnd ב־FullCalendar הוא תאריך סיום לא כולל,
     * לכן מורידים יום אחד.
     */
    const inclusiveEnd = new Date(api.view.activeEnd);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);

    end = this.toYmd(inclusiveEnd);
  }

  this.reloadRequested.emit({
    start,
    end,
    viewType: this.currentView,
  });
}

  private isoToMinutes(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }

  private normalizeFcDate(value: string | Date): string | Date {
    if (value instanceof Date) return value;
    return String(value);
  }

  private nowScroll(): string {
    const d = new Date();
    return `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:00`;
  }

  private isToday(d: Date) {
    const t = new Date();
    return (
      d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate()
    );
  }

  private toHm(value: string | null | undefined): string {
    return String(value || '').slice(0, 5);
  }

  private getSlotStepMinutes(): number {
    return 30;
  }

  isBlockedRawCell(resourceId: string, slotIso: string): boolean {
    const d = new Date(slotIso);
    const ymd = this.toYmd(d);
    const hm = this.minutesToTime(d.getHours() * 60 + d.getMinutes());

    return (this.blockedDayCells || []).some(b => {
      if (String(b.resourceId) !== String(resourceId)) return false;
      if (b.date !== ymd) return false;

      const bStart = this.toHm(b.startTime);
      const bEnd = this.toHm(
        b.endTime || this.minutesToTime(this.parseTimeToMinutes(bStart) + this.getSlotStepMinutes())
      );

      return hm >= bStart && hm < bEnd;
    });
  }

  getBlockedReason(resourceId: string, slotIso: string): string {
    const d = new Date(slotIso);
    const ymd = this.toYmd(d);
    const hm = this.minutesToTime(d.getHours() * 60 + d.getMinutes());

    const match = (this.blockedDayCells || []).find(b => {
      if (String(b.resourceId) !== String(resourceId)) return false;
      if (b.date !== ymd) return false;

      const bStart = this.toHm(b.startTime);
      const bEnd = this.toHm(
        b.endTime || this.minutesToTime(this.parseTimeToMinutes(bStart) + this.getSlotStepMinutes())
      );

      return hm >= bStart && hm < bEnd;
    });

    return match?.reason || '';
  }

  private formatHebrewDayTitle(date: Date): string {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  private getItemChildAge(item: ScheduleItem): string {
    const age =
      this.getItemMeta(item)?.child_age ??
      this.getItemMeta(item)?.age ??
      '';
    return String(age || '');
  }

  getCustomDayPrimaryText(item: ScheduleItem): string {
    const childName = this.getItemChildName(item);
    const instructorName = this.getItemInstructorName(item);
    const age = this.getItemChildAge(item);

    if (this.isParentView) {
      return [childName, instructorName].filter(Boolean).join(' • ');
    }

    if (this.isInstructorView) {
      return age ? `${childName} (${age})` : childName;
    }

    return childName;
  }

  getCustomDaySecondaryText(item: ScheduleItem): string {
    const horse = this.getHorseName(item);
    const arena = this.getArenaName(item);

    if (this.isInstructorView) {
      return [horse, arena].filter(Boolean).join(' • ');
    }

    return '';
  }

  buildCustomItemTitle(item: ScheduleItem): string {
    const parts: string[] = [];

    if (this.isParentView) {
      parts.push(
        this.getItemChildName(item),
        this.getItemInstructorName(item),
        this.getItemLessonType(item)
      );
    } else if (this.isInstructorView) {
      parts.push(
        this.getItemChildName(item),

        this.getItemChildAge(item)
          ? `גיל: ${this.getItemChildAge(item)}`
          : '',

        this.getHorseName(item),
        this.getArenaName(item)
      );
    } else {
      parts.push(
        this.getItemChildName(item),
        this.getItemLessonType(item),
        this.getHorseName(item),
        this.getArenaName(item)
      );
    }

    if (this.isSingleOccurrenceMove(item)) {
      parts.push(this.getSingleMoveTooltip(item));
    }

    return parts
      .filter(Boolean)
      .join(' • ');
  }
  private mapView(view: ViewName): string {
    const hasRes = !!(this.resources && this.resources.length);

    if (view === 'timeGridDay') {
      if (hasRes && this.shouldSplitDayByInstructor) {
        return 'resourceTimeGridDay';
      }
      return 'timeGridDay';
    }

    if (view === 'timeGridWeek') {
      return 'timeGridWeek';
    }

    return view;
  }

  private hebDayLetter(date: Date): string {
    const map = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
    return map[date.getDay()] ?? '';
  }

  private dayHeaderContentFactory() {
    return (args: any) => {
      const viewType = args.view?.type as string;
      const isWeek =
        viewType === 'timeGridWeek' || viewType === 'resourceTimeGridWeek';

      if (isWeek && this.isNarrow600) {
        return { html: `<span>${this.hebDayLetter(args.date)}</span>` };
      }

      return { html: args.text };
    };
  }

  private escapeHtml(v: any): string {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getLessonTypeShort(type: string): string {
    const t = String(type || '').trim();

    const map: Record<string, string> = {
      'רגיל': 'ר',
      'שיעור רגיל': 'ר',
      'מילוי מקום': 'מ"מ',
      'ממלא מקום': 'מ"מ',
      'אימון': 'א',
      'פרטי': 'פ',
      'קבוצתי': 'ק',
      'השלמה': 'ה',
      'טיפולי': 'ט',
    };

    return map[t] || (t ? t.slice(0, 2) : '');
  }

  private getItemMeta(item: ScheduleItem): any {
    return (item as any)?.meta || {};
  }

  private getItemInstructorId(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.instructor_id || '');
  }

  private getItemInstructorName(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.instructor_name || '');
  }

  getItemChildName(item: ScheduleItem): string {
    return String(
      this.getItemMeta(item)?.child_name ||
      (item as any)?.title ||
      ''
    );
  }

  getHorseName(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.horse_name || '');
  }

  getArenaName(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.arena_name || '');
  }

  private getItemLessonType(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.lesson_type || '');
  }

  getItemLessonTypeShort(item: ScheduleItem): string {
    return this.getLessonTypeShort(this.getItemLessonType(item));
  }

  getInstructorBorderColor(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.instructor_color || '#748c40');
  }

  isCanceledItem(item: ScheduleItem): boolean {
    const meta = this.getItemMeta(item);

    const rawStatus = String(
      (item as any)?.status ||
      meta?.status ||
      meta?.attendance_status ||
      meta?.lesson_status ||
      ''
    ).trim().toUpperCase();

    return (
      rawStatus.includes('CANCEL') ||
      rawStatus.includes('CANCELED') ||
      rawStatus.includes('CANCELLED') ||
      rawStatus.includes('בוטל') ||
      rawStatus.includes('מבוטל')
    );
  }

  isPendingItem(item: ScheduleItem): boolean {
    const s = String(
      (item as any)?.status || this.getItemMeta(item)?.status || ''
    ).trim().toUpperCase();

    return ['PENDING', 'ממתין לאישור', 'ממתין לאישור מזכירה'].includes(s);
  }

  isApprovedItem(item: ScheduleItem): boolean {
    const s = String(
      (item as any)?.status || this.getItemMeta(item)?.status || ''
    ).trim().toUpperCase();

    return ['APPROVED', 'אושר'].includes(s);
  }

  private emitCustomDayRange(): void {
    const ymd = this.toYmd(this.customDayDate);
    const nextKey = `timeGridDay|${ymd}|${ymd}`;

    if (this.lastRangeKey === nextKey) return;
    this.lastRangeKey = nextKey;

    this.viewRange.emit({
      start: ymd,
      end: ymd,
      viewType: 'timeGridDay',
    });
  }

  private deriveResourcesFromItems(): ScheduleResource[] {
    const map = new Map<string, ScheduleResource>();

    for (const item of this.items || []) {
      const meta = this.getItemMeta(item);
      const id = String(meta?.instructor_id || '');
      if (!id) continue;

      if (!map.has(id)) {
        map.set(id, {
          id,
          title: String(meta?.instructor_name || id),
        });
      }
    }

    return Array.from(map.values());
  }

  private rebuildCustomDayView(): void {
    const ymd = this.toYmd(this.customDayDate);

    const minMinutes = this.parseTimeToMinutes(String(this.slotMinTime || '07:00:00'));
    const maxMinutes = this.parseTimeToMinutes(String(this.slotMaxTime || '21:00:00'));
    const slotStep = 30;

    this.customDaySlots = [];
    for (let m = minMinutes; m < maxMinutes; m += slotStep) {
      this.customDaySlots.push({
        label: this.minutesToTime(m),
        iso: `${ymd}T${this.minutesToTime(m)}:00`,
        minutes: m,
      });
    }

    if (this.shouldSplitDayByInstructor) {
      const inputResources = (this.resources || []).map((r: any) => ({
        id: String(r.id),
        title: String(r.title || ''),
      }));

      this.customDayResources =
        inputResources.length > 0 ? inputResources : this.deriveResourcesFromItems();
    } else {
      this.customDayResources = [
        {
          id: 'single-day-column',
          title: '',
        },
      ];
    }

    const resourceIndex = new Map<string, number>();
    this.customDayResources.forEach((r, idx) => resourceIndex.set(r.id, idx));

    const visibleItems = (this.items || []).filter((item: any) => {
      if (!item?.start) return false;

      const itemDate = new Date(item.start);
      const itemYmd = this.toYmd(itemDate);

      if (itemYmd !== ymd) return false;

      const meta = item?.meta || {};
      if (meta?.isSummaryDay || meta?.isSummarySlot || meta?.isInstructorHeader) return false;
      if (meta?.isFarmDayOff) return false;

      return true;
    });

    const grouped = new Map<string, CustomDayCluster>();
    const fallbackMin = this.customDaySlots[0]?.minutes ?? minMinutes;

    for (const item of visibleItems) {
      const startIso = String((item as any).start || '');
      const endIso = String((item as any).end || '');

      const startMinutes = this.isoToMinutes(startIso);
      const endMinutes = this.isoToMinutes(endIso);

      const row = Math.max(0, Math.floor((startMinutes - fallbackMin) / slotStep));
      const durationMinutes = Math.max(slotStep, endMinutes - startMinutes);
      const span = Math.max(1, Math.ceil(durationMinutes / slotStep));

      const col = this.shouldSplitDayByInstructor
        ? (resourceIndex.get(this.getItemInstructorId(item)) ?? 0)
        : 0;

      const key = this.shouldSplitDayByInstructor
        ? `${this.getItemInstructorId(item)}|${startMinutes}`
        : `single|${startMinutes}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          col,
          row,
          span,
          items: [],
        });
      }

      grouped.get(key)!.items.push(item);
    }

    this.customDayClusters = Array.from(grouped.values())
      .sort((a, b) => a.row - b.row || a.col - b.col);

    const blockedCells: CustomDayBlockedCell[] = [];

    for (const b of this.blockedDayCells || []) {
      if (b.date !== ymd) continue;

      const col = this.shouldSplitDayByInstructor
        ? this.customDayResources.findIndex(r => String(r.id) === String(b.resourceId))
        : 0;

      if (col < 0) continue;

      const startMinutes = this.parseTimeToMinutes(this.toHm(b.startTime));
      const endMinutes = this.parseTimeToMinutes(
        this.toHm(b.endTime || this.minutesToTime(startMinutes + slotStep))
      );

      const row = Math.max(0, Math.floor((startMinutes - fallbackMin) / slotStep));
      const durationMinutes = Math.max(slotStep, endMinutes - startMinutes);
      const span = Math.max(1, Math.ceil(durationMinutes / slotStep));

      blockedCells.push({
        key: `${b.resourceId}|${b.date}|${b.startTime}|${b.endTime ?? ''}`,
        col,
        row,
        span,
        reason: b.reason ?? '',
        kind: b.kind ?? 'day_off',
      });
    }

    this.customDayBlockedCells = blockedCells;
  }


  // onCustomItemClick(item: ScheduleItem, ev: MouseEvent): void {
  //   ev.stopPropagation();

  //   const payload: any = {
  //     event: {
  //       id: (item as any).id,
  //       title: (item as any).title,
  //       start: new Date(String((item as any).start)),
  //       end: new Date(String((item as any).end)),
  //       extendedProps: {
  //         ...this.getItemMeta(item),
  //       },
  //     },
  //     jsEvent: ev,
  //     el: ev.currentTarget as HTMLElement,
  //     view: { type: 'timeGridDay' },
  //   };

  //   this.eventClick.emit(payload);
  // }

  onCustomItemClick(
  item: ScheduleItem,
  jsEvent: MouseEvent
): void {
  jsEvent.preventDefault();
  jsEvent.stopPropagation();

  const meta = (item as any)?.meta ?? {};

  const startValue = (item as any)?.start ?? null;
  const endValue = (item as any)?.end ?? null;

  const fakeEventArg: any = {
    event: {
      id: String(
        meta.lesson_id ??
        (item as any)?.id ??
        ''
      ),

      title: String(
        (item as any)?.title ??
        ''
      ),

      start: startValue
        ? new Date(startValue)
        : null,

      end: endValue
        ? new Date(endValue)
        : null,

      startStr:
        String(startValue ?? ''),

      endStr:
        String(endValue ?? ''),

      /*
       * זה החלק שהיה חסר:
       * כל שדות ההעברה עוברים הלאה.
       */
      extendedProps: {
        ...meta,
        meta,
      },
    },

    jsEvent,
  };

  this.eventClick.emit(fakeEventArg);
}

  onCustomDateCellClick(iso: string, resource?: ScheduleResource | null): void {
    if (resource?.id && this.isBlockedRawCell(resource.id, iso)) {
      return;
    }

    this.dateClick.emit({
      date: new Date(iso),
      dateStr: iso,
      allDay: false,
      dayEl: null as any,
      jsEvent: new MouseEvent('click'),
      view: { type: 'timeGridDay' } as any,
    });
  }

  isBreakCell(resourceId: string, slotIso: string): boolean {

    if (this.viewerMode !== 'secretary') {
      return false;
    }

    const d = new Date(slotIso);

    const ymd = this.toYmd(d);

    const hm = this.minutesToTime(
      d.getHours() * 60 + d.getMinutes()
    );

    return (this.availableDayCells || []).some(a => {

      if (String(a.resourceId) !== String(resourceId)) return false;

      if (a.date !== ymd) return false;

      const start = this.toHm(a.startTime);
      const end = this.toHm(a.endTime);


      const type = String(a.lessonType || '').trim();

      return (
        hm >= start &&
        hm < end &&
        (
          type === 'הפסקה' ||
          type === 'break' ||
          type === 'BREAK'
        )
      );
    });

  }

  onAutoAssignClick() {
    this.autoAssignRequested.emit();
  }

  onCustomDateRightClick(
    event: MouseEvent,
    iso: string,
    resource?: ScheduleResource | null
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (resource?.id && this.isBlockedRawCell(resource.id, iso)) {
      return;
    }

    this.rightClickDay.emit({
      jsEvent: event,
      dateStr: iso,
      resourceId: resource?.id ?? null,
      resourceTitle: resource?.title ?? null,
      sourceView: 'timeGridDay',
    });
  }

  toggleFullscreen(): void {
  this.isFullscreen = !this.isFullscreen;

  document.body.style.overflow = this.isFullscreen ? 'hidden' : '';

  window.dispatchEvent(
    new CustomEvent('schedule-fullscreen-change', {
      detail: {
        fullscreen: this.isFullscreen
      }
    })
  );

  setTimeout(() => {
    this.calendarApi?.updateSize();
    this.cdr.detectChanges();
  }, 50);
}

  trackById(i: number, item: any) {
    return item.id;
  }

  changeView(view: ViewName): void {
  if (view === this.currentView) {
    return;
  }

  if (view === 'timeGridDay') {
    const api = this.calendarApi;

    /*
     * getDate() מייצג את התאריך שהלוח ממוקד בו,
     * ולא בהכרח את היום הראשון בטווח.
     */
    const baseDate =
      api?.getDate()
        ? this.cloneDate(api.getDate())
        : this.cloneDate(this.customDayDate || new Date());

    this.openCustomDay(baseDate);
    return;
  }

  this.currentView = view;

  setTimeout(() => {
    this.applyCurrentView();
    this.cdr.detectChanges();
  }, 0);
}

  prev() {
    if (this.currentView === 'timeGridDay') {
      const d = this.cloneDate(this.customDayDate);
      d.setDate(d.getDate() - 1);
      this.customDayDate = d;
      this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
      this.emitCustomDayRange();
      this.rebuildCustomDayView();
      this.cdr.detectChanges();
      return;
    }

    this.calendarApi?.prev();
  }

  next() {
    if (this.currentView === 'timeGridDay') {
      const d = this.cloneDate(this.customDayDate);
      d.setDate(d.getDate() + 1);
      this.customDayDate = d;
      this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
      this.emitCustomDayRange();
      this.rebuildCustomDayView();
      this.cdr.detectChanges();
      return;
    }

    this.calendarApi?.next();
  }

  today() {
    if (this.currentView === 'timeGridDay') {
      this.customDayDate = this.cloneDate(new Date());
      this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
      this.emitCustomDayRange();
      this.rebuildCustomDayView();
      this.cdr.detectChanges();
      return;
    }

    this.calendarApi?.today();
  }

  private openCustomDay(date: Date | string): void {
  const parsed =
    date instanceof Date
      ? this.cloneDate(date)
      : this.parseYmdAsLocalDate(date);

  if (Number.isNaN(parsed.getTime())) {
    console.warn('openCustomDay received invalid date:', date);
    return;
  }

  /*
   * עוברים ישירות לתצוגת היום המותאמת.
   * לא קוראים קודם ל-changeView('timeGridDay'),
   * כדי למנוע טעינה מיותרת של תחילת החודש.
   */
  this.currentView = 'timeGridDay';
  this.customDayDate = this.cloneDate(parsed);
  this.currentDate =
    this.formatHebrewDayTitle(this.customDayDate);

  /*
   * מאפשרים emit חדש גם אם אותו יום כבר הופיע בעבר.
   */
  this.lastRangeKey = '';

  this.emitCustomDayRange();
  this.rebuildCustomDayView();
  this.cdr.detectChanges();
}

private parseYmdAsLocalDate(value: string): Date {
  const ymd = String(value || '').slice(0, 10);
  const [year, month, day] = ymd.split('-').map(Number);

  if (!year || !month || !day) {
    return new Date(NaN);
  }

  /*
   * לא להשתמש ב-new Date('YYYY-MM-DD'),
   * מפני שהוא עלול להתפרש כ-UTC.
   */
  return new Date(year, month - 1, day);
}

  goToDay(date: string | Date): void {
    const nextDate = date instanceof Date ? this.cloneDate(date) : new Date(date);

    if (Number.isNaN(nextDate.getTime())) {
      console.warn('goToDay received invalid date:', date);
      return;
    }

    if (this.currentView === 'timeGridDay') {
      this.customDayDate = this.cloneDate(nextDate);
      this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
      this.emitCustomDayRange();
      this.rebuildCustomDayView();
      this.cdr.detectChanges();
      return;
    }

    const api = this.calendarApi;
    if (!api) return;

    api.gotoDate(nextDate);

    const mapped = this.mapView(this.currentView);
    api.changeView(mapped, nextDate);

    // this.currentDate =
    //   this.currentView === 'timeGridDay'
    //     ? this.formatHebrewDayTitle(nextDate)
    //     : api.view.title;

    if (
      mapped === 'timeGridDay' ||
      mapped === 'resourceTimeGridDay' ||
      mapped === 'timeGridWeek'
    ) {
      if (this.isToday(nextDate)) {
        api.scrollToTime(this.nowScroll());
      }
    }

    this.cdr.detectChanges();
  }

  private applyCurrentView() {
    const api = this.calendarApi;
    if (!api) return;

    const mapped = this.mapView(this.currentView);
    api.changeView(mapped);

    api.setOption('slotMinTime', this.slotMinTime);
    api.setOption('slotMaxTime', this.slotMaxTime);
    api.setOption('allDaySlot', this.allDaySlot);
    api.setOption('resources', this.resources || []);
    api.getEventSources().forEach(s => s.remove());
    api.addEventSource(this.buildFullCalendarEvents());

    if (
      mapped === 'timeGridDay' ||
      mapped === 'resourceTimeGridDay' ||
      mapped === 'timeGridWeek'
    ) {
      if (this.isToday(api.getDate())) {
        api.scrollToTime(this.nowScroll());
      }
    }
  }

  private applyItems() {
    const api = this.calendarApi;
    if (!api) return;

    api.getEventSources().forEach(s => s.remove());
    api.addEventSource(this.buildFullCalendarEvents());
  }

  private buildFullCalendarEvents(): EventInput[] {
    if (this.currentView === 'dayGridMonth') {
      return this.buildMonthSummaryEvents();
    }

    return this.items.flatMap<EventInput>((i: any) => {
      const isFarmOff = i.meta?.isFarmDayOff === true || i.meta?.isFarmDayOff === 'true';

      if (isFarmOff) {
        return [{
          id: i.id,
          title: i.title || 'חופשת חווה',
          start: i.start,
          end: i.end,
          allDay: true,
          classNames: ['farm-day-off'],
          extendedProps: {
            isFarmDayOff: true,
            meta: i.meta,
            ...i.meta,

            lesson_id: i.meta?.lesson_id,
            instructor_color: i.meta?.instructor_color,
            status: i.status ?? i.meta?.status,

            child_id: i.meta?.child_id,
            child_name: i.meta?.child_name,

            instructor_id: i.meta?.instructor_id,
            instructor_name: i.meta?.instructor_name,

            lesson_type: i.meta?.lesson_type,
            children: i.meta?.children,

            occur_date: i.meta?.occur_date,
            start_time: i.meta?.start_time,
            end_time: i.meta?.end_time,
            start_datetime: i.meta?.start_datetime,
            end_datetime: i.meta?.end_datetime,

            attendance_status: i.meta?.attendance_status,

            /*
             * פרטי העברה חד־פעמית
             */
            occurrence_change_id:
              i.meta?.occurrence_change_id,

            occurrence_change_type:
              i.meta?.occurrence_change_type,

            is_single_occurrence_move:
              i.meta?.is_single_occurrence_move,

            original_occur_date:
              i.meta?.original_occur_date,

            original_instructor_id:
              i.meta?.original_instructor_id,

            original_instructor_name:
              i.meta?.original_instructor_name,

            new_instructor_id:
              i.meta?.new_instructor_id,

            new_instructor_name:
              i.meta?.new_instructor_name,

            original_start_time:
              i.meta?.original_start_time,

            original_end_time:
              i.meta?.original_end_time,

            new_start_time:
              i.meta?.new_start_time,

            new_end_time:
              i.meta?.new_end_time,

            original_day_of_week:
              i.meta?.original_day_of_week,

            new_day_of_week:
              i.meta?.new_day_of_week,

            original_start_datetime:
              i.meta?.original_start_datetime,

            new_start_datetime:
              i.meta?.new_start_datetime,

            new_end_datetime:
              i.meta?.new_end_datetime,

            occurrence_change_note:
              i.meta?.occurrence_change_note,

            occurrence_change_created_at:
              i.meta?.occurrence_change_created_at,

            /*
             * שדות קיימים
             */
            isSummaryDay: i.meta?.isSummaryDay,
            isSummarySlot: i.meta?.isSummarySlot,
            isInstructorHeader: i.meta?.isInstructorHeader,

            horse_name: i.meta?.horse_name,
            arena_name: i.meta?.arena_name,

            // isFarmDayOff: i.meta?.isFarmDayOff,
            isInstructorDayOff: i.meta?.isInstructorDayOff,
            isPendingInstructorDayOff:
              i.meta?.isPendingInstructorDayOff,
          },
        }];
      }

      return [{
        id: i.id,
        title: i.title,
        start: this.normalizeFcDate(i.start),
        end: this.normalizeFcDate(i.end),
        backgroundColor: i.color,
        borderColor: i.color,
        resourceId: i.meta?.instructor_id || undefined,
        classNames: this.getEventClassNames(i),
       extendedProps: {
  /*
   * חשוב: שיטוח כל ה-meta באירוע הרגיל,
   * לא רק באירוע חופשת חווה.
   */
  ...i.meta,
  meta: i.meta,

  lesson_id:
    i.meta?.lesson_id,

  instructor_color:
    i.meta?.instructor_color,

  status:
    i.status ?? i.meta?.status,

  child_id:
    i.meta?.child_id,

  child_name:
    i.meta?.child_name,

  child_age:
    i.meta?.child_age,

  instructor_id:
    i.meta?.instructor_id,

  instructor_name:
    i.meta?.instructor_name,

  lesson_type:
    i.meta?.lesson_type,

  children:
    i.meta?.children,

  occur_date:
    i.meta?.occur_date,

  start_time:
    i.meta?.start_time,

  end_time:
    i.meta?.end_time,

  start_datetime:
    i.meta?.start_datetime,

  end_datetime:
    i.meta?.end_datetime,

  attendance_status:
    i.meta?.attendance_status,

  horse_name:
    i.meta?.horse_name,

  arena_name:
    i.meta?.arena_name,

  /*
   * העברה חד־פעמית
   */
  occurrence_change_id:
    i.meta?.occurrence_change_id,

  occurrence_change_type:
    i.meta?.occurrence_change_type,

  is_single_occurrence_move:
    i.meta?.is_single_occurrence_move,

  original_occur_date:
    i.meta?.original_occur_date,

  original_instructor_id:
    i.meta?.original_instructor_id,

  original_instructor_name:
    i.meta?.original_instructor_name,

  new_instructor_id:
    i.meta?.new_instructor_id,

  new_instructor_name:
    i.meta?.new_instructor_name,

  original_start_time:
    i.meta?.original_start_time,

  original_end_time:
    i.meta?.original_end_time,

  new_start_time:
    i.meta?.new_start_time,

  new_end_time:
    i.meta?.new_end_time,

  original_day_of_week:
    i.meta?.original_day_of_week,

  new_day_of_week:
    i.meta?.new_day_of_week,

  original_start_datetime:
    i.meta?.original_start_datetime,

  new_start_datetime:
    i.meta?.new_start_datetime,

  new_end_datetime:
    i.meta?.new_end_datetime,

  occurrence_change_note:
    i.meta?.occurrence_change_note,

  occurrence_change_created_at:
    i.meta?.occurrence_change_created_at,

  /*
   * שדות מערכת
   */
  isSummaryDay:
    i.meta?.isSummaryDay,

  isSummarySlot:
    i.meta?.isSummarySlot,

  isInstructorHeader:
    i.meta?.isInstructorHeader,

  isFarmDayOff:
    i.meta?.isFarmDayOff,

  isInstructorDayOff:
    i.meta?.isInstructorDayOff,

  isPendingInstructorDayOff:
    i.meta?.isPendingInstructorDayOff,
},
      }];
    });
  }

  private buildMonthSummaryEvents(): EventInput[] {
    const byDate = new Map<string, {
      approved: number;
      canceled: number;
      pending: number;
      farmOff: number;
      instructorOff: number;
    }>();

    const ensure = (date: string) => {
      if (!byDate.has(date)) {
        byDate.set(date, {
          approved: 0,
          canceled: 0,
          pending: 0,
          farmOff: 0,
          instructorOff: 0,
        });
      }
      return byDate.get(date)!;
    };

    for (const item of this.items || []) {
      const start = (item as any).start;
      if (!start) continue;

      const date = this.toYmd(new Date(start));
      const meta = this.getItemMeta(item);
      const bucket = ensure(date);

      if (meta?.isFarmDayOff === true || meta?.isFarmDayOff === 'true') {
        bucket.farmOff++;
        continue;
      }

      if (meta?.isInstructorDayOff === true || meta?.isInstructorDayOff === 'true') {
        bucket.instructorOff++;
        continue;
      }


      if (this.isCanceledItem(item)) {
        bucket.canceled++;
        continue;
      }

      if (this.isPendingItem(item)) {
        bucket.pending++;
        continue;
      }

      bucket.approved++;
    }

    const events: EventInput[] = [];

    for (const [date, c] of byDate.entries()) {
      if (c.approved > 0) {
        events.push(this.monthBadgeEvent(date, c.approved, 'status-approved', 'שיעורים פעילים'));
      }

      if (c.canceled > 0) {
        events.push(this.monthBadgeEvent(date, c.canceled, 'status-canceled', 'שיעורים מבוטלים'));
      }

      if (c.pending > 0) {
        events.push(this.monthBadgeEvent(date, c.pending, 'status-pending', 'בקשות / ממתינים'));
      }

      if (c.farmOff > 0) {
        events.push(this.monthBadgeEvent(date, 'ח', 'farm-day-off', 'חופשת חווה'));
      }

      if (c.instructorOff > 0) {
        events.push(this.monthBadgeEvent(date, 'מ', 'instructor-day-off', 'חופשת מדריך'));
      }
    }

    return events;
  }

  private monthBadgeEvent(
    date: string,
    title: string | number,
    className: string,
    tooltip: string
  ): EventInput {
    return {
      id: `month-${className}-${date}`,
      title: String(title),
      start: date,
      allDay: true,
      classNames: ['month-count-event', className],
      extendedProps: {
        tooltip,
        isMonthSummary: true,
      },
    };
  }
  getAttendanceStatus(item: ScheduleItem): string {
    return String(this.getItemMeta(item)?.attendance_status || '').trim();
  }

  isPresentItem(item: ScheduleItem): boolean {
    const s = this.getAttendanceStatus(item);
    return s === 'present' || s === 'הגיע';
  }

  isAbsentItem(item: ScheduleItem): boolean {
    const s = this.getAttendanceStatus(item);
    return s === 'absent' || s === 'לא הגיע';
  }

  private getEventClassNames(item: ScheduleItem): string[] {
    const meta = this.getItemMeta(item);

    if (meta?.isFarmDayOff === true || meta?.isFarmDayOff === 'true') {
      return ['farm-day-off'];
    }

    if (meta?.isInstructorDayOff === true || meta?.isInstructorDayOff === 'true') {
      return ['instructor-day-off'];
    }

    if (this.isCanceledItem(item)) {
      return ['status-canceled'];
    }

    if (this.isPendingItem(item)) {
      return ['status-pending'];
    }

    return ['status-approved'];
  }

  private extractDateFromRightClick(
    target: HTMLElement,
    clientX: number,
    clientY: number
  ): string | null {
    const cell = target.closest('[data-date]') as HTMLElement | null;
    if (cell?.dataset?.['date']) {
      return cell.dataset['date']!.slice(0, 10);
    }

    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const cell2 = el?.closest('[data-date]') as HTMLElement | null;
    if (cell2?.dataset?.['date']) {
      return cell2.dataset['date']!.slice(0, 10);
    }

    return null;
  }

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimeGridPlugin],
    initialView: this.mapView(this.initialView),
    locale: heLocale,
    direction: 'rtl',
    headerToolbar: false,
    height: 'auto',
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    allDaySlot: false,
    displayEventTime: false,
    eventDisplay: 'block',
    nowIndicator: true,
    scrollTime: '07:00:00',
    slotDuration: '00:30:00',
    snapDuration: '00:30:00',
    timeZone: 'local',
    events: [],
    resources: [],
    resourceAreaWidth: '140px',
    resourceOrder: 'title',
    resourceAreaHeaderContent: '',
    eventMaxStack: 8,
    slotEventOverlap: false,
    eventOverlap: false,
    expandRows: true,
    stickyHeaderDates: true,
    eventMinHeight: 34,
    eventShortHeight: 34,
    dayHeaderContent: this.dayHeaderContentFactory(),

   dateClick: (info: DateClickArg) => {
  const sourceView = this.currentView;

  /*
   * מחודש/שבוע עוברים ישירות ליום שנלחץ.
   * אין changeView ואז goToDay — רק מעבר אחד.
   */
  if (
    sourceView === 'dayGridMonth' ||
    sourceView === 'timeGridWeek'
  ) {
    info.jsEvent?.preventDefault();
    info.jsEvent?.stopPropagation();

    this.openCustomDay(info.date);
    return;
  }

  /*
   * בתצוגת יום רגילה ממשיכים להעביר את הלחיצה להורה,
   * למשל לצורך זימון מהיר.
   */
  this.dateClick.emit(info);
},
    eventClick: (arg: EventClickArg) => {
  if (arg.event.extendedProps['isMonthSummary']) {
    arg.jsEvent.preventDefault();
    arg.jsEvent.stopPropagation();

    const eventDate =
      arg.event.startStr ||
      arg.event.start?.toLocaleDateString('sv-SE') ||
      '';

    if (eventDate) {
      this.openCustomDay(eventDate);
    }

    return;
  }

  this.eventClick.emit(arg);
},
    eventContent: (arg) => {

      const { event } = arg;
      const meta = event.extendedProps['meta'] || {};

      const isSummaryDay = !!event.extendedProps['isSummaryDay'];
      const isSummarySlot = !!event.extendedProps['isSummarySlot'];
      const isInstructorHeader = !!event.extendedProps['isInstructorHeader'];
      const isFarmDayOff = !!event.extendedProps['isFarmDayOff'];
      const isInstructorDayOff = !!event.extendedProps['isInstructorDayOff'];
      const isPendingInstructorDayOff = !!event.extendedProps['isPendingInstructorDayOff'];
      const isMonthSummary = !!event.extendedProps['isMonthSummary'];

      if (isMonthSummary) {
        return {
          html: `
            <div class="month-badge-only" title="${this.escapeHtml(event.extendedProps['tooltip'] || '')}">
              ${this.escapeHtml(event.title)}
            </div>
          `,
        };
      }

      if (isFarmDayOff) {
        return {
          html: `
            <div class="event-box farm-day-off-box">
              <div class="off-top">
                <span class="off-label">חופשת חווה</span>
              </div>
              <div class="off-text">${this.escapeHtml(event.title || 'החווה סגורה')}</div>
            </div>
          `,
        };
      }

      if (isInstructorDayOff) {
        return {
          html: `
            <div class="event-box instructor-day-off-box">
              <div class="off-top">
                <span class="off-icon">🚫</span>
                <span class="off-label">היעדרות מדריך</span>
              </div>
              <div class="off-text">${this.escapeHtml(event.title || 'המדריך אינו זמין')}</div>
            </div>
          `,
        };
      }

      if (isPendingInstructorDayOff) {
        return {
          html: `
            <div class="event-box pending-day-off-box">
              <div class="off-top">
                <span class="off-icon">⏳</span>
                <span class="off-label">בקשת היעדרות</span>
                <span class="pending-badge">ממתין</span>
              </div>
              <div class="off-text">${this.escapeHtml(event.title || 'בקשה טרם אושרה')}</div>
            </div>
          `,
        };
      }

      if (isSummaryDay || isSummarySlot) {
        return {
          html: `
            <div class="event-box summary">
              <div class="title">${this.escapeHtml(event.title)}</div>
            </div>
          `,
        };
      }

      if (isInstructorHeader) {
        return {
          html: `
            <div class="event-box instructor-header">
              <div class="instructor-line">${this.escapeHtml(event.title)}</div>
            </div>
          `,
        };
      }

      const rawStatus = String(event.extendedProps['status'] || '').trim().toUpperCase();
      const isCanceled = ['בוטל', 'מבוטל', 'CANCELED', 'CANCELLED'].includes(rawStatus);

      const childName =
        event.extendedProps['child_name'] ||
        event.extendedProps['children'] ||
        event.title ||
        '';

      const instructorName = event.extendedProps['instructor_name'] || '';
      const horse = event.extendedProps['horse_name'] || '';
      const arena = event.extendedProps['arena_name'] || '';
      const childAge = event.extendedProps['child_age'] || event.extendedProps['age'] || '';

      let mainText = childName;
      let secondaryText = '';

      if (this.viewerMode === 'parent') {
        mainText = [childName, instructorName].filter(Boolean).join(' • ');
      }

      if (this.viewerMode === 'instructor') {
        mainText = childAge ? `${childName} (${childAge})` : childName;
        secondaryText = [horse, arena].filter(Boolean).join(' • ');
      }

      if (this.viewerMode === 'manager' || this.viewerMode === 'secretary') {
        secondaryText = [horse, arena].filter(Boolean).join(' • ');
      }

      const lessonType = event.extendedProps['lesson_type'] || '';
      const lessonTypeShort = this.getLessonTypeShort(lessonType);

      const isSingleMove =
        event.extendedProps['is_single_occurrence_move'] === true ||
        event.extendedProps['is_single_occurrence_move'] === 'true' ||
        event.extendedProps['occurrence_change_type'] === 'MOVE' ||
        meta?.is_single_occurrence_move === true ||
        meta?.is_single_occurrence_move === 'true' ||
        meta?.occurrence_change_type === 'MOVE';

        console.log('isSingleMove', isSingleMove, event.extendedProps['occurrence_change_type'], meta?.occurrence_change_type);

      const originalInstructorName = String(
        event.extendedProps['original_instructor_name'] ??
        meta?.original_instructor_name ??
        ''
      ).trim();

      const originalOccurDate = String(
        event.extendedProps['original_occur_date'] ??
        meta?.original_occur_date ??
        ''
      ).slice(0, 10);

      const originalStartTime = String(
        event.extendedProps['original_start_time'] ??
        meta?.original_start_time ??
        ''
      ).slice(0, 5);

      const moveTooltip = isSingleMove
        ? [
          'הועבר ח״פ',
          originalInstructorName
            ? `ממדריך ${originalInstructorName}`
            : '',
          originalOccurDate
            ? `ביום ${this.formatDisplayDate(originalOccurDate)}`
            : '',
          originalStartTime
            ? `בשעה ${originalStartTime}`
            : '',
        ]
          .filter(Boolean)
          .join(' ')
        : '';

      const singleMoveBadge = isSingleMove
        ? `
      <span
        class="mini-badge single-move-badge"
        title="${this.escapeHtml(moveTooltip)}">
        ח״פ
      </span>
    `
        : '';

      const isWeekView =
        arg.view.type === 'timeGridWeek' ||
        arg.view.type === 'resourceTimeGridWeek';

      const isDayView =
        arg.view.type === 'timeGridDay' ||
        arg.view.type === 'resourceTimeGridDay';

      const isMakeupAllowed = !!meta?.is_makeup_allowed;

      if (isCanceled) {
        const cancelTooltip = [
          'שיעור מבוטל',
          childName ? `ילד: ${childName}` : '',
          lessonType ? `סוג: ${lessonType}` : '',
          isMakeupAllowed ? 'מותר להשלמה' : 'ללא השלמה',
        ]
          .filter(Boolean)
          .join(' • ');

        return {
          html: `
    <div
  class="event-box lesson-card ${isSingleMove ? 'single-move-card' : ''}"
  title="${this.escapeHtml(moveTooltip)}">
      <div class="main-line">
        <span class="child-main-name" title="${this.escapeHtml(mainText)}">
          ${this.escapeHtml(mainText)}
        </span>

        <span class="badges">
  ${singleMoveBadge}

  ${lessonTypeShort
              ? `
          <span class="mini-badge type-badge">
            ${this.escapeHtml(lessonTypeShort)}
          </span>
        `
              : ''
            }
</span>
      </div>

      ${!isWeekView && secondaryText
              ? `<div class="secondary-line">${this.escapeHtml(secondaryText)}</div>`
              : ''}
    </div>
  `,
        };
      }

      const secondaryLine =
        isDayView && (horse || arena)
          ? `
            <div class="secondary-line">
              ${horse ? `<span class="resource-item">🐎 ${this.escapeHtml(horse)}</span>` : ''}
              ${horse && arena ? `<span class="dot-sep">•</span>` : ''}
              ${arena ? `<span class="resource-item">📍 ${this.escapeHtml(arena)}</span>` : ''}
            </div>
          `
          : '';

      return {
        html: `
          <div
  class="event-box lesson-card ${isSingleMove ? 'single-move-card' : ''}"
  title="${this.escapeHtml(moveTooltip)}">
            <div class="main-line">
              <span class="child-main-name" title="${this.escapeHtml(childName)}">
                ${this.escapeHtml(childName)}
              </span>

              <span class="badges">
  ${singleMoveBadge}

  ${lessonTypeShort
            ? `
          <span class="mini-badge type-badge">
            ${this.escapeHtml(lessonTypeShort)}
          </span>
        `
            : ''
          }
</span>
              </span>
            </div>

            ${!isWeekView ? secondaryLine : ''}
          </div>
        `,
      };
    },

    eventClassNames: (arg) => {
      const classes: string[] = [];
      const status = arg.event.extendedProps['status'];
      const isSummaryDay = arg.event.extendedProps['isSummaryDay'];
      const isSummarySlot = arg.event.extendedProps['isSummarySlot'];
      const isHeader = arg.event.extendedProps['isInstructorHeader'];
      const isFarmDayOff = arg.event.extendedProps['isFarmDayOff'];
      const isInstructorDayOff = arg.event.extendedProps['isInstructorDayOff'];
      const isPendingInstructorDayOff = arg.event.extendedProps['isPendingInstructorDayOff'];

      if (isSummaryDay || isSummarySlot) classes.push('summary-event');
      if (isHeader) classes.push('inst-header');
      if (isFarmDayOff) classes.push('farm-day-off');
      if (isInstructorDayOff) classes.push('instructor-day-off');
      if (isPendingInstructorDayOff) classes.push('pending-instructor-day-off');

      const s = (typeof status === 'string' ? status.trim() : '').toUpperCase();

      if (['בוטל', 'מבוטל', 'CANCELED', 'CANCELLED'].includes(s)) {
        classes.push('status-canceled');
      } else if (s === 'אושר' || s === 'APPROVED') {
        classes.push('status-approved');
      } else if (
        s === 'ממתין לאישור' ||
        s === 'ממתין לאישור מזכירה' ||
        s === 'PENDING'
      ) {
        classes.push('status-pending');
      }

      return classes;
    },

    eventDidMount: (info: any) => {
      const meta = info.event.extendedProps?.meta || info.event.extendedProps || {};
      const color = meta?.instructor_color;

      if (color) {
        const box = info.el.querySelector('.event-box') as HTMLElement | null;
        if (box) {
          box.style.borderRight = `6px solid ${color}`;
          box.style.boxSizing = 'border-box';
        }
      }

      let tooltipText = '';

      if (meta?.isFarmDayOff === true || meta?.isFarmDayOff === 'true') {
        tooltipText = meta.reason ? `חופשת חווה:\n${meta.reason}` : 'חופשת חווה';
      }

      if (meta?.isInstructorDayOff === true || meta?.isInstructorDayOff === 'true') {
        tooltipText = meta.note ? `היעדרות מדריך:\n${meta.note}` : 'היעדרות מדריך';
      }

      if (meta?.isPendingInstructorDayOff === true || meta?.isPendingInstructorDayOff === 'true') {
        tooltipText = meta.note
          ? `בקשת היעדרות ממתינה:\n${meta.note}`
          : 'בקשת היעדרות ממתינה לאישור';
      }

      if (meta?.isSummaryDay === true || meta?.isSummaryDay === 'true') {
        tooltipText = info.event.title;
      }

      if (meta?.cancelBlockReason) {
        tooltipText = meta.cancelBlockReason;
      }

      if (tooltipText) {
        info.el.setAttribute('title', tooltipText);
        info.el.classList.add('has-tooltip');
      }

      (info.event.classNames || []).forEach((cls: string) => {
        info.el.classList.add(cls);
      });

      info.el.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        const meta = info.event.extendedProps?.meta || info.event.extendedProps || {};

        this.rightClickEvent.emit({
          jsEvent: ev,
          dateStr: info.event.start ? info.event.start.toISOString() : '',
          endStr: info.event.end ? info.event.end.toISOString() : null,
          resourceId: String(meta?.instructor_id || info.event.getResources?.()?.[0]?.id || ''),
          resourceTitle: String(meta?.instructor_name || ''),
          sourceView: this.currentView,
          eventId: String(info.event.id || ''),
          lessonId: String(meta?.lesson_id || ''),
          childId: String(meta?.child_id || ''),
          childName: String(meta?.child_name || ''),
          lessonType: String(meta?.lesson_type || ''),
          status: String(meta?.status || ''),
          seriesId: meta?.series_id ? String(meta.series_id) : null,
          appointmentKind: meta?.appointment_kind ? String(meta.appointment_kind) : null,
          repeatWeeks: meta?.repeat_weeks != null ? Number(meta.repeat_weeks) : null,
          isOpenEnded: meta?.is_open_ended != null ? !!meta.is_open_ended : null,
          seriesEndDate: meta?.series_end_date ? String(meta.series_end_date) : null,
          occurDate: meta?.occur_date ? String(meta.occur_date) : null,
          startTime: meta?.start_time ? String(meta.start_time) : null,
          endTimeOnly: meta?.end_time ? String(meta.end_time) : null,
        });
      });
    },


    datesSet: (info: DatesSetArg) => {
      setTimeout(() => {
        const toLocalYMD = (d: Date) =>
          `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;

        const start = info.start;
        const endExclusive = info.end;
        const endInclusive = new Date(endExclusive);

        const isSingleDay =
          info.view.type === 'timeGridDay' ||
          info.view.type === 'resourceTimeGridDay';

        if (!isSingleDay) {
          endInclusive.setDate(endInclusive.getDate() - 1);
        }

        const startYmd = toLocalYMD(start);
        const endYmd = toLocalYMD(endInclusive);
        const nextKey = `${info.view.type}|${startYmd}|${endYmd}`;

        if (this.lastRangeKey !== nextKey) {
          this.lastRangeKey = nextKey;
          this.viewRange.emit({
            start: startYmd,
            end: endYmd,
            viewType: info.view.type,
          });
        }

        this.currentDate = info.view.title;
      }, 0);
    },

  };

  ngAfterViewInit(): void {
    this.bindContextMenu();

    if (this.currentView === 'timeGridDay') {
      this.customDayDate = this.cloneDate(new Date());
      this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
      this.emitCustomDayRange();
      this.rebuildCustomDayView();
    } else {
      setTimeout(() => this.applyCurrentView(), 0);
    }
  }

  ngOnDestroy(): void {
    if (this.boundContextMenuHandler && this.calendarHost?.nativeElement) {
      this.calendarHost.nativeElement.removeEventListener(
        'contextmenu',
        this.boundContextMenuHandler
      );
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['items']) {
      if (this.currentView === 'timeGridDay') {
        this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
        this.rebuildCustomDayView();
      } else {
        setTimeout(() => this.applyItems(), 0);
      }
    }

    if (changes['resources'] && this.currentView !== 'timeGridDay') {
      setTimeout(() => {
        const api = this.calendarApi;
        if (!api) return;
        api.setOption('resources', this.resources || []);
      }, 0);
    }
    if (this.currentView === 'timeGridDay') {
      if (
        changes['items'] ||
        changes['resources'] ||
        changes['slotMinTime'] ||
        changes['slotMaxTime'] ||
        changes['initialView'] ||
        changes['blockedDayCells'] ||
        changes['availableDayCells']
      ) {
        this.currentDate = this.formatHebrewDayTitle(this.customDayDate);
        this.rebuildCustomDayView();
      }
      return;
    }
  }

  private bindContextMenu(): void {
    if (!this.calendarHost?.nativeElement) return;

    this.boundContextMenuHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (this.currentView === 'timeGridDay') {
        return;
      }

      const dateStr = this.extractDateFromRightClick(
        target,
        e.clientX,
        e.clientY
      );

      if (!dateStr) return;

      e.preventDefault();
      e.stopPropagation();

      this.ngZone.run(() => {
        this.rightClickDay.emit({
          jsEvent: e,
          dateStr,
        });
      });
    };

    this.calendarHost.nativeElement.addEventListener(
      'contextmenu',
      this.boundContextMenuHandler
    );
  }

  onCustomItemRightClick(item: ScheduleItem, ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();

    const meta = this.getItemMeta(item) || {};
    const startIso = String((item as any).start || '');
    const endIso = String((item as any).end || '');

    this.rightClickEvent.emit({
      jsEvent: ev,
      dateStr: startIso,
      endStr: endIso || null,
      resourceId: this.getItemInstructorId(item) || null,
      resourceTitle: this.getItemInstructorName(item) || null,
      sourceView: 'timeGridDay',
      eventId: String((item as any).id || ''),
      lessonId: String(meta.lesson_id || ''),
      childId: String(meta.child_id || ''),
      childName: String(meta.child_name || ''),
      lessonType: String(meta.lesson_type || ''),
      status: String((item as any).status || meta.status || ''),
      seriesId: meta?.series_id ? String(meta.series_id) : null,
      appointmentKind: meta?.appointment_kind ? String(meta.appointment_kind) : null,
      repeatWeeks: meta?.repeat_weeks != null ? Number(meta.repeat_weeks) : null,
      isOpenEnded: meta?.is_open_ended != null ? !!meta.is_open_ended : null,
      seriesEndDate: meta?.series_end_date ? String(meta.series_end_date) : null,
      occurDate: meta?.occur_date ? String(meta.occur_date) : null,
      startTime: meta?.start_time ? String(meta.start_time) : String(startIso).slice(11, 16),
      endTimeOnly: meta?.end_time ? String(meta.end_time) : (endIso ? String(endIso).slice(11, 16) : null),
    });
  }

  isAvailableRawCell(resourceId: string, slotIso: string): boolean {
    return !!this.getAvailableRawCellColor(resourceId, slotIso);
  }

  getAvailableRawCellColor(resourceId: string, slotIso: string): string {
    const d = new Date(slotIso);
    const ymd = this.toYmd(d);
    const hm = this.minutesToTime(d.getHours() * 60 + d.getMinutes());

    const match = (this.availableDayCells || []).find(a => {
      if (String(a.resourceId) !== String(resourceId)) return false;
      if (a.date !== ymd) return false;

      const start = this.toHm(a.startTime);
      const end = this.toHm(a.endTime);

      return hm >= start && hm < end;
    });

    return match?.color || '';
  }

  isSingleOccurrenceMove(item: ScheduleItem): boolean {
    const meta = this.getItemMeta(item);

    return (
      meta?.is_single_occurrence_move === true ||
      meta?.is_single_occurrence_move === 'true' ||
      meta?.occurrence_change_type === 'MOVE'
    );
  }

  private formatDisplayDate(value: any): string {
    const raw = String(value || '').slice(0, 10);
    const [year, month, day] = raw.split('-');

    if (!year || !month || !day) {
      return raw;
    }

    return `${day}/${month}/${year}`;
  }

  getSingleMoveTooltip(item: ScheduleItem): string {
    if (!this.isSingleOccurrenceMove(item)) {
      return '';
    }

    const meta = this.getItemMeta(item);

    const instructorName =
      String(meta?.original_instructor_name || '').trim() ||
      'מדריך לא ידוע';

    const originalDate = this.formatDisplayDate(
      meta?.original_occur_date ||
      meta?.original_start_datetime
    );

    const originalTime = String(
      meta?.original_start_time || ''
    ).slice(0, 5);

    return [
      'הועבר ח״פ',
      `ממדריך ${instructorName}`,
      originalDate ? `ביום ${originalDate}` : '',
      originalTime ? `בשעה ${originalTime}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  hexToRgba(hex: string, alpha: number): string {
    const clean = String(hex || '').replace('#', '').trim();

    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
      return `rgba(116, 140, 64, ${alpha})`;
    }

    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
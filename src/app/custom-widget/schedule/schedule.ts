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
  }>();
  

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
  

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

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

  private formatHebrewDayTitle(date: Date): string {
    return new Intl.DateTimeFormat('he-IL', {
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
  if (this.isParentView) {
    return [
      this.getItemChildName(item),
      this.getItemInstructorName(item),
      this.getItemLessonType(item),
    ].filter(Boolean).join(' • ');
  }

  if (this.isInstructorView) {
    return [
      this.getItemChildName(item),
      this.getItemChildAge(item) ? `גיל: ${this.getItemChildAge(item)}` : '',
      this.getHorseName(item),
      this.getArenaName(item),
    ].filter(Boolean).join(' • ');
  }

  return [
    this.getItemChildName(item),
    this.getItemLessonType(item),
    this.getHorseName(item),
    this.getArenaName(item),
  ].filter(Boolean).join(' • ');
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
    const s = String(
      (item as any)?.status || this.getItemMeta(item)?.status || ''
    ).trim().toUpperCase();

    return ['בוטל', 'מבוטל', 'CANCELED', 'CANCELLED'].includes(s);
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

  console.log('customDayDate', ymd);
console.log('items for day', (this.items || []).map(i => i.start));

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
}


  onCustomItemClick(item: ScheduleItem, ev: MouseEvent): void {
    ev.stopPropagation();

    const payload: any = {
      event: {
        id: (item as any).id,
        title: (item as any).title,
        start: new Date(String((item as any).start)),
        end: new Date(String((item as any).end)),
        extendedProps: {
          ...(item as any),
          ...(this.getItemMeta(item) || {}),
          meta: this.getItemMeta(item) || {},
          status: (item as any).status,
          child_id: this.getItemMeta(item)?.child_id,
          child_name: this.getItemChildName(item),
          instructor_id: this.getItemInstructorId(item),
          instructor_name: this.getItemInstructorName(item),
          lesson_type: this.getItemLessonType(item),
          horse_name: this.getHorseName(item),
          arena_name: this.getArenaName(item),
        },
      },
      jsEvent: ev,
      el: ev.currentTarget as HTMLElement,
      view: { type: 'timeGridDay' },
    };

    this.eventClick.emit(payload);
  }

  onCustomDateCellClick(iso: string): void {
    this.dateClick.emit({
      date: new Date(iso),
      dateStr: iso,
      allDay: false,
      dayEl: null as any,
      jsEvent: new MouseEvent('click'),
      view: { type: 'timeGridDay' } as any,
    });
  }

  onAutoAssignClick() {
    this.autoAssignRequested.emit();
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';
  }

  changeView(view: ViewName) {
  this.currentView = view;

  if (view === 'timeGridDay') {
    const api = this.calendarApi;

    // אם באים משבוע/חודש - נבחר יום ברור
    // אפשר לבחור את היום הנוכחי, או את היום שבו הפוקוס נמצא
    const baseDate = api ? new Date(api.view.currentStart) : new Date();

    this.customDayDate = this.cloneDate(baseDate);
    this.currentDate = this.formatHebrewDayTitle(this.customDayDate);

    this.lastRangeKey = '';
    this.emitCustomDayRange();
    this.rebuildCustomDayView();
    return;
  }

  setTimeout(() => this.applyCurrentView(), 0);
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
    api.setOption('events', this.buildFullCalendarEvents());

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

  api.setOption('events', this.buildFullCalendarEvents());
}

  private buildFullCalendarEvents(): EventInput[] {
    return this.items.flatMap<EventInput>((i: any) => {
      if (i.meta?.['isFarmDayOff'] === 'true' || i.meta?.['isFarmDayOff'] === true) {
        return [
          {
            id: i.id + '_bg',
            start: i.start,
            end: i.end,
            display: 'background',
            backgroundColor: '#FFE0B2',
            overlap: false,
          },
          {
            id: i.id,
            title: i.title,
            start: i.start,
            end: i.end,
            color: '#FB8C00',
            textColor: '#4E342E',
            extendedProps: {
              isFarmDayOff: true,
              meta: i.meta,
            },
          },
        ];
      }

      return [
        {
          id: i.id,
          title: i.title,
          start: this.normalizeFcDate(i.start),
          end: this.normalizeFcDate(i.end),
          backgroundColor: i.color,
          borderColor: i.color,
          resourceId: i.meta?.instructor_id || undefined,
          extendedProps: {
            lesson_id: i.meta?.lesson_id,
            meta: i.meta,
            instructor_color: i.meta?.instructor_color,
            status: i.status,
            child_id: i.meta?.child_id,
            child_name: i.meta?.child_name,
            instructor_id: i.meta?.instructor_id,
            instructor_name: i.meta?.instructor_name,
            lesson_type: i.meta?.lesson_type,
            children: i.meta?.children,
            occur_date: i.meta?.occur_date,
            isSummaryDay: i.meta?.isSummaryDay,
            isSummarySlot: i.meta?.isSummarySlot,
            isInstructorHeader: i.meta?.isInstructorHeader,
            horse_name: i.meta?.horse_name,
            arena_name: i.meta?.arena_name,
            isFarmDayOff: i.meta?.isFarmDayOff,
            isInstructorDayOff: i.meta?.isInstructorDayOff,
            isPendingInstructorDayOff: i.meta?.isPendingInstructorDayOff,
          },
        },
      ];
    });
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
  // נשמור גם emit החוצה אם צריך
  this.dateClick.emit(info);

  // אם לוחצים בשבוע/חודש – קופצים ליום
  if (this.currentView === 'timeGridWeek' || this.currentView === 'dayGridMonth') {
    this.changeView('timeGridDay');

    setTimeout(() => {
      this.goToDay(info.date);
    }, 0);
  }
},
    eventClick: (arg: EventClickArg) => this.eventClick.emit(arg),

    eventContent: (arg) => {
      const { event } = arg;
      const meta = event.extendedProps['meta'] || {};

      const isSummaryDay = !!event.extendedProps['isSummaryDay'];
      const isSummarySlot = !!event.extendedProps['isSummarySlot'];
      const isInstructorHeader = !!event.extendedProps['isInstructorHeader'];
      const isFarmDayOff = !!event.extendedProps['isFarmDayOff'];
      const isInstructorDayOff = !!event.extendedProps['isInstructorDayOff'];
      const isPendingInstructorDayOff = !!event.extendedProps['isPendingInstructorDayOff'];

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
    <div class="event-box lesson-card">
      <div class="main-line">
        <span class="child-main-name" title="${this.escapeHtml(mainText)}">
          ${this.escapeHtml(mainText)}
        </span>

        <span class="badges">
          ${lessonTypeShort ? `<span class="mini-badge type-badge">${this.escapeHtml(lessonTypeShort)}</span>` : ''}
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
          <div class="event-box lesson-card">
            <div class="main-line">
              <span class="child-main-name" title="${this.escapeHtml(childName)}">
                ${this.escapeHtml(childName)}
              </span>

              <span class="badges">
                ${lessonTypeShort ? `<span class="mini-badge type-badge">${this.escapeHtml(lessonTypeShort)}</span>` : ''}
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
}
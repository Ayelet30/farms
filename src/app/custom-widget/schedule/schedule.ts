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


@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class ScheduleComponent implements OnChanges, AfterViewInit,OnDestroy {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;
@ViewChild('calendarHost', { static: true }) calendarHost!: ElementRef<HTMLElement>;
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

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  private nowScroll(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }

  private isToday(d: Date) {
    const t = new Date();
    return (
      d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate()
    );
  }

  private mapView(view: ViewName): string {
  const hasRes = !!(this.resources && this.resources.length);
  if (!hasRes) return view;

  // ביומי כן מחלקים לטורי מדריכים
  if (view === 'timeGridDay') return 'resourceTimeGridDay';

  // בשבועי נשארים על timeGridWeek רגיל
  // כדי להציג כרטיסיות סיכום לכל מדריך בכל יום
  if (view === 'timeGridWeek') return 'timeGridWeek';

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

 calendarOptions: CalendarOptions = {
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimeGridPlugin],
  initialView: 'timeGridDay',
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
  slotEventOverlap: false,
  eventOverlap: false,
  timeZone: 'local',
  events: [],
  resources: [],

  resourceAreaWidth: '140px',
  resourceOrder: 'title',
  resourceAreaHeaderContent: '',

  eventMaxStack: 4,
  eventMinHeight: 34,
  eventShortHeight: 34,
  dayHeaderContent: this.dayHeaderContentFactory(),

    dateClick: (info: DateClickArg) => this.dateClick.emit(info),
    eventClick: (arg: EventClickArg) => this.eventClick.emit(arg),

    // dayCellDidMount: (info) => {
    //   const pad = (n: number) => String(n).padStart(2, '0');
    //   const d = info.date;
    //   const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    //   const classes = info.el.classList;
    //   const fcFrame = info.el.querySelector('.fc-daygrid-day-frame');
    //   if (fcFrame && classes.length > 0) {
    //     classes.forEach((cls) => fcFrame.classList.add(cls));
    //   }

    //   // info.el.addEventListener('contextmenu', (ev: MouseEvent) => {
    //   //   ev.preventDefault();
    //   //   ev.stopPropagation();

    //   //   this.ngZone.run(() => {
    //   //     this.rightClickDay.emit({ jsEvent: ev, dateStr });
    //   //   });
    //   // });
    // },

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

      const lessonType = event.extendedProps['lesson_type'] || '';
      const lessonTypeShort = this.getLessonTypeShort(lessonType);

      const horse = event.extendedProps['horse_name'] || '';
      const arena = event.extendedProps['arena_name'] || '';

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
            <div class="event-box canceled-compact" title="${this.escapeHtml(cancelTooltip)}">
              <span class="cancel-icon">✖</span>
              ${isDayView ? `<span class="cancel-name">${this.escapeHtml(childName)}</span>` : ''}
              ${lessonTypeShort ? `<span class="mini-badge cancel-type">${this.escapeHtml(lessonTypeShort)}</span>` : ''}
              ${isMakeupAllowed ? `<span class="mini-badge makeup-ok">ה</span>` : ''}
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
        tooltipText = meta.reason
          ? `חופשת חווה:\n${meta.reason}`
          : 'חופשת חווה';
      }
      if (meta?.isInstructorDayOff === true || meta?.isInstructorDayOff === 'true') {
  tooltipText = meta.note
    ? `היעדרות מדריך:\n${meta.note}`
    : 'היעדרות מדריך';
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

        // info.el.addEventListener('contextmenu', (ev: MouseEvent) => {
        //   ev.preventDefault();
        //   ev.stopPropagation();

        //   const dateStr = info.event.startStr.slice(0, 10);

        //   this.ngZone.run(() => {
        //     this.rightClickDay.emit({ jsEvent: ev, dateStr });
        //   });
        // });
    },

    datesSet: (info: DatesSetArg) => {
      setTimeout(() => {
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
        const toLocalYMD = (d: Date) =>
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        const start = info.start;
        const endExclusive = info.end;
        const endInclusive = new Date(endExclusive);

        const isSingleDay =
          info.view.type === 'timeGridDay' ||
          info.view.type === 'resourceTimeGridDay';

        if (!isSingleDay) {
          endInclusive.setDate(endInclusive.getDate() - 1);
        }

        this.viewRange.emit({
          start: toLocalYMD(start),
          end: toLocalYMD(endInclusive),
          viewType: info.view.type,
        });

        this.currentDate = info.view.title;

        const api = this.calendarApi;
        if (
        api &&
        (
          info.view.type === 'timeGridDay' ||
          info.view.type === 'resourceTimeGridDay' ||
          info.view.type === 'timeGridWeek'
        )
      ) {
        if (this.isToday(api.getDate())) {
          api.scrollToTime(this.nowScroll());
        }

        }

        this.cdr.detectChanges();
      }, 0);
    },
  };

  ngAfterViewInit(): void {
  this.boundContextMenuHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

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

  setTimeout(() => {
    this.applyCurrentView();
  }, 0);
}
ngOnDestroy(): void {
  if (this.boundContextMenuHandler) {
    this.calendarHost.nativeElement.removeEventListener(
      'contextmenu',
      this.boundContextMenuHandler
    );
  }
}
  ngOnChanges(changes: SimpleChanges) {
    if (changes['resources']) {
      setTimeout(() => this.applyCurrentView(), 0);
    }

    if (changes['items'] || changes['resources']) {
      this.calendarOptions = {
        ...this.calendarOptions,
        events: this.items.flatMap<EventInput>((i) => {
          if (i.meta?.['isFarmDayOff'] === 'true') {
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

                console.log('FC EVENT', {
      title: i.title,
      start: this.normalizeFcDate(i.start),
      end: this.normalizeFcDate(i.end),
    });
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
                lesson_id: i.meta?.['lesson_id'],
                meta: i.meta,
                instructor_color: i.meta?.['instructor_color'],
                status: i.status,
                child_id: i.meta?.child_id,
                child_name: i.meta?.child_name,
                instructor_id: i.meta?.instructor_id,
                instructor_name: i.meta?.instructor_name,
                lesson_type: i.meta?.['lesson_type'],
                children: i.meta?.['children'],
                occur_date: i.meta?.['occur_date'],
                isSummaryDay: i.meta?.isSummaryDay,
                isSummarySlot: i.meta?.isSummarySlot,
                isInstructorHeader: i.meta?.['isInstructorHeader'],
                horse_name: i.meta?.['horse_name'],
                arena_name: i.meta?.['arena_name'],
                isFarmDayOff: i.meta?.['isFarmDayOff'],
                isInstructorDayOff: i.meta?.['isInstructorDayOff'],
                isPendingInstructorDayOff: i.meta?.['isPendingInstructorDayOff'],
              },
            },
          ];
        }),
        resources: this.resources,
      };
    }

    if (changes['initialView'] && changes['initialView'].currentValue) {
      this.currentView = changes['initialView'].currentValue;
      this.applyCurrentView();
    }
  }

  get calendarApi() {
    return this.calendarComponent?.getApi();
  }
private extractDateFromRightClick(
  target: HTMLElement,
  clientX: number,
  clientY: number
): string | null {
  // 1) אם לחצו בתוך תא חודש
  const dayCells = Array.from(
    this.calendarHost.nativeElement.querySelectorAll('.fc-daygrid-day[data-date]')
  ) as HTMLElement[];

  for (const cell of dayCells) {
    const rect = cell.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const date = cell.getAttribute('data-date');
      if (date) return date.slice(0, 10);
    }
  }

  // 2) אם לחצו בתוך עמודת יום של timeGrid
  const timeGridCols = Array.from(
    this.calendarHost.nativeElement.querySelectorAll('.fc-timegrid-col[data-date]')
  ) as HTMLElement[];

  for (const col of timeGridCols) {
    const rect = col.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const date = col.getAttribute('data-date');
      if (date) return date.slice(0, 10);
    }
  }

  // 3) fallback - אם לחצו על event / header / משהו עם data-date
  const anyDateEl = target.closest('[data-date]') as HTMLElement | null;
  const anyDate = anyDateEl?.getAttribute('data-date');
  if (anyDate) {
    return anyDate.slice(0, 10);
  }

  return null;
}
  private applyCurrentView() {
    const api = this.calendarApi;
    if (!api) return;

    const mapped = this.mapView(this.currentView);
    api.changeView(mapped);

    if (
      (this.currentView === 'timeGridDay' || this.currentView === 'timeGridWeek') &&
      this.isToday(api.getDate())
    ) {
      setTimeout(() => api.scrollToTime(this.nowScroll()), 0);
    }
  }

  onAutoAssignClick() {
    if (!this.enableAutoAssign) return;
    this.autoAssignRequested.emit();
  }

  changeView(view: ViewName) {
    this.currentView = view;
    this.applyCurrentView();
  }

  next() {
    this.calendarApi.next();
  }

  prev() {
    this.calendarApi.prev();
  }

  today() {
    const api = this.calendarApi;
    if (!api) return;
    api.today();
    this.applyCurrentView();
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;

    document.body.style.overflow = this.isFullscreen ? 'hidden' : '';

    const api = this.calendarApi;
    if (api) {
      api.setOption('height', this.isFullscreen ? '100%' : 'auto');
      setTimeout(() => {
        api.updateSize();
        if (this.currentView === 'timeGridDay' || this.currentView === 'timeGridWeek') {
          const d = api.getDate();
          const t = new Date();
          if (
            d.getFullYear() === t.getFullYear() &&
            d.getMonth() === t.getMonth() &&
            d.getDate() === t.getDate()
          ) {
            api.scrollToTime(this.nowScroll());
          }
        }
      }, 0);
    }
  }
  private normalizeFcDate(value: string | Date): string {
  if (value instanceof Date) {
    return this.formatLocalDateTime(value);
  }

  let s = String(value).trim();

  // מחליף רווח ב-T
  s = s.replace(' ', 'T');

  // אם יש רק שעות ודקות - נוסיף שניות
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    return `${s}:00`;
  }

  // אם כבר יש שניות - נשאיר
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    return s;
  }

  return s;
}

private formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

  goToDay(dateStr: string) {
    const api = this.calendarApi;
    if (!api) return;

    const mapped = this.mapView('timeGridDay');
    api.changeView(mapped, dateStr);
    this.currentView = 'timeGridDay';

    setTimeout(() => api.scrollToTime(this.nowScroll()), 0);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.isFullscreen) this.toggleFullscreen();
  }
}
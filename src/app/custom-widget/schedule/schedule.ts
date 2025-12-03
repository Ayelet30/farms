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
  HostListener,
  ChangeDetectorRef,
  NgZone,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg, DatesSetArg } from '@fullcalendar/core';
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
export class ScheduleComponent implements OnChanges, AfterViewInit {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  @Input() items: ScheduleItem[] = [];
  @Input() initialView: ViewName = 'timeGridWeek';
  @Input() rtl = true;
  @Input() locale: any = heLocale;
  @Input() slotMinTime = '07:00:00';
  @Input() slotMaxTime = '21:00:00';
  @Input() allDaySlot = false;
  @Input() resources: any[] = [];

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

  constructor(private cdr: ChangeDetectorRef, private ngZone: NgZone) {}

  // שעה נוכחית (לגלילה אוטומטית)
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

  /** אם יש resources – למפות את ה-View ל-resourceTimeGrid */
  private mapView(view: ViewName): string {
    if (view === 'timeGridDay' && this.resources && this.resources.length) {
    return 'resourceTimeGridDay';
  }
  // שבועי נשאר timeGridWeek רגיל
  return view;
  }


  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimeGridPlugin],
    initialView: 'timeGridWeek',
    locale: heLocale,
    direction: 'rtl',
    headerToolbar: false,
    height: 'auto',
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    allDaySlot: false,
    displayEventTime: false,
    nowIndicator: true,
    scrollTime: '07:00:00',
    slotDuration: '00:30:00',
    events: [],
    resources: [],

    // 👇 קליק שמאלי רגיל
    dateClick: (info: DateClickArg) => this.dateClick.emit(info),
    eventClick: (arg: EventClickArg) => this.eventClick.emit(arg),

    // 👇 קליק ימני על יום (בתצוגת חודש / יום / שבוע)
    dayCellDidMount: (info) => {
      const dateStr = info.date.toISOString().slice(0, 10);

      // אם בעתיד תעבירי classNames ליום – להחיל אותם על ה-frame הפנימי
      const classes = info.el.classList;
      const fcFrame = info.el.querySelector('.fc-daygrid-day-frame');
      if (fcFrame && classes.length > 0) {
        classes.forEach((cls) => fcFrame.classList.add(cls));
      }

      info.el.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        this.ngZone.run(() => {
          this.rightClickDay.emit({ jsEvent: ev, dateStr });
        });
      });
    },

    eventContent: (arg) => {
      const { event } = arg;
      const status = event.extendedProps['status'] || '';
      const isSummaryDay = !!event.extendedProps['isSummaryDay'];
      const isSummarySlot = !!event.extendedProps['isSummarySlot'];
      const isInstructorHeader = !!event.extendedProps['isInstructorHeader'];

      // סיכומי חודש/שבוע
      if (isSummaryDay || isSummarySlot) {
        return {
          html: `
            <div class="event-box summary">
              <div class="title">${event.title}</div>
            </div>
          `,
        };
      }

      // כותרת מדריך
      if (isInstructorHeader) {
        return {
          html: `
            <div class="event-box instructor-header">
              <div class="instructor-line">${event.title}</div>
            </div>
          `,
        };
      }

      // כרטיסיית שיעור – ילדים + סוג
      const childrenStr =
        event.extendedProps['children'] ||
        event.extendedProps['child_name'] ||
        '';
      const children = childrenStr
        .split('|')
        .map((s: string) => s.trim())
        .filter((s: string) => !!s);

      const childrenHtml = children
        .map((name: string) => `<span class="child-name">${name}</span>`)
        .join('<span class="child-sep"></span>');

      const type = event.extendedProps['lesson_type'] || '';
      const chip = type ? `<span class="chip">${type}</span>` : '';

      return {
        html: `
          <div class="event-box ${status}">
            <div class="children-line">
              ${childrenHtml}
            </div>
            ${chip}
          </div>
        `,
      };
    },

    // 👇 צביעת אירועים + קליק ימני על אירוע (אותו תפריט כמו על יום)
    eventClassNames: (arg) => {
  const classes: string[] = [];
  const status = arg.event.extendedProps['status'];
  const isSummaryDay = arg.event.extendedProps['isSummaryDay'];
  const isSummarySlot = arg.event.extendedProps['isSummarySlot'];
  const isHeader = arg.event.extendedProps['isInstructorHeader'];

  if (isSummaryDay || isSummarySlot) classes.push('summary-event');
  if (isHeader) classes.push('inst-header');

  const s = (typeof status === 'string' ? status.trim() : '').toUpperCase();

  // כאן תתאימי למחרוזות שהגדרת ב־DB
  if (s === 'בוטל' || s === 'מבוטל' || s === 'CANCELED') {
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


    eventDidMount: (info) => {
      // מחיל classNames שנשלחים מבחוץ
      (info.event.classNames || []).forEach((cls) => {
        info.el.classList.add(cls);
      });

      // קליק ימני על אירוע – נפתח תפריט לפי תאריך השיעור
      info.el.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        const dateStr = info.event.startStr.slice(0, 10);

        this.ngZone.run(() => {
          this.rightClickDay.emit({ jsEvent: ev, dateStr });
        });
      });
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
          (info.view.type === 'timeGridDay' ||
            info.view.type === 'resourceTimeGridDay' ||
            info.view.type === 'timeGridWeek' ||
            info.view.type === 'resourceTimeGridWeek')
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
    setTimeout(() => {
      this.applyCurrentView();
    }, 0);
  }

  ngOnChanges(changes: SimpleChanges) {
  if (changes['resources']) {
    console.log('ScheduleComponent got resources:', this.resources);
    // אחרי שמגיעים resources – לעדכן את ה־View למצב resource*
    setTimeout(() => this.applyCurrentView(), 0);
  }

  if (changes['items'] || changes['resources']) {
    this.calendarOptions = {
      ...this.calendarOptions,
      events: this.items.map((i) => ({
        id: i.id,
        title: i.title,
        start: i.start,
        end: i.end,
        backgroundColor: (i as any).backgroundColor ?? (i as any).color,
        borderColor: (i as any).borderColor ?? (i as any).color,
        resourceId: i.meta?.instructor_id || undefined,
        extendedProps: {
          status: i.status,
          child_id: i.meta?.child_id,
          child_name: i.meta?.child_name,
          instructor_id: i.meta?.instructor_id,
          instructor_name: i.meta?.instructor_name,
          lesson_type: i.meta?.['lesson_type'],
          children: i.meta?.['children'],
          isSummaryDay: (i as any).meta?.isSummaryDay,
          isSummarySlot: (i as any).meta?.isSummarySlot,
          isInstructorHeader: (i as any).meta?.isInstructorHeader,
          canCancel: (i as any).meta?.canCancel,
          lesson_occurrence_id: (i as any).meta?.lesson_occurrence_id,
        },
      })),
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

  private applyCurrentView() {
    const api = this.calendarApi;
    if (!api) return;

    const mapped = this.mapView(this.currentView);
    api.changeView(mapped);

    if (
      (this.currentView === 'timeGridDay' ||
        this.currentView === 'timeGridWeek') &&
      this.isToday(api.getDate())
    ) {
      setTimeout(() => api.scrollToTime(this.nowScroll()), 0);
    }
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

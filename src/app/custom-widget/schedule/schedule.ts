// schedule.component.ts
import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  NgZone,
  OnChanges,
  SimpleChanges,
  ViewEncapsulation,            // ← חדש
  AfterViewInit,                 // ← אם תרצי לגלול גם מיד אחרי רנדור ראשון
  HostListener
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';
import { ScheduleItem } from '../../models/schedule-item.model';
import { ChangeDetectorRef } from '@angular/core';


@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.scss'],
  encapsulation: ViewEncapsulation.None          // ← חשוב כדי שה-SCSS יחול על .fc
})
export class ScheduleComponent implements OnChanges, AfterViewInit {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  @Input() items: ScheduleItem[] = [];
  @Input() initialView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' = 'timeGridWeek';
  @Input() rtl = true;
  @Input() locale: any = heLocale;
  @Input() slotMinTime = '07:00:00';
  @Input() slotMaxTime = '21:00:00';
  @Input() allDaySlot = false;

  @Output() eventClick = new EventEmitter<EventClickArg>();
  @Output() dateClick = new EventEmitter<string>();
  @Output() viewRange = new EventEmitter<{ start: string; end: string }>();

  currentView = this.initialView;
  currentDate = '';

  // שעה נוכחית בפורמט FC (HH:MM:SS)
  private nowScroll(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }
  private isToday(d: Date) {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() &&
           d.getMonth() === t.getMonth() &&
           d.getDate() === t.getDate();
  }

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: this.initialView,
    locale: this.locale,
    direction: this.rtl ? 'rtl' : 'ltr',
    headerToolbar: false,
    height: 'auto',
    slotMinTime: this.slotMinTime,
    slotMaxTime: this.slotMaxTime,
    allDaySlot: this.allDaySlot,

    nowIndicator: true,                     // ← אינדיקטור "עכשיו"
    scrollTime: this.nowScroll(),           // ← מיקוד ראשוני
    slotDuration: '00:30:00',

    events: [],
    dateClick: (info: DateClickArg) => this.dateClick.emit(info.dateStr),
    eventClick: (arg: EventClickArg) => this.eventClick.emit(arg),

    // צ'יפ/מבנה כרטיס לאירוע
    eventContent: (arg) => {
      const { event } = arg;
      const status = event.extendedProps['status'] || '';                 // 'canceled'/'therapeutic' ...
      const type   = event.extendedProps['type']   || '';                 // אופציונלי
      const chip   = type ? `<span class="chip">${type}</span>` : '';
      return {
        html: `<div class="event-box ${status}">
                 <div class="time">${event.start?.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
                 <div class="title">${event.title}</div>
                 ${chip}
               </div>`
      };
    },
     eventDidMount: (info) => {
    // קראי את הצבע מהאירוע/extendedProps:
    const bg = (info.event as any).backgroundColor || info.event.extendedProps['_bg'];
    const br = (info.event as any).borderColor     || info.event.extendedProps['_border'] || bg;
    if (bg) {
      // חשוב: נצבע inline עם !important כדי לנצח רקע קבוע ב-CSS
      info.el.style.setProperty('background-color', bg, 'important');
      info.el.style.setProperty('border-color', br, 'important');
      // אופציונלי: אם הטקסט כהה מדי/בהיר מדי – אפשר גם:
      // info.el.style.setProperty('color', '#1f2937', 'important');
    }
  },

    // datesSet: (info: DatesSetArg) => {
    //   this.ngZone.run(() => {
    //     // עדכון כותרת
    //     this.currentDate = info.view.title;
    //     // בכל ניווט לתאריך שהוא היום – לגלול לשעה הנוכחית
    //     // (רלוונטי לתצוגות timeGrid)
    //     const api = this.calendarApi;
    //     if (api && (info.view.type === 'timeGridDay' || info.view.type === 'timeGridWeek')) {
    //       if (this.isToday(api.getDate())) {
    //         setTimeout(() => api.scrollToTime(this.nowScroll()), 0);
    //       }
    //     }
    //   });
    // }
     datesSet: (info: DatesSetArg) => {
    // דחייה לטיק הבא – נמנע NG0100
    setTimeout(() => {
       const start = info.start;         // Date
      const endExclusive = info.end;    // Date (exclusive)
      const endInclusive = new Date(endExclusive);
      endInclusive.setDate(endInclusive.getDate() - 1);

      const toYMD = (d: Date) => d.toISOString().slice(0, 10);
      this.viewRange.emit({ start: toYMD(start), end: toYMD(endInclusive) });

      this.currentDate = info.view.title;

      // גלילה לשעה הנוכחית (לפי הקוד שלך)
      const api = this.calendarApi;
      if (api && (info.view.type === 'timeGridDay' || info.view.type === 'timeGridWeek')) {
        if (this.isToday(api.getDate())) {
          api.scrollToTime(this.nowScroll());
        }
      }
      // נטריע לאנגולר שסיימנו לעדכן
      this.cdr.detectChanges();
    }, 0);
  }
  };

  constructor(private ngZone: NgZone , private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    // ביטחון גם לאחר הרנדר הראשוני:
    setTimeout(() => {
      if (this.calendarApi && (this.currentView === 'timeGridDay' || this.currentView === 'timeGridWeek')) {
        this.calendarApi.scrollToTime(this.nowScroll());
      }
    }, 0);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['items']) {
      this.calendarOptions = {
        ...this.calendarOptions,
        events: this.items.map(i => ({
          id: i.id,
          title: i.title,
          start: i.start,
          end: i.end,
          backgroundColor: (i as any).backgroundColor ?? (i as any).color,
          borderColor: (i as any).borderColor ?? (i as any).color,
          extendedProps: {
            status: i.status,                   // 'canceled' וכו'
            child_id: i.meta?.child_id,
            child_name: i.meta?.child_name,
            instructor_id: i.meta?.instructor_id,
            instructor_name: i.meta?.instructor_name,
          }
        }))
      };
    }
  }

  get calendarApi() {
    return this.calendarComponent.getApi();
  }

  changeView(view: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay') {
    this.currentView = view;
    this.calendarApi.changeView(view);
    // לגלול אחרי החלפת תצוגה (במידה וזה היום)
    if ((view === 'timeGridDay' || view === 'timeGridWeek') && this.isToday(this.calendarApi.getDate())) {
      setTimeout(() => this.calendarApi.scrollToTime(this.nowScroll()), 0);
    }
  }

  next()  { this.calendarApi.next();  }
  prev()  { this.calendarApi.prev();  }
  today() {
    this.calendarApi.today();
    // מיקוד מיידי לאחר "היום"
    if (this.currentView === 'timeGridDay' || this.currentView === 'timeGridWeek') {
      setTimeout(() => this.calendarApi.scrollToTime(this.nowScroll()), 0);
    }
  }

isFullscreen = false;

toggleFullscreen() {
  this.isFullscreen = !this.isFullscreen;

  // ננעל את גלילת הדף במסך מלא
  document.body.style.overflow = this.isFullscreen ? 'hidden' : '';

  // להתאים את גובה הקלנדר
  const api = this.calendarApi;
  if (api) {
    api.setOption('height', this.isFullscreen ? '100%' : 'auto');
    setTimeout(() => {
      api.updateSize();
      // אם בתצוגת יום/שבוע והיום מוצג – גלילה לשעה הנוכחית
      if ((this.currentView === 'timeGridDay' || this.currentView === 'timeGridWeek')) {
        const d = api.getDate();
        const t = new Date();
        if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) {
          api.scrollToTime(this.nowScroll ? this.nowScroll() : `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:00`);
        }
      }
    }, 0);
  }
}

// יציאה במסך מלא ע"י ESC
@HostListener('document:keydown.escape')
onEsc() {
  if (this.isFullscreen) this.toggleFullscreen();
}

}

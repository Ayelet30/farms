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
  SimpleChanges
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

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.component.scss'],
})
export class ScheduleComponent implements OnChanges {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  @Input() items: ScheduleItem[] = [];
  @Input() initialView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' = 'timeGridWeek';
  @Input() rtl = true;
  @Input() locale: any = heLocale;
  @Input() slotMinTime = '07:00:00';
  @Input() slotMaxTime = '21:00:00';
  @Input() allDaySlot = false;

  // ✅ פולט EventClickArg כדי לשמור על כל המידע של FullCalendar
  @Output() eventClick = new EventEmitter<EventClickArg>();
  @Output() dateClick = new EventEmitter<string>();

  currentView = this.initialView;
  currentDate = '';

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
    events: [],
    dateClick: (info: DateClickArg) => this.dateClick.emit(info.dateStr),
    eventClick: (arg: EventClickArg) => {
      // ✅ שולח את כל ה־arg החוצה
      this.eventClick.emit(arg);
    },
    eventContent: (arg) => {
      const { event } = arg;
      const status = event.extendedProps['status'] || '';
      return {
        html: `<div class="event-box ${status}">
                 <div class="time">${event.start?.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
                 <div class="title">${event.title}</div>
               </div>`
      };
    },
    datesSet: (info: DatesSetArg) => {
      // שימוש ב-setTimeout כדי למנוע ExpressionChangedAfterItHasBeenCheckedError
      this.ngZone.run(() => {
        setTimeout(() => {
          this.currentDate = info.view.title;
        });
      });
    }
  };

  constructor(private ngZone: NgZone) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['items']) {
      this.calendarOptions = {
        ...this.calendarOptions,
        events: this.items.map(i => ({
          id: i.id,
          title: i.title,
          start: i.start,
          end: i.end,
          extendedProps: {
            status: i.status,
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
  }

  next() { this.calendarApi.next(); }
  prev() { this.calendarApi.prev(); }
  today() { this.calendarApi.today(); }
}

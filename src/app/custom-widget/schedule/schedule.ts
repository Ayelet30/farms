import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output,  ViewEncapsulation} from '@angular/core';
import { FormsModule } from '@angular/forms';

// FullCalendar
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';



/** אירוע גנרי שהווידג'ט מצפה לקבל */
export type ScheduleItem = {
  id: string;           // מזהה ייחודי (string)
  title: string;        // כותרת האירוע
  start: string;        // ISO datetime
  end: string;          // ISO datetime
  color?: string;       // צבע רקע/מסגרת
  meta?: any;           // מידע נוסף אופציונלי
};

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ScheduleComponent implements OnChanges {
  /** רשימת אירועים להצגה */
  @Input() items: ScheduleItem[] = [];

  /** תצוגת ברירת מחדל */
  @Input() initialView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' = 'timeGridWeek';

  /** RTL / לוקליזציה / טווח שעות */
  @Input() rtl = true;
  @Input() locale: any = heLocale;
  @Input() slotMinTime = '07:00:00';
  @Input() slotMaxTime = '21:00:00';
  @Input() allDaySlot = false;

  /** האזנות החוצה */
  @Output() eventClick = new EventEmitter<ScheduleItem>();
  @Output() dateClick = new EventEmitter<string>();

  
// eventClassNames: (({ event }) => {}) | undefined
//   const { kind } = event.extendedProps as any;
//   return [ kind === 'therapy' ? 'event-therapy' : 'event-lesson' ];
// },

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: heLocale,
    direction: 'rtl',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    events: [],
    height: 'auto',
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    allDaySlot: false,
    dateClick: (info: DateClickArg) => this.dateClick.emit(info.dateStr),
    eventClick: (arg: EventClickArg) => {
      const found = this.items.find(i => i.id === String(arg.event.id));
      if (found) this.eventClick.emit(found);
    }
  };

  ngOnChanges(): void {
    // מעדכן את האופציות בכל פעם שה־@Input משתנים
    this.calendarOptions = {
      ...this.calendarOptions,
      initialView: this.initialView,
      locale: this.locale,
      direction: this.rtl ? 'rtl' : 'ltr',
      slotMinTime: this.slotMinTime,
      slotMaxTime: this.slotMaxTime,
      allDaySlot: this.allDaySlot,
      events: this.items.map(i => ({
        id: i.id,
        title: i.title,
        start: i.start,
        end: i.end,
        backgroundColor: i.color,
        borderColor: i.color
      }))
    };
  }
  
}



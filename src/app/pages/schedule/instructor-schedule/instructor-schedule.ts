// instructor-schedule.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ScheduleComponent } from '../../../custom-widget/schedule/schedule';

import type { ScheduleItem } from '../../../models/schedule-item.model'

@Component({
  selector: 'schedule-app',
  standalone: true,
  imports: [CommonModule, ScheduleComponent],
  templateUrl: './instructor-schedule.html',
  styleUrls: ['./instructor-schedule.scss'],
})
export class InstructorScheduleComponent {
  items: ScheduleItem[] = [
    {
      time: '10:00 - 11:00',
      date: new Date(),
      child_name: "משה",
      id: "123456789"
    },
    {
      time: '11:00 - 12:00',
      date: new Date(),
      child_name: "שלמה",
      id: "123456789"
    },
    {
      time: '12:00 - 13:00',
      date: new Date(),
      child_name: "עמי",
      id: "123456789"
    }
  ];
}

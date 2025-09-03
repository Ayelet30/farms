// schedule.component.ts
import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScheduleItem } from '../../models/schedule-item.model';

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './schedule.html',
  styleUrls: ['./schedule.css'], // אם אצלך זה styleUrl, אפשר להשאיר, אבל מומלץ styleUrls
})
export class ScheduleComponent {
  @Input() items: ScheduleItem[] = [];
}

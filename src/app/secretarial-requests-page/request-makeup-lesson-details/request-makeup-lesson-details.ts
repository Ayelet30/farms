import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiRequest } from '../../Types/detailes.model';

@Component({
  selector: 'app-request-makeup-lesson-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
   
  `,
})
export class RequestMakeupLessonDetailsComponent {
  @Input() decidedByUid?: string | null;

  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();
}

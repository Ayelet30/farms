import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { AvailabilityTabComponent } from '../../availability-tab/availability-tab'; 

export type InstructorAvailabilityDialogData = {
  instructorIdNumber: string;
  instructorName?: string;
};

@Component({
  selector: 'app-instructor-availability-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, AvailabilityTabComponent],
  templateUrl: './instructor-availability-dialog.component.html',
  styleUrls: ['./instructor-availability-dialog.component.css'],

})
export class InstructorAvailabilityDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: InstructorAvailabilityDialogData,
    private ref: MatDialogRef<InstructorAvailabilityDialogComponent>,
  ) {}

  close() {
    this.ref.close({ refreshed: true });
  }
}

import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export type InstructorDeactivationImpactItem = {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  child_id?: string | null;
  child_name: string;
  parent_name: string;
};

export type InstructorDeactivationImpactDialogData = {
  instructorName: string;
  impactCount: number;
  items: InstructorDeactivationImpactItem[];
};

@Component({
  selector: 'app-instructor-deactivation-impact-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <div class="dialog-shell" dir="rtl">
      <h2 mat-dialog-title>אישור הפיכת מדריך/ה ללא פעיל/ה</h2>

      <mat-dialog-content>
        <p class="lead">
          הפיכת <b>{{ data.instructorName }}</b> ללא פעיל/ה תבטל את השיעורים הבאים:
        </p>

        <div class="count">
          סה"כ שיעורים מושפעים: <b>{{ data.impactCount }}</b>
        </div>

        <div class="table-wrap" *ngIf="data.items?.length; else noItems">
          <table class="impact-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>שעה</th>
                <th>ילד/ה</th>
                <th>הורה</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of data.items">
                <td>{{ item.occur_date }}</td>
                <td>{{ item.start_time }} - {{ item.end_time }}</td>
                <td>{{ item.child_name }}</td>
                <td>{{ item.parent_name }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ng-template #noItems>
          <p>לא נמצאו שיעורים עתידיים מושפעים.</p>
        </ng-template>

        <p class="warn">
          להורים הרלוונטיים יישלח מייל על ביטול השיעורים.
        </p>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="close(false)">ביטול</button>
        <button mat-raised-button color="warn" (click)="close(true)">
          כן, להפוך ללא פעיל/ה
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-shell { min-width: 760px; max-width: 95vw; }
    .lead { margin-bottom: 12px; }
    .count { margin-bottom: 12px; font-weight: 700; }
    .table-wrap {
      max-height: 380px;
      overflow: auto;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .impact-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .impact-table th, .impact-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
      text-align: right;
      white-space: nowrap;
    }
    .impact-table thead th {
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 1;
    }
    .warn {
      margin-top: 10px;
      color: #8a4b00;
      font-weight: 600;
    }
  `]
})
export class InstructorDeactivationImpactDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: InstructorDeactivationImpactDialogData,
    private dialogRef: MatDialogRef<InstructorDeactivationImpactDialogComponent, boolean>
  ) {}

  close(result: boolean): void {
    this.dialogRef.close(result);
  }
}
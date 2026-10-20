
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule],

  template: `
    <div dir="rtl" class="dlg">

      <h3 class="title">{{ data.title }}</h3>

      <pre class="msg">{{ data.message }}</pre>

      <!-- מיקומים בתור - רק כאשר קיימים נתוני דירוג -->
      <div *ngIf="data.queuePosition as queue" class="queue-positions">

        <div class="queue-position-box">
          <div class="queue-position-label">
            מיקום בעדיפות {{ getPriorityName(queue.priority) }}
          </div>

          <div class="queue-position-number">
            {{ queue.priorityPosition }}
          </div>
        </div>

        <div class="queue-position-box">
          <div class="queue-position-label">
            מיקום בתור הכללי
          </div>

          <div class="queue-position-number">
            {{ queue.overallPosition }}
          </div>
        </div>

      </div>

      <p *ngIf="data.queuePosition" class="queue-position-note">
        המיקום בתור אינו מבטיח סדר שיבוץ.
        השיבוץ תלוי בהתאמה למדריך, לסוג הרכיבה ולשעות הזמינות.
      </p>

      <div class="dialog-danger-text" *ngIf="data.dangerText">
        {{ data.dangerText }}
      </div>

      <div class="actions">

        <button
          mat-button
          class="btn-cancel"
          *ngIf="data.showCancel"
          (click)="close(false)">
          {{ data.cancelText }}
        </button>

        <button
          mat-flat-button
          class="btn-ok"
          (click)="close(true)">
          {{ data.okText }}
        </button>

      </div>

    </div>
  `,

  styles: [`
    .dlg {
      padding: 10px 6px;
    }

    .title {
      margin: 0 0 10px;
      font-weight: 800;
    }

    .msg {
      margin: 0 0 16px;
      line-height: 1.8;
      font-weight: 600;
      white-space: pre-wrap;
      font-family: inherit;
      text-align: center;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    /* =====================================
       עיצוב משותף לכפתורים
       ===================================== */

    button.btn-cancel.mat-mdc-button,
    button.btn-ok.mat-mdc-unelevated-button {
      min-width: 90px;
      min-height: 40px;
      padding: 0 16px;

      border-radius: 12px !important;

      font-family: inherit;
      font-weight: 700;

      cursor: pointer;

      transition:
        background-color 0.2s ease,
        border-color 0.2s ease,
        color 0.2s ease;
    }

    /* =====================================
       כפתור ביטול
       ===================================== */

    button.btn-cancel.mat-mdc-button {
      background-color: #f3f6e9 !important;
      border: 1px solid #cfd7b9 !important;
      color: #40552b !important;

      /* מניעת שכבת התכלת של Angular Material */
      --mat-button-text-state-layer-color: transparent;
      --mat-button-text-hover-state-layer-opacity: 0;
      --mat-button-text-focus-state-layer-opacity: 0;
      --mat-button-text-pressed-state-layer-opacity: 0;
    }

    button.btn-cancel.mat-mdc-button:hover {
      background-color: #e1e9cf !important;
      border-color: #a5b784 !important;
      color: #344825 !important;
    }

    button.btn-cancel.mat-mdc-button:active {
      background-color: #d5e1bb !important;
    }

    /* =====================================
       כפתור אישור / שמירה
       ===================================== */

    button.btn-ok.mat-mdc-unelevated-button {
      background-color: #748c40 !important;
      border: 1px solid #748c40 !important;
      color: #ffffff !important;

      --mdc-filled-button-container-color: #748c40;
      --mdc-filled-button-label-text-color: #ffffff;

      /* מניעת שכבת צבע של Angular Material */
      --mat-filled-button-state-layer-color: transparent;
      --mat-filled-button-hover-state-layer-opacity: 0;
      --mat-filled-button-focus-state-layer-opacity: 0;
      --mat-filled-button-pressed-state-layer-opacity: 0;
    }

    button.btn-ok.mat-mdc-unelevated-button:hover {
      background-color: #5f7531 !important;
      border-color: #5f7531 !important;
      color: #ffffff !important;
    }

    button.btn-ok.mat-mdc-unelevated-button:active {
      background-color: #4f6328 !important;
      border-color: #4f6328 !important;
    }

    /* =====================================
       הודעת אזהרה
       ===================================== */

    .dialog-danger-text {
      margin-top: 14px;
      color: #dc2626;
      font-weight: 800;
      text-align: center;
      font-size: 16px;
      white-space: pre-wrap;
      line-height: 1.8;
    }

    /* =====================================
       מיקומים בתור
       ===================================== */

    .queue-positions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0 14px;
    }

    .queue-position-box {
      background: #f3f6e9;
      border: 1px solid #cfd7b9;
      border-radius: 14px;
      padding: 14px 8px;
      text-align: center;
      min-width: 0;
    }

    .queue-position-label {
      color: #6e7462;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.5;
      margin-bottom: 8px;
    }

    .queue-position-number {
      color: #2f3a28;
      font-size: 32px;
      font-weight: 800;
      line-height: 1.2;
    }

    .queue-position-note {
      color: #6e7462;
      font-size: 12px;
      line-height: 1.7;
      text-align: center;
      margin: 0 0 20px;
    }
  `],
})
export class ConfirmDialogComponent {

  private ref = inject(MatDialogRef<ConfirmDialogComponent>);
  public data = inject<any>(MAT_DIALOG_DATA);

  getPriorityName(priority: number): string {
    switch (priority) {
      case 2:
        return 'גבוהה';
      case 1:
        return 'בינונית';
      case 0:
        return 'נמוכה';
      default:
        return '';
    }
  }

  close(value: boolean): void {
    this.ref.close(value);
  }
}

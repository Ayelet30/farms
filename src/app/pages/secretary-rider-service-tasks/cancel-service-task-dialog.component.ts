import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export type CancelScope = 'task' | 'service';

@Component({
    selector: 'app-cancel-service-task-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule],
    template: `
    <div class="dlg" dir="rtl">
      <h3>ביטול</h3>

      <p class="msg">{{ data.message }}</p>

      <div class="options" *ngIf="data.allowServiceCancel">
        <label>
          <input type="radio" name="scope" value="task" [(ngModel)]="scope" />
          ביטול המשימה בלבד
        </label>

        <label>
          <input type="radio" name="scope" value="service" [(ngModel)]="scope" />
          ביטול כל השירות
        </label>
      </div>

      <label class="note-label">הערת ביטול</label>
      <textarea
        [(ngModel)]="note"
        rows="4"
        placeholder="אפשר להוסיף סיבת ביטול..."
      ></textarea>

      <div class="actions">
        <button mat-button class="btn-cancel" (click)="close()">
          חזרה
        </button>

        <button mat-flat-button class="btn-ok" (click)="confirm()">
          אישור ביטול
        </button>
      </div>
    </div>
  `,
    styles: [`
    .dlg {
      padding: 22px;
      min-width: 420px;
      background: #fffdf8;
      border-radius: 20px;
    }

    h3 {
      margin: 0 0 10px;
      color: #2f4b3a;
      font-size: 24px;
      font-weight: 900;
    }

    .msg {
      margin: 0 0 16px;
      color: #5f6d63;
      font-weight: 700;
      line-height: 1.5;
    }

    .options {
      display: grid;
      gap: 10px;
      margin-bottom: 16px;
    }

    .options label {
      background: #f7f1e4;
      border: 1px solid #eadfca;
      border-radius: 14px;
      padding: 12px;
      font-weight: 800;
      color: #2f4b3a;
      cursor: pointer;
    }

    .note-label {
      display: block;
      margin-bottom: 7px;
      font-weight: 800;
      color: #2f4b3a;
    }

    textarea {
      width: 100%;
      border: 1px solid #d8cfba;
      border-radius: 14px;
      padding: 12px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
    }

    .btn-cancel {
      color: #2f4b3a;
      font-weight: 800;
    }

    .btn-ok {
      background: #b03a3a !important;
      color: white !important;
      border-radius: 12px;
      font-weight: 800;
    }
  `],
})
export class CancelServiceTaskDialogComponent {
    scope: CancelScope = 'task';
    note = '';

    constructor(
        private ref: MatDialogRef<CancelServiceTaskDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: {
            message: string;
            allowServiceCancel: boolean;
        }
    ) { }

    close() {
        this.ref.close(null);
    }

    confirm() {
        this.ref.close({
            scope: this.data.allowServiceCancel ? this.scope : 'task',
            note: this.note.trim() || null,
        });
    }
}
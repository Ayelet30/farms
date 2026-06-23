import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export type TaskPerformerOption = {
    uid: string;
    name: string;
    role: string;
};

export type ServiceTaskActionDialogData = {
    title: string;
    message: string;
    confirmText: string;
    performers: TaskPerformerOption[];
    defaultPerformerUid: string;
    noteLabel?: string;
    notePlaceholder?: string;
};

export type ServiceTaskActionDialogResult = {
    performerUid: string;
    performerName: string;
    note: string | null;
};

@Component({
    selector: 'app-service-task-action-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, MatDialogModule],
    template: `
    <div class="dialog" dir="rtl">
      <h2>{{ data.title }}</h2>

      <p class="message">{{ data.message }}</p>

      <label>
        מבצע הפעולה
        <select [(ngModel)]="performerUid">
          <option value="">בחירה</option>
          <option *ngFor="let p of data.performers" [value]="p.uid">
            {{ p.name }} — {{ p.role }}
          </option>
        </select>
      </label>

      <label>
        {{ data.noteLabel || 'הערה' }}
        <textarea
          rows="4"
          [(ngModel)]="note"
          [placeholder]="data.notePlaceholder || 'אפשר להוסיף הערה...'"
        ></textarea>
      </label>

      <div class="actions">
        <button type="button" class="cancel" (click)="close()">
          ביטול
        </button>

        <button
          type="button"
          class="confirm"
          [disabled]="!performerUid"
          (click)="confirm()"
        >
          {{ data.confirmText }}
        </button>
      </div>
    </div>
  `,
    styles: [`
    .dialog {
      padding: 24px;
      background: #fffdf7;
      color: #263f31;
    }

    h2 {
      margin: 0 0 12px;
      font-size: 24px;
      font-weight: 900;
    }

    .message {
      margin: 0 0 18px;
      color: #6f766f;
      line-height: 1.6;
      font-weight: 700;
    }

    label {
      display: block;
      margin-bottom: 14px;
      font-weight: 800;
      color: #355542;
    }

    select,
    textarea {
      width: 100%;
      margin-top: 7px;
      border: 1px solid #d8cfba;
      border-radius: 12px;
      background: white;
      padding: 10px 12px;
      font: inherit;
      box-sizing: border-box;
    }

    .actions {
      display: flex;
      justify-content: flex-start;
      gap: 10px;
      margin-top: 18px;
    }

    button {
      border-radius: 12px;
      padding: 10px 18px;
      font-weight: 900;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .cancel {
      background: #f1eadb;
      color: #2f4b3a;
      border-color: #d9ccb4;
    }

    .confirm {
      background: #2f6b4f;
      color: white;
    }

    .confirm:disabled {
      opacity: .45;
      cursor: not-allowed;
    }
  `],
})
export class ServiceTaskActionDialogComponent {
    performerUid = '';
    note = '';

    constructor(
        private ref: MatDialogRef<ServiceTaskActionDialogComponent>,
        @Inject(MAT_DIALOG_DATA)
        public data: ServiceTaskActionDialogData
    ) {
        this.performerUid = data.defaultPerformerUid || '';
    }

    close() {
        this.ref.close(null);
    }

    confirm() {
        const performer = this.data.performers.find(p => p.uid === this.performerUid);

        if (!performer) return;

        this.ref.close({
            performerUid: performer.uid,
            performerName: performer.name,
            note: this.note.trim() || null,
        });
    }
}
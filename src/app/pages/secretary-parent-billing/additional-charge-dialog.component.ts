import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export type ChildOption = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  gov_id?: string | null;
};

export type AdditionalChargeDialogData = {
  parentUid: string;
  parentName: string;
  children: ChildOption[];
};

export type AdditionalChargeDialogResult =
  | { saved: false }
  | {
      saved: true;
      amountAgorot: number;
      description: string;
      childId: string;
    };

@Component({
  selector: 'app-additional-charge-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule],
  template: `
    <div class="charge-dialog" dir="rtl">
      <div class="charge-head">
        <div class="charge-title-wrap">
          <div class="charge-title">חיוב נוסף</div>
          <div class="charge-sub">
            יצירת חיוב עבור <b>{{ data.parentName }}</b>
          </div>
        </div>

        <button class="close-btn" type="button" (click)="close()">✕</button>
      </div>

      <div class="charge-body">
        <div class="charge-note">
          החיוב יתווסף לחשבון ההורה וישויך לילד/ה שנבחר/ה.
        </div>

        <div *ngIf="error()" class="charge-error">
          {{ error() }}
        </div>

        <div class="charge-form-card">
          <div class="charge-field">
            <label class="charge-label">בחירת ילד/ה</label>

            <div class="children-grid" *ngIf="data.children?.length; else noChildrenTpl">
              <button
                type="button"
                class="child-card"
                *ngFor="let child of data.children"
                [class.selected]="selectedChildId === child.child_uuid"
                (click)="selectedChildId = child.child_uuid"
              >
                <div class="child-avatar">
                  {{ getInitials(child) }}
                </div>

                <div class="child-info">
                  <div class="child-name">
                    {{ child.first_name || '' }} {{ child.last_name || '' }}
                  </div>
                  <div class="child-id" *ngIf="child.gov_id">
                    ת״ז: {{ child.gov_id }}
                  </div>
                </div>

                <div class="check-mark" *ngIf="selectedChildId === child.child_uuid">
                  ✓
                </div>
              </button>
            </div>

            <ng-template #noChildrenTpl>
              <div class="empty-children">
                לא נמצאו ילדים משויכים להורה הזה.
              </div>
            </ng-template>
          </div>

          <div class="charge-field">
            <label class="charge-label">סכום (₪)</label>
            <input
              class="charge-input"
              [(ngModel)]="amount"
              type="text"
              placeholder="לדוגמה: 120"
            />
          </div>

          <div class="charge-field">
            <label class="charge-label">תיאור החיוב</label>
            <textarea
              class="charge-textarea"
              rows="3"
              [(ngModel)]="description"
              maxlength="120"
              placeholder="לדוגמה: דמי רישום"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="charge-actions">
        <button class="appt-cta ghost" (click)="close()">ביטול</button>
        <button class="appt-cta" (click)="save()">שמירת חיוב</button>
      </div>
    </div>
  `,
  styles: [`
    .charge-dialog {
      width: min(560px, 92vw);
      max-height: min(82vh, 760px);
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #fcfbf8;
      overflow-x: hidden;
    }

    * {
      max-width: 100%;
      box-sizing: border-box;
    }

    .charge-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 8px 4px 0;
    }

    .charge-title {
      font-size: 20px;
      font-weight: 800;
      color: #1f2a2e;
    }

    .charge-sub {
      font-size: 13px;
      color: #5a6a6f;
    }

    .close-btn {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      border: 1px solid rgba(0,0,0,0.1);
      background: white;
      cursor: pointer;
    }

    .charge-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
    }

    .charge-note {
      background: white;
      border-radius: 14px;
      padding: 12px;
      font-size: 13px;
      color: #5a6a6f;
      border: 1px solid rgba(0,0,0,0.08);
    }

    .charge-error {
      background: #fff3f2;
      border: 1px solid rgba(180,35,24,0.15);
      color: #b42318;
      padding: 10px;
      border-radius: 12px;
      font-weight: 600;
    }

    .charge-form-card {
      background: white;
      border-radius: 16px;
      padding: 14px;
      border: 1px solid rgba(0,0,0,0.08);
      display: grid;
      gap: 14px;
    }

    .charge-field {
      display: grid;
      gap: 6px;
    }

    .charge-label {
      font-weight: 700;
      font-size: 13px;
    }

    .children-grid {
      display: grid;
      gap: 8px;
    }

    .child-card {
      width: 100%;
      border: 1px solid rgba(0,0,0,0.10);
      background: #fcfcfc;
      border-radius: 14px;
      padding: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      text-align: right;
      transition: 0.18s ease;
    }

    .child-card:hover {
      background: #f5faf7;
      border-color: rgba(31,122,91,0.28);
    }

    .child-card.selected {
      background: #eef8f3;
      border-color: #1f7a5b;
      box-shadow: 0 0 0 2px rgba(31,122,91,0.08);
    }

    .child-avatar {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      background: #e6eee9;
      color: #1f7a5b;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .child-info {
      flex: 1;
      min-width: 0;
    }

    .child-name {
      font-weight: 800;
      color: #1f2a2e;
    }

    .child-id {
      font-size: 12px;
      color: #6b777b;
      margin-top: 2px;
    }

    .check-mark {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #1f7a5b;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      flex-shrink: 0;
    }

    .empty-children {
      padding: 12px;
      border-radius: 12px;
      background: #fff8e8;
      color: #7a4b00;
      font-size: 13px;
      font-weight: 600;
    }

    .charge-input,
    .charge-textarea {
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.14);
      padding: 10px;
      font-size: 14px;
      background: #fcfcfc;
      width: 100%;
      font: inherit;
    }

    .charge-textarea {
      resize: vertical;
    }

    .charge-actions {
      display: flex;
      gap: 10px;
      padding-top: 12px;
      border-top: 1px solid rgba(0,0,0,0.08);
      background: #faf7ef;
    }

    .appt-cta {
      background: #1f7a5b;
      color: white;
      border: none;
      border-radius: 14px;
      padding: 10px 14px;
      font-weight: 800;
      cursor: pointer;
    }

    .appt-cta.ghost {
      background: #eef1f2;
      color: #1f2a2e;
    }
  `]
})
export class AdditionalChargeDialogComponent {
  amount = '';
  description = '';
  selectedChildId: string | null = null;
  error = signal<string | null>(null);

  constructor(
    private dialogRef: MatDialogRef<AdditionalChargeDialogComponent, AdditionalChargeDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: AdditionalChargeDialogData,
  ) {}

  close() {
    this.dialogRef.close({ saved: false });
  }

  getInitials(child: ChildOption): string {
    const first = child.first_name?.trim()?.[0] ?? '';
    const last = child.last_name?.trim()?.[0] ?? '';
    return `${first}${last}` || 'ילד';
  }

  save() {
    this.error.set(null);

    const amountNumber = Number(String(this.amount).replace(',', '.'));
    const description = this.description.trim();

    if (!this.selectedChildId) {
      this.error.set('יש לבחור ילד/ה עבור החיוב');
      return;
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      this.error.set('יש להזין סכום חיובי תקין');
      return;
    }

    if (!description) {
      this.error.set('יש להזין הסבר לחיוב');
      return;
    }

    this.dialogRef.close({
      saved: true,
      amountAgorot: Math.round(amountNumber * 100),
      description,
      childId: this.selectedChildId,
    });
  }
  
}
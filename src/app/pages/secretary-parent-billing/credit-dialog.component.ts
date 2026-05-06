import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { createParentCredit } from '../../services/supabaseClient.service';

export type ChildOption = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  gov_id?: string | null;
};

export type CreditDialogData = {
  parentUid: string;
  parentName: string;
  relatedChargeId: string | null;
  children: ChildOption[];
};

@Component({
  selector: 'app-credit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule],
  template: `
  <div class="credit-dialog" dir="rtl">
    <div class="credit-head">
      <div class="credit-title-wrap">
        <div class="credit-title">הוספת זיכוי</div>
        <div class="credit-sub">
          יצירת זיכוי עבור <b>{{ data.parentName }}</b>
        </div>
      </div>

      <button class="close-btn" type="button" aria-label="סגירה" title="סגירה" (click)="dialogRef.close()">
        ✕
      </button>
    </div>

    <div class="credit-body">
      <div class="credit-note">
        הזיכוי ישויך לילד/ה שנבחר/ה ויקוזז מהחיוב של ההורה.
      </div>

      <div *ngIf="error()" class="credit-error">
        {{ error() }}
      </div>

      <div class="credit-form-card">
        <div class="credit-field">
          <label class="credit-label">בחירת ילד/ה</label>

          <div class="children-grid" *ngIf="data.children?.length; else noChildrenTpl">
            <button
              type="button"
              class="child-card"
              *ngFor="let child of data.children"
              [class.selected]="selectedChildId() === child.child_uuid"
              (click)="selectedChildId.set(child.child_uuid)"
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

              <div class="check-mark" *ngIf="selectedChildId() === child.child_uuid">
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

        <div class="credit-field">
          <label class="credit-label">סכום הזיכוי (₪)</label>
          <input
            class="credit-input"
            type="number"
            min="0"
            step="0.01"
            [ngModel]="amount()"
            (ngModelChange)="amount.set($event)"
            placeholder="לדוגמה: 50"
          />
        </div>

        <div class="credit-field">
          <label class="credit-label">סיבה לזיכוי</label>
          <textarea
            class="credit-textarea"
            rows="4"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event)"
            placeholder="לדוגמה: שיעור שבוטל באחריות החווה"
          ></textarea>
        </div>
      </div>
    </div>

    <div class="credit-actions">
      <button class="appt-cta ghost" type="button" (click)="dialogRef.close()">
        ביטול
      </button>

      <button class="appt-cta" type="button" [disabled]="saving()" (click)="submit()">
        {{ saving() ? 'שומר...' : 'שמירת זיכוי' }}
      </button>
    </div>
  </div>
`,
  styles: [`
  .credit-dialog {
    width: min(560px, 92vw);
    max-height: min(82vh, 760px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
    background: #fcfbf8;
  }

  * {
    max-width: 100%;
    box-sizing: border-box;
  }

  .credit-head {
    padding: 8px 4px 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }

  .credit-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .credit-title {
    font-size: 20px;
    font-weight: 800;
    color: #1f2a2e;
    line-height: 1.2;
  }

  .credit-sub {
    font-size: 13px;
    color: #5a6a6f;
    line-height: 1.35;
  }

  .close-btn {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid rgba(0,0,0,0.10);
    background: #fff;
    color: #1f2a2e;
    cursor: pointer;
    font-size: 18px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .credit-body {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 2px 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .credit-note {
    background: #fff;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 14px;
    padding: 12px;
    font-size: 13px;
    color: #5a6a6f;
    line-height: 1.5;
  }

  .credit-error {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(180, 35, 24, 0.15);
    background: #fff3f2;
    color: #b42318;
    font-size: 13px;
    font-weight: 600;
  }

  .credit-form-card {
    background: #fff;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 16px;
    padding: 14px;
    display: grid;
    gap: 14px;
  }

  .credit-field {
    display: grid;
    gap: 6px;
  }

  .credit-label {
    font-size: 13px;
    font-weight: 700;
    color: #1f2a2e;
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
    color: #fff;
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

  .credit-input,
  .credit-textarea {
    width: 100%;
    border: 1px solid rgba(0,0,0,0.14);
    border-radius: 12px;
    padding: 10px 12px;
    outline: none;
    font-size: 14px;
    background: #fcfcfc;
    box-sizing: border-box;
    font: inherit;
  }

  .credit-textarea {
    resize: vertical;
    min-height: 96px;
  }

  .credit-actions {
    display: flex;
    justify-content: flex-start;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid rgba(0,0,0,0.08);
    background: #faf7ef;
    flex-shrink: 0;
  }

  .appt-cta {
    border: 0;
    border-radius: 14px;
    padding: 10px 14px;
    font-weight: 800;
    cursor: pointer;
    background: #1f7a5b;
    color: #fff;
    font: inherit;
  }

  .appt-cta.ghost {
    background: #eef1f2;
    color: #1f2a2e;
  }

  .appt-cta:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`]
})
export class CreditDialogComponent {
  amount = signal<string>('');
  reason = signal<string>('');
  selectedChildId = signal<string | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: CreditDialogData,
    public dialogRef: MatDialogRef<CreditDialogComponent>
  ) {}

  getInitials(child: ChildOption): string {
    const first = child.first_name?.trim()?.[0] ?? '';
    const last = child.last_name?.trim()?.[0] ?? '';
    return `${first}${last}` || 'ילד';
  }

  async submit() {
    this.error.set(null);

    const amountStr = String(this.amount() ?? '').trim();
    const reason = this.reason().trim();
    const amountNumber = Number(amountStr.replace(',', '.'));

  const childId = this.selectedChildId();

if (!childId) {
  this.error.set('יש לבחור ילד/ה עבור הזיכוי');
  return;
}
    if (!amountStr || isNaN(amountNumber) || amountNumber <= 0) {
      this.error.set('יש להזין סכום זיכוי חיובי בש"ח');
      return;
    }

    if (!reason) {
      this.error.set('יש להזין סיבה לזיכוי');
      return;
    }

    try {
      this.saving.set(true);

      await createParentCredit({
        parent_uid: this.data.parentUid,
        amount_agorot: Math.round(amountNumber * 100),
        reason,
        related_charge_id: this.data.relatedChargeId,
child_id: childId,      });

      this.dialogRef.close({ saved: true });
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה בשמירת הזיכוי');
    } finally {
      this.saving.set(false);
    }
  }
}
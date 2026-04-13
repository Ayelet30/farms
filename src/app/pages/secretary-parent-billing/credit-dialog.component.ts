import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { createParentCredit } from '../../services/supabaseClient.service';

export type CreditDialogData = {
  parentUid: string;
  parentName: string;
  relatedChargeId: string | null;
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

      <button
        class="close-btn"
        type="button"
        aria-label="סגירה"
        title="סגירה"
        (click)="dialogRef.close()"
      >
        ✕
      </button>
    </div>

    <div class="credit-body">
      <div class="credit-note">
        הזיכוי נרשם כשורת תשלום שלילית ומקוזז מהחיובים הקיימים והעתידיים.
      </div>

      <div *ngIf="error()" class="credit-error">
        {{ error() }}
      </div>

      <div class="credit-form-card">
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
      <button
        class="appt-cta ghost"
        type="button"
        (click)="dialogRef.close()"
      >
        ביטול
      </button>

      <button
        class="appt-cta"
        type="button"
        [disabled]="saving()"
        (click)="submit()"
      >
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
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
  }

  .close-btn:hover {
    background: #f3f5f4;
    border-color: rgba(0,0,0,0.16);
    transform: scale(1.03);
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
    box-sizing: border-box;
  }

  .credit-field {
    display: grid;
    gap: 6px;
  }

  .credit-label {
    display: block;
    font-size: 13px;
    font-weight: 700;
    color: #1f2a2e;
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
    max-width: 100%;
  }

  .credit-input:focus,
  .credit-textarea:focus {
    border-color: rgba(0,0,0,0.28);
    background: #fff;
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
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  .appt-cta:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .appt-cta.ghost {
    background: #eef1f2;
    color: #1f2a2e;
  }

  .appt-cta:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .credit-body::-webkit-scrollbar {
    width: 8px;
  }

  .credit-body::-webkit-scrollbar-thumb {
    background: rgba(0,0,0,0.18);
    border-radius: 8px;
  }
`]
})
export class CreditDialogComponent {
  amount = signal<string>('');
  reason = signal<string>('');
  saving = signal(false);
  error = signal<string | null>(null);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: CreditDialogData,
    public dialogRef: MatDialogRef<CreditDialogComponent>
  ) {}

  async submit() {
    this.error.set(null);

    const amountStr = String(this.amount() ?? '').trim();
    const reason = this.reason().trim();

    const amountNumber = Number(amountStr.replace(',', '.'));

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
      });

      this.dialogRef.close({ saved: true });
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה בשמירת הזיכוי');
    } finally {
      this.saving.set(false);
    }
  }
}
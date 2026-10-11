import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { dbTenant } from '../../services/supabaseClient.service';

export type RiderCreditDialogData = {
    riderUid: string;
    riderName: string;
    relatedChargeId: string;
};

@Component({
    selector: 'app-rider-credit-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule],
    template: `
    <div class="credit-dialog" dir="rtl">
      <div class="credit-head">
        <div>
          <div class="credit-title">הוספת זיכוי</div>
          <div class="credit-sub">יצירת זיכוי עבור <b>{{ data.riderName }}</b></div>
        </div>

        <button class="close-btn" type="button" (click)="dialogRef.close()">✕</button>
      </div>

      <div class="credit-body">
        <div class="credit-note">
          הזיכוי יקוזז מהחיוב של הרוכב העצמאי ויופיע בפירוט החשבונית.
        </div>

        <div *ngIf="error()" class="credit-error">{{ error() }}</div>

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
              placeholder="לדוגמה: שירות שלא בוצע בפועל"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="credit-actions">
        <button class="appt-cta ghost" type="button" (click)="dialogRef.close()">ביטול</button>
        <button class="appt-cta" type="button" [disabled]="saving()" (click)="submit()">
          {{ saving() ? 'שומר...' : 'שמירת זיכוי' }}
        </button>
      </div>
    </div>
  `,
    styles: [`
    .credit-dialog { width:min(560px,92vw); max-height:min(82vh,760px); display:flex; flex-direction:column; gap:14px; overflow:hidden; background:#fcfbf8; }
    * { box-sizing:border-box; max-width:100%; }
    .credit-head { padding:8px 4px 0; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .credit-title { font-size:20px; font-weight:800; color:#1f2a2e; }
    .credit-sub { font-size:13px; color:#5a6a6f; }
    .close-btn { width:36px; height:36px; border-radius:999px; border:1px solid rgba(0,0,0,.1); background:#fff; cursor:pointer; font-size:18px; }
    .credit-body { overflow-y:auto; display:flex; flex-direction:column; gap:12px; }
    .credit-note { background:#fff; border:1px solid rgba(0,0,0,.08); border-radius:14px; padding:12px; font-size:13px; color:#5a6a6f; }
    .credit-error { padding:10px 12px; border-radius:12px; background:#fff3f2; color:#b42318; font-size:13px; font-weight:700; }
    .credit-form-card { background:#fff; border:1px solid rgba(0,0,0,.08); border-radius:16px; padding:14px; display:grid; gap:14px; }
    .credit-field { display:grid; gap:6px; }
    .credit-label { font-size:13px; font-weight:700; color:#1f2a2e; }
    .credit-input, .credit-textarea { width:100%; border:1px solid rgba(0,0,0,.14); border-radius:12px; padding:10px 12px; outline:none; font:inherit; background:#fcfcfc; }
    .credit-textarea { resize:vertical; min-height:96px; }
    .credit-actions { display:flex; gap:10px; padding-top:12px; border-top:1px solid rgba(0,0,0,.08); background:#faf7ef; }
    .appt-cta { border:0; border-radius:14px; padding:10px 14px; font-weight:800; cursor:pointer; background:#1f7a5b; color:#fff; font:inherit; }
    .appt-cta.ghost { background:#eef1f2; color:#1f2a2e; }
    .appt-cta:disabled { opacity:.55; cursor:not-allowed; }
  `]
})
export class RiderCreditDialogComponent {
    amount = signal('');
    reason = signal('');
    saving = signal(false);
    error = signal<string | null>(null);

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: RiderCreditDialogData,
        public dialogRef: MatDialogRef<RiderCreditDialogComponent>
    ) { }

    async submit() {
        this.error.set(null);

        const amountNumber = Number(String(this.amount()).replace(',', '.'));
        const reason = this.reason().trim();

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            this.error.set('יש להזין סכום זיכוי חיובי');
            return;
        }

        if (!reason) {
            this.error.set('יש להזין סיבה לזיכוי');
            return;
        }

        try {
            this.saving.set(true);

            const { error } = await dbTenant().rpc('create_rider_credit', {
                p_charge_id: this.data.relatedChargeId,
                p_amount_agorot: Math.round(amountNumber * 100),
                p_reason: reason,
            });

            if (error) throw error;

            this.dialogRef.close({ saved: true });
        } catch (e: any) {
            this.error.set(e?.message ?? 'שגיאה בשמירת הזיכוי');
        } finally {
            this.saving.set(false);
        }
    }
}
import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { dbTenant } from '../../services/supabaseClient.service';

export type RiderAdditionalChargeDialogData = {
    riderUid: string;
    riderName: string;
    relatedChargeId: string;
};

@Component({
    selector: 'app-rider-additional-charge-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule],
    template: `
    <div class="charge-dialog" dir="rtl">
      <div class="charge-head">
        <div>
          <div class="charge-title">חיוב נוסף</div>
          <div class="charge-sub">יצירת חיוב עבור <b>{{ data.riderName }}</b></div>
        </div>

        <button class="close-btn" type="button" (click)="dialogRef.close()">✕</button>
      </div>

      <div class="charge-body">
        <div class="charge-note">
          החיוב יתווסף לחשבון הרוכב העצמאי ויופיע בפירוט החשבונית.
        </div>

        <div *ngIf="error()" class="charge-error">{{ error() }}</div>

        <div class="charge-form-card">
          <div class="charge-field">
            <label class="charge-label">סכום (₪)</label>
            <input class="charge-input" [(ngModel)]="amount" type="text" placeholder="לדוגמה: 120" />
          </div>

          <div class="charge-field">
            <label class="charge-label">תיאור החיוב</label>
            <textarea
              class="charge-textarea"
              rows="3"
              [(ngModel)]="description"
              maxlength="120"
              placeholder="לדוגמה: שירות נוסף / ציוד / טיפול מיוחד"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="charge-actions">
        <button class="appt-cta ghost" type="button" (click)="dialogRef.close()">ביטול</button>
        <button class="appt-cta" type="button" [disabled]="saving()" (click)="save()">
          {{ saving() ? 'שומר...' : 'שמירת חיוב' }}
        </button>
      </div>
    </div>
  `,
    styles: [`
    .charge-dialog { width:min(560px,92vw); max-height:min(82vh,760px); display:flex; flex-direction:column; gap:14px; background:#fcfbf8; overflow:hidden; }
    * { box-sizing:border-box; max-width:100%; }
    .charge-head { display:flex; justify-content:space-between; align-items:flex-start; padding:8px 4px 0; gap:12px; }
    .charge-title { font-size:20px; font-weight:800; color:#1f2a2e; }
    .charge-sub { font-size:13px; color:#5a6a6f; }
    .close-btn { width:36px; height:36px; border-radius:999px; border:1px solid rgba(0,0,0,.1); background:white; cursor:pointer; }
    .charge-body { display:flex; flex-direction:column; gap:12px; overflow-y:auto; }
    .charge-note { background:white; border-radius:14px; padding:12px; font-size:13px; color:#5a6a6f; border:1px solid rgba(0,0,0,.08); }
    .charge-error { background:#fff3f2; border:1px solid rgba(180,35,24,.15); color:#b42318; padding:10px; border-radius:12px; font-weight:700; }
    .charge-form-card { background:white; border-radius:16px; padding:14px; border:1px solid rgba(0,0,0,.08); display:grid; gap:14px; }
    .charge-field { display:grid; gap:6px; }
    .charge-label { font-weight:700; font-size:13px; }
    .charge-input, .charge-textarea { border-radius:12px; border:1px solid rgba(0,0,0,.14); padding:10px; font-size:14px; background:#fcfcfc; width:100%; font:inherit; }
    .charge-textarea { resize:vertical; }
    .charge-actions { display:flex; gap:10px; padding-top:12px; border-top:1px solid rgba(0,0,0,.08); background:#faf7ef; }
    .appt-cta { background:#1f7a5b; color:white; border:none; border-radius:14px; padding:10px 14px; font-weight:800; cursor:pointer; font:inherit; }
    .appt-cta.ghost { background:#eef1f2; color:#1f2a2e; }
    .appt-cta:disabled { opacity:.55; cursor:not-allowed; }
  `]
})
export class RiderAdditionalChargeDialogComponent {
    amount = '';
    description = '';
    saving = signal(false);
    error = signal<string | null>(null);

    constructor(
        public dialogRef: MatDialogRef<RiderAdditionalChargeDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: RiderAdditionalChargeDialogData,
    ) { }

    async save() {
        this.error.set(null);

        const amountNumber = Number(String(this.amount).replace(',', '.'));
        const description = this.description.trim();

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            this.error.set('יש להזין סכום חיובי תקין');
            return;
        }

        if (!description) {
            this.error.set('יש להזין הסבר לחיוב');
            return;
        }

        try {
            this.saving.set(true);

            const { error } = await dbTenant().rpc('create_rider_additional_charge_item', {
                p_charge_id: this.data.relatedChargeId,
                p_amount_agorot: Math.round(amountNumber * 100),
                p_description: description,
            });

            if (error) throw error;

            this.dialogRef.close({ saved: true });
        } catch (e: any) {
            this.error.set(e?.message ?? 'שגיאה בשמירת החיוב');
        } finally {
            this.saving.set(false);
        }
    }
}
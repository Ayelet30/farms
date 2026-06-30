import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

type PaymentMethod = 'credit_card' | 'cash' | 'bank_transfer' | 'check';

@Component({
  selector: 'app-collect-payments-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dialog" dir="rtl">
      <h2>גביית חיובים</h2>

      <div class="row" *ngFor="let row of rows">
        <div class="info">
          <b>{{ row.parentName }}</b>
          <span>{{ row.amountAgorot / 100 | number:'1.2-2' }} ₪</span>
        </div>

        <select [(ngModel)]="row.paymentMethod">
          <option value="credit_card" [disabled]="!row.hasPaymentMethod || row.hasExpiredPaymentMethod">
            אשראי
          </option>
          <option value="cash">מזומן</option>
          <option value="bank_transfer">העברה בנקאית</option>
          <option value="check">שיק</option>
        </select>

    <input
  class="reference-input"
  *ngIf="row.paymentMethod === 'bank_transfer'"
  [(ngModel)]="row.reference"
  placeholder="מספר אסמכתא"
/>

       <input
  class="reference-input"
  *ngIf="row.paymentMethod === 'check'"
  [(ngModel)]="row.checkNumber"
  placeholder="מספר שיק"
/>
        <label class="invoice-check">
          <input type="checkbox" [(ngModel)]="row.shouldCreateInvoice" />
          להפיק חשבונית/קבלה
        </label>
      </div>

      <div class="error" *ngIf="error()">{{ error() }}</div>

      <div class="actions">
        <button type="button" (click)="close()">ביטול</button>
        <button type="button" class="primary" (click)="confirm()">בצע גבייה</button>
      </div>
    </div>
  `,
  styles: [`
    .dialog {
      padding: 24px;
      font-family: Heebo, Arial, sans-serif;
    }

    h2 {
      margin: 0 0 18px;
    }

    .row {
      display: grid;
grid-template-columns: 1.3fr 1fr 180px 1fr;      gap: 10px;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }

    .info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    select,
    input {
      height: 38px;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 0 10px;
      box-sizing: border-box;
      min-width: 0;
    }
.reference-input {
  width: 180px;
  min-width: 180px;
}
    .invoice-check {
      display: flex;
      gap: 6px;
      align-items: center;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      justify-content: flex-start;
      gap: 10px;
      margin-top: 20px;
      direction: ltr;
    }

    button {
      border-radius: 8px;
      border: 1px solid #333;
      padding: 8px 16px;
      font-weight: 700;
      cursor: pointer;
    }

    .primary {
      background: #333;
      color: white;
    }

    .error {
      margin-top: 12px;
      color: #b42318;
      font-weight: 700;
    }
  `],
})
export class CollectPaymentsDialogComponent {
  error = signal<string | null>(null);
  rows: any[];

  constructor(
    private ref: MatDialogRef<CollectPaymentsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.rows = (data.charges ?? []).map((c: any) => ({
      ...c,
      paymentMethod: c.hasPaymentMethod && !c.hasExpiredPaymentMethod ? 'credit_card' : 'cash',
      reference: '',
      checkNumber: '',
      shouldCreateInvoice: true,
    }));
  }

  close() {
    this.ref.close(null);
  }

  confirm() {
    for (const row of this.rows) {
      if (row.paymentMethod === 'bank_transfer' || row.paymentMethod === 'check') {
        if (row.paymentMethod === 'bank_transfer' && !String(row.reference || '').trim()) {
          this.error.set('חובה להזין מספר אסמכתא עבור העברה בנקאית');
          return;
        }
      }

      if (row.paymentMethod === 'check' && !String(row.checkNumber || '').trim()) {
        this.error.set('חובה להזין מספר שיק');
        return;
      }
    }

    this.ref.close({
      confirmed: true,
      rows: this.rows.map(row => ({
        ...row,
        reference: String(row.reference || '').trim() || null,
        checkNumber: String(row.checkNumber || '').trim() || null,
      })),
    });
  }
}
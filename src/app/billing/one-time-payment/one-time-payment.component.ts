import {
  Component,
  AfterViewInit,
  OnInit,
  signal,
  inject,          // ← להוסיף
} from '@angular/core';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranzilaService } from '../../services/tranzila.service';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { BookingPayload } from '../../pages/booking/booking.component';
import { CommonModule } from '@angular/common';



declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
  onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
};

type Product = {
  id: string;
  name: string;
  amountAgorot: number;
};

@Component({
  standalone: true,
  selector: 'app-one-time-payment',
  imports: [CommonModule, FormsModule, MatDialogModule],
  templateUrl: './one-time-payment.component.html',
  styleUrls: ['./one-time-payment.component.scss'],
})
export class OneTimePaymentComponent implements OnInit, AfterViewInit {

  type = '';
  booking: BookingPayload | null = null;
  product: Product | null = null;
  successTx: any | null = null;


  private hfFields: HostedFieldsInstance | null = null;
  busy = signal(false);
  error = signal<string | null>(null);

  // במקום constructor – הזרקות בעזרת inject()
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tranzila = inject(TranzilaService);
  private cu = inject(CurrentUserService);
  private dialogRef = inject(MatDialogRef<OneTimePaymentComponent>, { optional: true });
  private dialogData = inject(MAT_DIALOG_DATA, { optional: true }) as
    | { booking?: BookingPayload }
    | null;

  parentEmail = this.cu.current?.email ?? '';
  thtk: string | null = null;

  private readonly allProducts: Product[] = [
    { id: 'western', name: 'רכיבה מערבית', amountAgorot: 12000 },
    { id: 'therapy', name: 'רכיבה טיפולית', amountAgorot: 15000 },
  ];


    ngOnInit(): void {
      console.log('000000000',this.cu.current)  ;
    // 1. אם נפתח כדיאלוג – יש לנו booking ב-data
    if (this.dialogData?.booking) {
      this.booking = this.dialogData.booking;
      this.type = this.booking.type;
    } else {
      // 2. מצב ניווט רגיל דרך ראוטר (כמו שהיה)
      this.type = this.route.snapshot.paramMap.get('productId') ?? 'western';

      const state: any = history.state;
      if (state?.booking) {
        this.booking = state.booking as BookingPayload;
      }
    }

    // fallback – אם מישהו הגיע ישירות ל-URL
    this.product = this.allProducts.find(p => p.id === this.type) ?? null;

    if (!this.booking && !this.product) {
      this.error.set('מוצר לא נמצא');
    }
  }


  get displayName(): string {
    return this.booking?.productName || this.product?.name || 'תשלום חד־פעמי';
  }

  get amountAgorot(): number {
    if (this.booking) return this.booking.amountAgorot;
    if (this.product) return this.product.amountAgorot;
    return 100; // fallback – 1 ₪
  }

  get amountNis(): string {
    return (this.amountAgorot / 100).toFixed(2);
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      const { thtk } = await this.tranzila.getHandshakeToken();
      this.thtk = thtk;
      this.initHostedFields();
    } catch (e: any) {
      console.error('[one-time] handshake error', e);
      this.error.set(e?.message ?? 'שגיאה באתחול תשלום');
    }
  }

 private initHostedFields() {
  if (!TzlaHostedFields) {
    console.error('TzlaHostedFields not found');
    this.error.set('רכיב התשלום לא נטען');
    return;
  }

  this.hfFields = TzlaHostedFields.create({
    sandbox: false,
    fields: {
      credit_card_number: {
        selector: '#ot_credit_card_number',
        placeholder: '4580 4580 4580 4580',
        tabindex: 1,
      },
      cvv: {
        selector: '#ot_cvv',
        placeholder: '123',
        tabindex: 2,
      },
      expiry: {
        selector: '#ot_expiry',
        placeholder: '12/26',
        version: '1',
      },
    },
    styles: {
      input: {
        height: '38px',
        'line-height': '38px',
        padding: '0 8px',
        'font-size': '15px',
        'box-sizing': 'border-box',
      },
      select: {
        height: '38px',
        'line-height': '38px',
        padding: '0 8px',
        'font-size': '15px',
        'box-sizing': 'border-box',
      },
    },
  });

  this.hfFields!.onEvent?.('validityChange', (ev: any) => {
    console.log('[one-time HF validity]', ev);
  });
}


  onSubmit(ev: Event) {
    ev.preventDefault();
    this.charge();
  }

    async charge() {
    if (!this.hfFields) {
      this.error.set('שדות התשלום לא מוכנים');
      return;
    }
    if (!this.thtk) {
      this.error.set('אסימון תשלום (thtk) חסר');
      return;
    }

    const amount = this.amountNis;
    const terminalName = 'moachapp';

    console.log('[one-time] charge', this.displayName, amount);

    try {
      this.busy.set(true);
      this.error.set(null);

      this.hfFields.charge(
  {
    terminal_name: terminalName,
    amount,
    thtk: this.thtk,
    currency_code: 'ILS',
    contact: this.booking?.fullName || this.parentEmail || undefined,
    email: this.booking?.email || this.parentEmail || undefined,
    requested_by_user: this.parentEmail || 'one-time-checkout',
    response_language: 'hebrew',
  },
  async (err: any, response: any) => {
    console.log('[one-time HF] err=', err, 'resp=', response);

    if (err && err.messages?.length) {
      err.messages.forEach((msg: any) => {
        const el = document.getElementById('ot_errors_for_' + msg.param);
        if (el) el.textContent = msg.message;
      });
      this.error.set('שגיאה בפרטי הכרטיס');
      this.busy.set(false);
      return;
    }

    const tx = response?.transaction_response;
    if (!tx || !tx.success) {
      this.error.set(tx?.error || 'התשלום נכשל');
      this.busy.set(false);
      return;
    }

    // ✅ עדכון UI – הצגת חיווי הצלחה
    this.successTx = tx;

    // ✅ שליחת התשלום ל-DB
    try {
      const parentUid = this.cu.current?.uid ? this.cu.current.uid : "1111111111111111111111";
      const farmId = this.booking?.farmId ?? (this.cu.current as any)?.farm_id;

      console.log('111111111 parentUid=',this.cu.current, parentUid, ' farmId=', farmId);
      if (parentUid) {
        await this.tranzila.recordOneTimePayment({
          parentUid,
          amountAgorot: this.amountAgorot,
          tx,
        });
      } else {
        console.warn('[one-time] no parentUid – לא נשמר ל-DB');
      }
    } catch (saveErr) {
      console.error('[one-time] failed to save payment in DB', saveErr);
      // אפשר להחליט אם להראות שגיאה קטנה, אבל לא נכשיל את תצוגת ההצלחה
    }

    this.busy.set(false);

    if (this.dialogRef) {
      this.dialogRef.close(tx);
    } else {
      this.router.navigate(['/booking', this.type], {
        state: {
          booking: this.booking,
          tx,
        },
      });
    }
  },
);
    } catch (e: any) {
      console.error('[one-time] charge error', e);
      this.error.set(e?.message ?? 'שגיאה בתשלום');
      this.busy.set(false);
    } 
  }

  onCancel() {
    if (this.dialogRef) {
      this.dialogRef.close(null);
    }
  }
  

}

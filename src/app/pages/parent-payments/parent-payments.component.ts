// app/billing/parent-payments.component.ts
import { Component, Input, effect, signal, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranzilaService } from '../../services/tranzila.service';
import { PaymentsService } from '../../services/payments.service';
import { Router } from '@angular/router';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { TokensService } from '../../services/tokens.service';

type ProfileVM = {
  id: string;
  brand: string | null;
  last4: string | null;
  is_default: boolean;
  created_at: string;
};

type ChargeVM = {
  id: string;
  sumNis: string;
  status: string;
  created_at: string;
  provider_id: string | null;
};

declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
  onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
};

@Component({
  selector: 'app-parent-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-payments.component.html',
  styleUrls: ['./parent-payments.component.scss'],
})
export class ParentPaymentsComponent implements OnInit, AfterViewInit {
  // נשאר כמו אצלך – רק ודאויות אתחול לטובת strict
  parentUid: string = '';
  parentEmail: string = '';

  hfAmountAgorot = 0;
  hfEmail = '';
  private hfFields: HostedFieldsInstance | null = null;
  busyHosted = signal(false);

  // לשימוש חד-פעמי עבור חיוב מבחן/חד פעמי
  amountAgorot = 0;

  loading = signal(true);
  busyAdd = signal(false);
  busyCharge = signal(false);
  profiles = signal<ProfileVM[]>([]);
  charges = signal<ChargeVM[]>([]);
  error = signal<string | null>(null);

  constructor(
    private tranzila: TranzilaService,
    private pagos: PaymentsService,
    private _router: Router, // נשמר (גם אם לא בשימוש כעת)
    private cu: CurrentUserService,
    private _tokens: TokensService, // נשמר (גם אם לא בשימוש כעת)
  ) {
    const cur = this.cu.current;
    const details = this.cu.snapshot;

    this.parentUid = cur?.uid ?? '';
    this.parentEmail = cur?.email ?? '';

    console.log('ParentPayments: uid=', this.parentUid, ' email=', this.parentEmail);
  }

  async ngOnInit() {
    try {
      if (!this.parentUid) throw new Error('missing uid');
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'failed to init');
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit() {
    try {
      // קורא לפונקציה בענן כדי לקבל thtk
      const { thtk } = await this.tranzila.getHandshakeToken();
      this.initHostedFields(thtk);
    } catch (e) {
      console.error('[HF] init error', e);
    }
  }

  async refresh() {
    try {
      const [p, c] = await Promise.all([
        this.pagos.listProfiles(this.parentUid),
        this.pagos.listCharges(this.parentUid, 20),
      ]);

      this.profiles.set(
        p.map((x) => ({
          id: x.id,
          brand: x.brand,
          last4: x.last4,
          is_default: x.is_default,
          created_at: new Date(x.created_at).toLocaleString('he-IL'),
        })),
      );

      this.charges.set(
        c.map((x) => ({
          id: x.id,
          sumNis: (x.amount_agorot / 100).toFixed(2) + ' ₪',
          status: x.status,
          provider_id: x.provider_id,
          created_at: new Date(x.created_at).toLocaleString('he-IL'),
        })),
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'load failed');
    }
  }

  private genOrderId(): string {
    try {
      // @ts-ignore
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        // @ts-ignore
        return 'ord_' + crypto.randomUUID();
      }
    } catch {}
    return 'ord_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  }

  async addPaymentMethod() {
    if (!this.parentUid || !this.parentEmail) return;
    try {
      this.busyAdd.set(true);
      const orderId = this.genOrderId();

      const url = await this.tranzila.createHostedUrl({
        uid: this.parentUid,
        email: this.parentEmail,
        amountAgorot: 100, // 1.00 ₪ – טוקניזציה/אימות לפי ההגדרה במסוף
        orderId,
        successPath: '/billing/success',
        failPath: '/billing/error',
      });

      window.location.href = url;
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to open Tranzila hosted');
    } finally {
      this.busyAdd.set(false);
    }
  }

  async setDefault(profileId: string) {
    try {
      await this.pagos.setDefault(profileId, this.parentUid);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to set default');
    }
  }

  async deactivate(profileId: string) {
    try {
      await this.pagos.deactivate(profileId);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to deactivate');
    }
  }

  async testCharge() {
    if (!this.amountAgorot || this.amountAgorot <= 0) {
      this.error.set('אנא הזיני סכום באגורות גדול מ-0');
      return;
    }
    try {
      this.busyCharge.set(true);
      await this.tranzila.chargeByToken({
        parentUid: this.parentUid,
        amountAgorot: this.amountAgorot,
        currency: 'ILS',
      });
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Charge failed');
    } finally {
      this.busyCharge.set(false);
    }
  }

  private initHostedFields(thtk: string) {
    if (!TzlaHostedFields) {
      console.error('TzlaHostedFields global not found');
      return;
    }

    this.hfFields = TzlaHostedFields.create({
      sandbox: false,
      fields: {
        credit_card_number: {
          selector: '#credit_card_number',
          placeholder: '4580 4580 4580 4580',
          tabindex: 1,
        },
        cvv: {
          selector: '#hf_cvv',
          placeholder: '123',
          tabindex: 2,
        },
        expiry: {
          selector: '#hf_expiry',
          placeholder: '12/26',
          version: '1',
        },
      },
      styles: {
        input: { height: 'auto', width: '100%' },
        select: { height: 'auto', width: '100%' },
      },
    });

    this.hfFields!.onEvent?.('validityChange', (ev: any) => {
      console.log('[HF validity]', ev);
    });

    // נשמור את ה-thtk שקיבלנו מהHandshake
    (this.hfFields as any)._thtk = thtk;
  }

  onHostedFormSubmit(ev: Event) {
    console.log('!!!!!!!! form submit');
    ev.preventDefault();
    this.directChargeWithHosted();
  }

  async directChargeWithHosted() {
    if (!this.hfFields) {
      console.error('Hosted fields not initialized');
      this.error.set('שדה כרטיס אשראי לא מוכן');
      return;
    }
    if (!this.hfAmountAgorot || this.hfAmountAgorot <= 0) {
      console.error('Invalid amount');
      this.error.set('אנא הזיני סכום באגורות גדול מ-0');
      return;
    }

    console.log('[directChargeWithHosted] amountAgorot=', this.hfAmountAgorot);
    try {
      this.busyHosted.set(true);

      const amount = (this.hfAmountAgorot / 100).toFixed(2); // ₪
      const thtk = (this.hfFields as any)._thtk;
      console.log('[HF charge] amount=', amount, ' thtk=', thtk);
      if (!thtk) {
        throw new Error('Handshake token (thtk) missing');
      }

      const terminalName = 'moachapp'; // ← שם המסוף שלך

      this.hfFields.charge(
        {
          // חובה לפי התיעוד
          terminal_name: terminalName,
          amount,
          thtk,

          // אופציונלי
          currency_code: 'ILS',
          contact: this.hfEmail || this.parentEmail,
          email: this.hfEmail || this.parentEmail,
          requested_by_user: this.parentEmail || 'smart-farm-parent',
          response_language: 'hebrew',
          tokenize: true, // אם מוגדר במסוף
        },
        async (err: any, response: any) => {
          console.log('[HF charge] err=', err, ' response=', response);

          if (err && err.messages?.length) {
            err.messages.forEach((msg: any) => {
              const el = document.getElementById('errors_for_' + msg.param);
              if (el) el.textContent = msg.message;
            });
            this.error.set('שגיאה בנתוני הכרטיס');
            this.busyHosted.set(false);
            return;
          }

          const tx = response?.transaction_response;
          if (!tx || !tx.success) {
            this.error.set(tx?.error || 'התשלום נכשל');
            this.busyHosted.set(false);
            return;
          }

          // כאן יש tx + token אם tokenize=true – אפשר לשמור בשרת

          await this.refresh();
          this.error.set(null);
          this.busyHosted.set(false);
        },
      );
    } catch (e: any) {
      console.error('[directChargeWithHosted] error', e);
      this.error.set(e?.message ?? 'HF charge failed');
      this.busyHosted.set(false);
    }
  }
}

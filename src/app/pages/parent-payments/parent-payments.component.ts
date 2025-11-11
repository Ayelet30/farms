// app/billing/parent-payments.component.ts
import { Component, Input, effect, signal, OnInit } from '@angular/core';
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

@Component({
  selector: 'app-parent-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-payments.component.html',
  styleUrls: ['./parent-payments.component.scss']
})
export class ParentPaymentsComponent implements OnInit {
  // נשאר כמו אצלך – רק ודאויות אתחול לטובת strict
  parentUid: string = '';
  parentEmail: string = '';

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
    private _router: Router,               // נשמר (גם אם לא בשימוש כעת)
    private cu: CurrentUserService,
    private _tokens: TokensService         // נשמר (גם אם לא בשימוש כעת)
  ) {
    // נשאר בדיוק לפי הקוד שלך
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

  async refresh() {
    try {
      const [p, c] = await Promise.all([
        this.pagos.listProfiles(this.parentUid),
        this.pagos.listCharges(this.parentUid, 20)
      ]);

      this.profiles.set(
        p.map(x => ({
          id: x.id,
          brand: x.brand,
          last4: x.last4,
          is_default: x.is_default,
          created_at: new Date(x.created_at).toLocaleString('he-IL')
        }))
      );

      this.charges.set(
        c.map(x => ({
          id: x.id,
          sumNis: (x.amount_agorot / 100).toFixed(2) + ' ₪',
          status: x.status,
          provider_id: x.provider_id,
          created_at: new Date(x.created_at).toLocaleString('he-IL')
        }))
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'load failed');
    }
  }

  private genOrderId(): string {
    // החלפה עדינה – אם יש crypto בדפדפן נקבל מזהה יציב יותר
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

      // תואם בדיוק ל-TranzilaService.createHostedUrl שלך
      const url = await this.tranzila.createHostedUrl({
        uid: this.parentUid,
        email: this.parentEmail,
        amountAgorot: 100,            // 1.00 ₪ – טוקניזציה/אימות לפי ההגדרה במסוף
        orderId,
        successPath: '/billing/success',
        failPath: '/billing/error'
      });

      // שומר על ההתנהגות שלך: מעבר מלא לדף הסליקה
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
      // תואם ל-TranzilaService.chargeByToken שלך
      await this.tranzila.chargeByToken({
        parentUid: this.parentUid,
        amountAgorot: this.amountAgorot,
        currency: 'ILS'
      });
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Charge failed');
    } finally {
      this.busyCharge.set(false);
    }
  }
}

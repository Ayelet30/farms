// app/billing/parent-payments.component.ts
import { Component, Input, effect, signal } from '@angular/core';
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
export class ParentPaymentsComponent {
  // אם יש לך CurrentUserService/tenant – אפשר להחליף את ה־@Input
  parentUid: string | undefined;
  parentEmail: string | undefined;
  farmId: string | undefined;

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
    private router: Router,
    private cu: CurrentUserService,
    private tokens: TokensService
  ) {
     const cur = this.cu.current;            // מתוך CurrentUser
    const details = this.cu.snapshot;       // מתוך userDetails$

    this.farmId = details?.farm_id !== undefined ? String(details.farm_id) : "";
    this.parentUid = cur?.uid ?? '';
    this.parentEmail = cur?.email ?? '';  

    console.log('ParentPayments: uid=', this.parentUid, ' email=', this.parentEmail, ' farmId=', this.farmId);
  }

  async ngOnInit() {
    try {
      if (!this.parentUid || !this.farmId) throw new Error('missing uid/farmId');
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message ?? 'failed to init');
    } finally {
      this.loading.set(false);
    }
  }

  async refresh() {
    const [p, c] = await Promise.all([
      this.pagos.listProfiles(this.parentUid!, this.farmId!),
      this.pagos.listCharges(this.parentUid!, this.farmId!, 20)
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
  }

  private genOrderId(): string {
    return 'ord_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  }

  async addPaymentMethod() {
    if (!this.parentUid || !this.parentEmail || !this.farmId) return;
    try {
      this.busyAdd.set(true);
      const orderId = this.genOrderId();
      // סכום סמלי (100 אג') לצורך טוקניזציה/אימות – עדכני לפי מסוף
      const url = await this.tranzila.createHostedUrl({
        uid: this.parentUid,
        email: this.parentEmail,
        farmId: this.farmId,
        amountAgorot: 100,
        orderId,
        successPath: '/billing/success',
        failPath: '/billing/error'
      });

      // העדפה: פתיחה באותו חלון – בטוח יותר עבור חזרות/Redirects
      window.location.href = url;
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to open Tranzila hosted');
    } finally {
      this.busyAdd.set(false);
    }
  }

  async setDefault(profileId: string) {
    try {
      await this.pagos.setDefault(profileId, this.parentUid!, this.farmId!);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to set default');
    }
  }

  async deactivate(profileId: string) {
    try {
      await this.pagos.deactivate(profileId);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to deactivate');
    }
  }

  async testCharge() {
    if (!this.amountAgorot || this.amountAgorot <= 0) return;
    try {
      this.busyCharge.set(true);
      await this.tranzila.chargeByToken({
        parentUid: this.parentUid!,
        farmId: this.farmId!,
        amountAgorot: this.amountAgorot,
        currency: 'ILS'
      });
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message ?? 'Charge failed');
    } finally {
      this.busyCharge.set(false);
    }
  }
}

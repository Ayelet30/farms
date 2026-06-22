import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranzilaService } from '../../services/tranzila.service';
import { CurrentUserService } from '../../core/auth/current-user.service';
import {
  dbTenant,
  getCurrentFarmMetaSync,
} from '../../services/supabaseClient.service';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';

declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
  onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
};

type ProfileVM = {
  id: string;
  brand: string | null;
  last4: string | null;
  is_default: boolean;
  created_at: string;
  expiry_month?: number | null;
  expiry_year?: number | null;
};

type PaymentVM = {
  id: string;
  amountNis: string;
  date: string;
  status: string;
  method: string | null;
  invoice_url: string | null;
};

@Component({
  selector: 'app-independent-rider-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './independent-rider-payments.html',
  styleUrls: ['./independent-rider-payments.css'],
})
export class IndependentRiderPaymentsComponent implements OnInit {
  riderUid = '';
  riderEmail = '';

  loading = signal(true);
  error = signal<string | null>(null);

  profiles = signal<ProfileVM[]>([]);
  payments = signal<PaymentVM[]>([]);

  addCardOpen = signal(false);
  savingToken = signal(false);
  tokenSaved = signal(false);
  tokenError = signal<string | null>(null);

  private hfAdd: HostedFieldsInstance | null = null;
  private thtkAdd: string | null = null;
  private hfInitTried = false;

  constructor(
    private tranzila: TranzilaService,
    private cu: CurrentUserService,
    private tenantBoot: TenantBootstrapService,
  ) {
    const cur = this.cu.current;
    this.riderUid = cur?.uid ?? '';
    this.riderEmail = cur?.email ?? '';
  }

  async ngOnInit() {
    try {
      if (!this.riderUid) throw new Error('לא זוהה רוכב עצמאי מחובר');
      await this.refreshAll();
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה בטעינת נתוני תשלום');
    } finally {
      this.loading.set(false);
    }
  }

  async refreshAll() {
    await Promise.all([
      this.refreshProfiles(),
      this.refreshPayments(),
    ]);
  }

  private async refreshProfiles() {
    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('independent_rider_payment_profiles')
      .select('id,brand,last4,is_default,created_at,expiry_month,expiry_year')
      .eq('rider_uid', this.riderUid)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;

    this.profiles.set(
      (data ?? []).map((x: any) => ({
        id: x.id,
        brand: x.brand ?? null,
        last4: x.last4 ?? null,
        is_default: !!x.is_default,
        created_at: new Date(x.created_at).toLocaleString('he-IL'),
        expiry_month: x.expiry_month ?? null,
        expiry_year: x.expiry_year ?? null,
      })),
    );
  }

  private async refreshPayments() {
    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('independent_rider_payments')
      .select('id,amount,date,status,method,tranzila_invoice_url')
      .eq('rider_uid', this.riderUid)
      .order('date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[independent rider payments] load failed', error);
      this.payments.set([]);
      return;
    }

    this.payments.set(
      (data ?? []).map((r: any) => ({
        id: String(r.id),
        amountNis: Number(r.amount ?? 0).toFixed(2) + ' ₪',
        date: r.date ? new Date(r.date).toLocaleDateString('he-IL') : '-',
        status: r.status ?? '-',
        method: r.method ?? null,
        invoice_url: r.tranzila_invoice_url ?? null,
      })),
    );
  }

  async setDefault(profileId: string) {
    try {
      const dbc = dbTenant();

      const clear = await dbc
        .from('independent_rider_payment_profiles')
        .update({ is_default: false })
        .eq('rider_uid', this.riderUid);

      if (clear.error) throw clear.error;

      const upd = await dbc
        .from('independent_rider_payment_profiles')
        .update({ is_default: true })
        .eq('id', profileId)
        .eq('rider_uid', this.riderUid);

      if (upd.error) throw upd.error;

      await this.refreshProfiles();
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה בהגדרת כרטיס ברירת מחדל');
    }
  }
  openAddCardModal() {
    this.addCardOpen.set(true);
    this.tokenError.set(null);
    this.tokenSaved.set(false);

    queueMicrotask(() => this.ensureAddHostedFieldsReady());
  }

  closeAddCardModal() {
    if (this.savingToken()) return;
    this.addCardOpen.set(false);
  }

  private async ensureAddHostedFieldsReady() {
    if (this.hfAdd || this.hfInitTried) return;
    this.hfInitTried = true;

    try {
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;

      if (!tenantSchema) {
        this.tokenError.set('לא זוהתה סכמת חווה');
        return;
      }

      const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema);
      this.thtkAdd = thtk;

      if (!TzlaHostedFields) {
        this.tokenError.set('רכיב התשלום לא נטען');
        return;
      }

      this.hfAdd = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: {
            selector: '#ir_pm_credit_card_number',
            placeholder: '4580 4580 4580 4580',
            tabindex: 1,
          },
          cvv: {
            selector: '#ir_pm_cvv',
            placeholder: '123',
            tabindex: 2,
          },
          expiry: {
            selector: '#ir_pm_expiry',
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
    } catch (e: any) {
      console.error('[independent rider pm] HF init error', e);
      this.tokenError.set(e?.message ?? 'שגיאה באתחול שדות האשראי');
    }
  }

  async tokenizeAndSaveCard() {
    if (this.savingToken()) return;

    this.tokenError.set(null);
    this.tokenSaved.set(false);

    if (!this.hfAdd || !this.thtkAdd) {
      this.tokenError.set('שדות התשלום לא מוכנים');
      return;
    }

    if (!this.riderUid) {
      this.tokenError.set('לא זוהה רוכב עצמאי מחובר');
      return;
    }

    this.savingToken.set(true);

    try {
      await this.tenantBoot.ensureReady();
      const farm = this.tenantBoot.getFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? undefined;

      if (!tenantSchema) {
        this.tokenError.set('לא זוהתה סכמת חווה');
        return;
      }

      ['credit_card_number', 'expiry', 'cvv'].forEach((k) => {
        const el = document.getElementById('ir_pm_errors_for_' + k);
        if (el) el.textContent = '';
      });

      const dbc = dbTenant();

      const { data } = await dbc
        .from('billing_terminals')
        .select('terminal_name,tok_terminal_name')
        .eq('provider', 'tranzila')
        .eq('mode', 'prod')
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const terminalName = data?.terminal_name ?? 'moachapp';

      this.hfAdd.charge(
        {
          terminal_name: terminalName,
          thtk: this.thtkAdd,
          currency_code: 'ILS',
          amount: '1.00',
          tran_mode: 'N',
          tokenize: true,
          response_language: 'hebrew',
          requested_by_user: 'independent-rider-payments-tokenize',
          email: this.riderEmail || undefined,
          contact: this.riderEmail || undefined,
        },
        async (err: any, response: any) => {
          try {
            if (err?.messages?.length) {
              err.messages.forEach((msg: any) => {
                const el = document.getElementById('ir_pm_errors_for_' + msg.param);
                if (el) el.textContent = msg.message;
              });
              this.tokenError.set('שגיאה בפרטי הכרטיס');
              return;
            }

            const tx = response?.transaction_response;

            if (!tx?.success) {
              this.tokenError.set(tx?.error || 'שמירת אמצעי תשלום נכשלה');
              return;
            }

            const token = tx?.token;

            if (!token) {
              this.tokenError.set('לא התקבל טוקן מהסליקה');
              return;
            }

            const last4 =
              tx?.credit_card_last_4_digits ??
              tx?.last_4 ??
              (tx?.card_mask ? String(tx.card_mask).slice(-4) : null);

            const brand = tx?.card_type_name ?? tx?.card_type ?? null;

            const result: any = await this.tranzila.savePaymentMethod({
              userType: 'independent_rider',
              riderUid: this.riderUid,
              parentUid: null,
              tenantSchema,
              token: String(token),
              last4: last4 ? String(last4) : null,
              brand: brand ? String(brand) : null,
              expiryMonth: tx?.expiry_month ?? null,
              expiryYear: tx?.expiry_year ?? null,
            });

            if (result?.ok === false) {
              this.tokenError.set(result.error ?? 'שגיאה בשמירת אמצעי תשלום במערכת');
              return;
            }

            this.tokenSaved.set(true);
            await this.refreshProfiles();
            this.hfAdd = null;
            this.thtkAdd = null;
            this.hfInitTried = false;
            this.addCardOpen.set(false);
            this.closeAddCardModal();
          }
          catch (e: any) {
            console.error('[tokenizeAndSaveCard] save error', e);

            if (
              e?.status === 409 &&
              e?.error?.error === 'CARD_ALREADY_EXISTS'
            ) {
              this.tokenError.set('לא ניתן לשמור אותו כרטיס אשראי פעמיים');
              return;
            }

            this.tokenError.set(
              e?.error?.message ||
              e?.message ||
              'שגיאה בשמירת אמצעי תשלום במערכת'
            );
          }

          finally {
            this.savingToken.set(false);
          }
        },
      );
    } catch (e: any) {
      console.error('[tokenizeAndSaveCard]', e);
      this.tokenError.set(e?.message ?? 'שגיאה בשמירת אמצעי תשלום');
      this.savingToken.set(false);
    }
  }

  trackById(_i: number, x: { id: string }) {
    return x.id;
  }
}
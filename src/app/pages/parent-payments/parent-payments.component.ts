// src/app/pages/parent-payments/parent-payments.component.ts
import { Component, OnInit, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranzilaService } from '../../services/tranzila.service';
import { PaymentsService, type PaymentProfile, type ChargeRow } from '../../services/payments.service';
import { CurrentUserService } from '../../core/auth/current-user.service';
import {
  dbTenant,
  ensureTenantContextReady,
  getCurrentFarmMetaSync,
} from '../../services/supabaseClient.service';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';
import { ParentPaymentsDbService } from '../../services/parent-payments-db.service';

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

type ChargeVM = {
  id: string;
  sumNis: string;
  status: string;
  created_at: string;
  provider_id: string | null;
};

type InvoiceVM = {
  id: string;
  amountNis: string;
  date: string;
  invoice_url: string;
  method: string | null;
};

type SavePaymentMethodResult =
  | { ok: true; is_default: boolean }
  | { ok: false; error: string };

@Component({
  selector: 'app-parent-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-payments.component.html',
  styleUrls: ['./parent-payments.component.scss'],
})
export class ParentPaymentsComponent implements OnInit, AfterViewInit {
  parentUid: string = '';
  parentEmail: string = '';

  loading = signal(true);
  error = signal<string | null>(null);

  // נתונים
  profiles = signal<ProfileVM[]>([]);
  charges = signal<ChargeVM[]>([]);
  invoices = signal<InvoiceVM[]>([]);

  // ===== מודל הוספת כרטיס (Hosted Fields + טוקן) =====
  addCardOpen = signal(false);
  savingToken = signal(false);
  tokenSaved = signal(false);
  tokenError = signal<string | null>(null);

  private hfAdd: HostedFieldsInstance | null = null;
  private thtkAdd: string | null = null;

  private savedToken: {
    token: string;
    last4: string | null;
    brand: string | null;
    expiryMonth?: string | null;
    expiryYear?: string | null;
  } | null = null;

  // דגל כדי לא לנסות לאתחל HF לפני שהמודל נפתח וה-DOM קיים
  private hfInitTried = false;

  constructor(
    private tranzila: TranzilaService,
    private pagos: PaymentsService,
    private cu: CurrentUserService,
    private tenantBoot: TenantBootstrapService,
    private ppDb: ParentPaymentsDbService,
    ) {
    const cur = this.cu.current;
    this.parentUid = cur?.uid ?? '';
    this.parentEmail = cur?.email ?? '';
  }

  async ngOnInit() {
    try {
      if (!this.parentUid) throw new Error('missing uid');
      await this.refreshAll();
    } catch (e: any) {
      this.error.set(e?.message ?? 'failed to init');
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit() {
    // לא מאתחלים HostedFields כאן — רק כשפותחים את המודל
  }

  // =========================
  // טעינות
  // =========================
  async refreshAll() {
    await Promise.all([
      this.refreshProfilesAndCharges(),
      this.refreshInvoices(),
    ]);
  }

  private async refreshProfilesAndCharges() {
    try {
      const [p, c] = await Promise.all([
        this.pagos.listProfiles(this.parentUid),
        this.pagos.listProviderCharges(this.parentUid, 50),
      ]);

      this.profiles.set(
        (p ?? []).map((x: PaymentProfile) => ({
          id: x.id,
          brand: x.brand,
          last4: x.last4,
          is_default: x.is_default,
          created_at: new Date(x.created_at).toLocaleString('he-IL'),
          // אם יש בשירות/טבלה:
          expiry_month: (x as any).expiry_month ?? null,
          expiry_year: (x as any).expiry_year ?? null,
        })),
      );

      // ✅ לא להראות טיוטות/לא משולמים
      const filtered = (c ?? []).filter((x: ChargeRow) => {
        const st = String(x.status ?? '').toLowerCase();
        return st === 'succeeded' || st === 'paid' || st === 'success';
      });

      this.charges.set(
        filtered.map((x: ChargeRow) => ({
          id: x.id,
          sumNis: (Number(x.amount_agorot) / 100).toFixed(2) + ' ₪',
          status: x.status,
          provider_id: x.provider_id ?? null,
          created_at: new Date(x.created_at).toLocaleString('he-IL'),
        })),
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'load failed');
    }
  }
  private async refreshInvoices() {
    try {
      const dbc = this.ppDb.db();

    const { data, error } = await dbc
  .from('payments')
  .select('id, amount, date, method, tranzila_invoice_url')
  .eq('parent_uid', this.parentUid)
  .not('tranzila_invoice_url', 'is', null)
  .order('date', { ascending: false })
  .limit(100);
      if (error) throw error;

      const rows = (data ?? []) as any[];

    this.invoices.set(
  rows.map((r) => ({
    id: String(r.id),
    amountNis: Number(r.amount ?? 0).toFixed(2) + ' ₪',
    date: r.date ? new Date(r.date).toLocaleDateString('he-IL') : '-',
    invoice_url: String(r.tranzila_invoice_url), // <-- כאן
    method: r.method ?? null,
  })),
);
    } catch (e: any) {
      // לא חוסמים מסך אם אין הרשאות/טבלה — פשוט לא מציגים
      console.error('[invoices] load failed', e);
      this.invoices.set([]);
    }
  }

  // =========================
  // ברירת מחדל
  // =========================
  async setDefault(profileId: string) {
    try {
      await this.pagos.setDefault(profileId, this.parentUid);
      await this.refreshProfilesAndCharges();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to set default');
    }
  }

  // =========================
  // מודל הוספת כרטיס
  // =========================
  openAddCardModal() {
    this.addCardOpen.set(true);
    this.tokenError.set(null);
    this.tokenSaved.set(false);
    this.savedToken = null;

    // לאחר פתיחת מודל: ה-DOM קיים → אפשר לאתחל HF
    queueMicrotask(() => this.ensureAddHostedFieldsReady());
  }

  closeAddCardModal() {
    if (this.savingToken()) return;
    this.addCardOpen.set(false);
  }

  private async ensureAddHostedFieldsReady() {
    if (this.hfAdd) return;
    if (this.hfInitTried) return;
    this.hfInitTried = true;

    try {
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;
      if (!tenantSchema) {
        this.tokenError.set('לא זוהה סכמת חווה');
        return;
      }

      const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema);
      this.thtkAdd = thtk;

      console.log('[pm] HF init, thtk:', thtk);

      if (!TzlaHostedFields) {
        this.tokenError.set('רכיב התשלום לא נטען');
        return;
      }

      this.hfAdd = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: {
            selector: '#pm_credit_card_number',
            placeholder: '4580 4580 4580 4580',
            tabindex: 1,
          },
          cvv: {
            selector: '#pm_cvv',
            placeholder: '123',
            tabindex: 2,
          },
          expiry: {
            selector: '#pm_expiry',
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
      console.log('[pm] HF initialized', this.hfAdd);

      this.hfAdd?.onEvent?.('validityChange', () => {});
    } catch (e: any) {
      console.error('[pm] HF init error', e);
      this.tokenError.set(e?.message ?? 'שגיאה באתחול שדות האשראי');
    }
  }

  // אותו tokenize כמו באשף הוספת ילד
  async tokenizeAndSaveCard() {
    this.tokenError.set(null);

    if (!this.hfAdd || !this.thtkAdd) {
      this.tokenError.set('שדות התשלום לא מוכנים');
      return;
    }
    if (!this.parentUid) {
      this.tokenError.set('לא זוהה הורה מחובר');
      return;
    }

    await this.tenantBoot.ensureReady();
    const farm = this.tenantBoot.getFarmMetaSync();

    const tenantSchema = farm?.schema_name ?? undefined;
    if (!tenantSchema) {
      this.tokenError.set('לא זוהתה סכמת חווה');
      return;
    }

    // ניקוי שגיאות HF
    ['credit_card_number', 'expiry', 'cvv'].forEach((k) => {
      const el = document.getElementById('pm_errors_for_' + k);
      if (el) el.textContent = '';
    });

    this.savingToken.set(true);
    this.tokenSaved.set(false);

    const dbc = this.ppDb.db();

    const { data, error } = await dbc
    .from('billing_terminals')
    .select(
      'terminal_name,tok_terminal_name,secret_key_charge,secret_key_charge_token',
    )
    .eq('provider', 'tranzila')
    .eq('mode', 'prod')
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

    const terminalName = data?.terminal_name ?? 'moachapp';
    console.log('[pm] using terminal:', terminalName);
    const amount = '1.00'; // verify

    this.hfAdd.charge(
      {
        terminal_name: terminalName,
        thtk: this.thtkAdd,
        currency_code: 'ILS',
        amount,
        txn_type: 'verify',
        verify_mode: 2,
        response_language: 'hebrew',
        requested_by_user: 'parent-payments-tokenize',
        email: this.parentEmail || undefined,
        contact: this.parentEmail || undefined,
      },
      async (err: any, response: any) => {
        try {
          if (err?.messages?.length) {
            console.log('[pm] tokenize error', err);
            err.messages.forEach((msg: any) => {
              const el = document.getElementById('pm_errors_for_' + msg.param);
              if (el) el.textContent = msg.message;
            });
            this.tokenError.set('שגיאה בפרטי הכרטיס');
            return;
          }
          console.log('[pm] tokenize response', response);

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

          this.savedToken = {
            token: String(token),
            last4: last4 ? String(last4) : null,
            brand: brand ? String(brand) : null,
            expiryMonth: tx?.expiry_month ?? null,
            expiryYear: tx?.expiry_year ?? null,
          };

          // ✅ שמירה בשרת (Cloud Function) — עם טיפוס שפותח את שגיאת TS2339
          const resultUnknown = await this.tranzila.savePaymentMethod({
            parentUid: this.parentUid,
            tenantSchema,
            token: this.savedToken.token,
            last4: this.savedToken.last4,
            brand: this.savedToken.brand,
            expiryMonth: this.savedToken.expiryMonth,
            expiryYear: this.savedToken.expiryYear,
          });

          const result = resultUnknown as SavePaymentMethodResult;

          if (result && result.ok === false) {
            this.tokenError.set(result.error ?? 'שגיאה בשמירת אמצעי תשלום במערכת');
            return;
          }

          this.tokenSaved.set(true);

          // רענון מסך
          await this.refreshProfilesAndCharges();

          // סגירה אוטומטית אחרי הצלחה
          this.closeAddCardModal();
        } catch (e: any) {
          console.error('[tokenizeAndSaveCard] save error', e);
          this.tokenError.set(e?.message ?? 'שגיאה בשמירת אמצעי תשלום במערכת');
        } finally {
          this.savingToken.set(false);
        }
      },
    );
  }

  // עזר קטן
  trackById(_i: number, x: { id: string }) {
    return x.id;
  }
}

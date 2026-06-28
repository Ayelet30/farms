// app/secretary/billing/secretary-payments.component.ts
import {
  Component,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { ActivatedRoute } from '@angular/router';


import {
  listAllChargesForSecretary,
  listAllRiderPaymentsForSecretary,
  SecretaryChargeRow,
  SecretaryRiderPaymentRow,
} from '../../services/supabaseClient.service';
function writeInvoiceLoadingPage(win: Window) {
  win.document.open();
  win.document.write(`
    <!DOCTYPE html>
    <html lang="he">
      <head>
        <meta charset="UTF-8" />
        <title>מפיקים חשבונית…</title>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f6f7f9;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            direction: rtl;
          }
          .box {
            background: white;
            padding: 32px 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,.1);
            text-align: center;
          }
          .spinner {
            width: 48px;
            height: 48px;
            border: 5px solid #ddd;
            border-top-color: #4f6bed;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          h2 {
            margin: 0 0 8px;
            font-size: 20px;
          }
          p {
            margin: 0;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="spinner"></div>
          <h2>מפיקים חשבונית</h2>
          <p>אנא המתיני מספר שניות…</p>
        </div>
      </body>
    </html>
  `);
  win.document.close();
}

@Component({
  selector: 'app-secretary-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-payments.component.html',
  styleUrls: ['./secretary-payments.component.scss'],
})

export class SecretaryPaymentsComponent implements OnInit {
  // נתונים
  rows = signal<SecretaryChargeRow[]>([]);
  totalCount = signal<number | null>(null);

  // סטטוסים
  loading = signal(false);
  error = signal<string | null>(null);

  // חיפוש / עימוד
  searchTerm = signal('');    // ערך אמיתי
  pageSize = 50;
  pageIndex = signal(0);

  // סכום בעמוד
  pageTotalAmount = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.amount || 0), 0)


  );
  tenantSchema: string | null = null;
  activeTab = signal<'parents' | 'riders'>('parents');

  riderRows = signal<SecretaryRiderPaymentRow[]>([]);
  riderTotalCount = signal<number | null>(null);

  activeRowsTotal = computed(() => {
    if (this.activeTab() === 'parents') {
      return this.rows().reduce((sum, r) => sum + (r.amount || 0), 0);
    }

    return this.riderRows().reduce((sum, r) => sum + (r.amount || 0), 0);
  });

  parentInvoicesByPayment = new Map<string, any[]>();
  expandedInvoicePaymentId = signal<string | null>(null);
  constructor(
    private tenantSvc: SupabaseTenantService,
    private route: ActivatedRoute

  ) {

  }
  invoiceLoading = new Set<string>(); // paymentId

  async ngOnInit() {
    const parentUid = this.route.snapshot.queryParamMap.get('parentUid');

    if (parentUid) {
      this.searchTerm.set(parentUid);
      this.pageIndex.set(0);
    }

    await this.loadPage();
  }

  private async loadPage() {
    try {
      this.loading.set(true);
      this.error.set(null);

      if (this.activeTab() === 'parents') {
        const { rows, count } = await listAllChargesForSecretary({
          limit: this.pageSize,
          offset: this.pageIndex() * this.pageSize,
          search: this.searchTerm().trim() || null,
        });

        this.rows.set(rows);
        this.totalCount.set(count ?? null);
      } else {
        const { rows, count } = await listAllRiderPaymentsForSecretary({
          limit: this.pageSize,
          offset: this.pageIndex() * this.pageSize,
          search: this.searchTerm().trim() || null,
        });

        this.riderRows.set(rows);
        this.riderTotalCount.set(count ?? null);
      }
    } catch (e: any) {
      console.error('[SecretaryPayments] load error', e);
      this.error.set(e?.message ?? 'שגיאה בטעינת התשלומים');
    } finally {
      this.loading.set(false);
    }
  }
  async onSearchChange(term: string) {
    this.searchTerm.set(term);
    this.pageIndex.set(0);
    await this.loadPage();
  }

  async nextPage() {
    if (!this.canNext()) return;
    this.pageIndex.set(this.pageIndex() + 1);
    await this.loadPage();
  }

  async prevPage() {
    if (!this.canPrev()) return;
    this.pageIndex.set(this.pageIndex() - 1);
    await this.loadPage();
  }

  canPrev(): boolean {
    return this.pageIndex() > 0;
  }

  canNext(): boolean {
    const count = this.currentTotalCount();

    if (this.activeTab() === 'parents') {
      if (count == null) return this.rows().length === this.pageSize;
    } else {
      if (count == null) return this.riderRows().length === this.pageSize;
    }

    return (this.pageIndex() + 1) * this.pageSize < count!;
  }

  formatMethod(method: SecretaryChargeRow['method']): string {
    if (method === 'subscription') return 'מנוי חודשי';
    if (method === 'one_time') return 'תשלום חד־פעמי';
    return method ?? '';
  }

  formatAmount(amount: number): string {
    return `${amount.toFixed(2)} ₪`;
  }
  private async getTenantSchemaOrThrow(): Promise<string> {
    await this.tenantSvc.ensureTenantContextReady();
    return this.tenantSvc.requireTenant().schema;
  }

  async createOrFetchInvoice(r: SecretaryChargeRow) {
    const tenantSchema = await this.getTenantSchemaOrThrow();

    this.invoiceLoading.add(r.id);

    try {
      const resp = await fetch(
        'https://ensuretranzilainvoiceforpayment-wxi37vbfra-uc.a.run.app',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantSchema, paymentId: r.id }),
        }
      );

      const raw = await resp.text();
      let json: any = null;

      try {
        json = JSON.parse(raw);
      } catch { }

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
      }

      const invoices = json.invoices ?? [];

      if (!invoices.length) {
        throw new Error('לא נמצאו חשבוניות לתשלום');
      }

      if (invoices.length === 1) {
        const url = invoices[0].invoice_url || invoices[0].tranzila_pdf_url;
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      this.parentInvoicesByPayment.set(r.id, invoices);
      this.expandedInvoicePaymentId.set(r.id);
    } finally {
      this.invoiceLoading.delete(r.id);
    }
  }
  async setTab(tab: 'parents' | 'riders') {
    if (this.activeTab() === tab) return;

    this.activeTab.set(tab);
    this.pageIndex.set(0);
    this.searchTerm.set('');
    await this.loadPage();
  }

  currentTotalCount(): number | null {
    return this.activeTab() === 'parents'
      ? this.totalCount()
      : this.riderTotalCount();
  }
  async createOrFetchRiderInvoice(r: SecretaryRiderPaymentRow) {
    const win = window.open('about:blank', '_blank');

    if (win) {
      writeInvoiceLoadingPage(win);
    }

    try {
      this.invoiceLoading.add(r.id);

      const tenantSchema = await this.getTenantSchemaOrThrow();

      const resp = await fetch(
        'https://ensuretranzilainvoiceforriderpayment-wxi37vbfra-uc.a.run.app',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantSchema,
            paymentId: r.id,
          }),
        }
      );

      const raw = await resp.text();

      let json: any = null;
      try {
        json = JSON.parse(raw);
      } catch { }

      if (!resp.ok || !json?.ok) {
        if (win) win.close();
        throw new Error(json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
      }

      const url = json.url as string;

      if (!url) {
        if (win) win.close();
        throw new Error(`missing url in response: ${raw?.slice(0, 300)}`);
      }

      r.invoice_url = url;
      r.tranzila_invoice_url = url;

      try {
        (win as any).opener = null;
      } catch { }

      if (win) {
        win.location.replace(url);
        win.focus?.();
        await this.loadPage();
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      this.invoiceLoading.delete(r.id);
    }
  }
  formatRiderMethod(method: string | null): string {
    if (method === 'credit_card') return 'כרטיס אשראי';
    if (method === 'bank_transfer') return 'העברה בנקאית';
    if (method === 'cash') return 'מזומן';
    return method || '-';
  }
  formatPaymentKind(method: string | null): string {
    if (method === 'charge') return 'חיוב';
    if (method === 'subscription') return 'מנוי חודשי';
    if (method === 'one_time') return 'תשלום חד־פעמי';
    return method || '-';
  }

  formatPaymentMethod(method: string | null): string {
    switch (method) {
      case 'credit_card':
        return 'כרטיס אשראי';

      case 'bank_transfer':
        return 'העברה בנקאית';

      case 'cash':
        return 'מזומן';

      case 'check':
        return 'צ׳ק';

      default:
        return method ?? '-';
    }
  }
}

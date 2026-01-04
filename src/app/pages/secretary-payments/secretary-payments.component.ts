// app/secretary/billing/secretary-payments.component.ts
import {
  Component,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
// import { TranzilaInvoicesService } from '../../services/tranzila-invoices.service';
// import { getCurrentUserData } from '../../services/supabaseClient.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

import {
  listAllChargesForSecretary,
  SecretaryChargeRow,
} from '../../services/supabaseClient.service';

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

  constructor(
  private tenantSvc: SupabaseTenantService,

  ) {
    
  }
invoiceLoading = new Set<string>(); // paymentId

  async ngOnInit() {
    await this.loadPage();
  
  }

  private async loadPage() {
    try {
      this.loading.set(true);
      this.error.set(null);

      const { rows, count } = await listAllChargesForSecretary({
        limit: this.pageSize,
        offset: this.pageIndex() * this.pageSize,
        search: this.searchTerm().trim() || null,
      });

      this.rows.set(rows);
      this.totalCount.set(count ?? null);
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
    const count = this.totalCount();
    if (count == null) return this.rows().length === this.pageSize;
    return (this.pageIndex() + 1) * this.pageSize < count;
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
  return this.tenantSvc.requireTenant().schema; // למשל: "bereshit_farm"
}

//   async createOrFetchInvoice(r: any) {
//     console.log('[UI] invoice button clicked', { paymentId: r?.id });

//  try {
//     r._invLoading = true;

//     const tenantSchema = await this.getTenantSchemaOrThrow();


//     const resp = await fetch(
//       'https://ensuretranzilainvoiceforpayment-wxi37vbfra-uc.a.run.app',
//       {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
// body: JSON.stringify({ tenantSchema, paymentId: r.id, debugOnly: true }),
//       }
//     );
//     const json = await resp.json();
//     if (!resp.ok || !json.ok) throw new Error(json.error || 'failed');

//     r.invoice_url = json.url;
//     window.open(json.url, '_blank', 'noopener,noreferrer');
//   } finally {
//     r._invLoading = false;
//   }
// }
async createOrFetchInvoice(r: any) {
  console.log('[UI] invoice button clicked', { paymentId: r?.id });

  // ✅ לפתוח בלי noopener/noreferrer כדי שתישאר שליטה על הטאב
  const win = window.open('about:blank', '_blank');

  try {
    r._invLoading = true;

    const tenantSchema = await this.getTenantSchemaOrThrow();

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
    try { json = JSON.parse(raw); } catch {}

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

    // ✅ הגנה מפני reverse-tabnabbing בלי לאבד שליטה בטאב
    try {
      (win as any).opener = null;
    } catch {}

    // ✅ עדיף replace כדי לא להשאיר "about:blank" בהיסטוריה
    if (win) {
      win.location.replace(url);
      win.focus?.();
    } else {
      // fallback אם popup נחסם
      window.open(url, '_blank', 'noopener,noreferrer');
    }

  } finally {
    r._invLoading = false;
  }
}

}

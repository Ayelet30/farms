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
  return this.tenantSvc.requireTenant().schema;
}

async createOrFetchInvoice(r: any) {
const win = window.open('about:blank', '_blank');
  if (win) {
    writeInvoiceLoadingPage(win); // 👈 מסך טעינה
  }
  // ✅ לפתוח בלי noopener/noreferrer כדי שתישאר שליטה על הטאב

  try {
  this.invoiceLoading.add(r.id);

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
    r.invoice_status = 'ready'; // כדי שהכפתור יתחלף מיד ללינק


    // ✅ הגנה מפני reverse-tabnabbing בלי לאבד שליטה בטאב
    try {
      (win as any).opener = null;
    } catch {}

    // ✅ עדיף replace כדי לא להשאיר "about:blank" בהיסטוריה
    if (win) {
      win.location.replace(url);
      win.focus?.();
      
      await this.loadPage();

    } else {
      // fallback אם popup נחסם
      window.open(url, '_blank', 'noopener,noreferrer');
    }

  } finally {
    this.invoiceLoading.delete(r.id);
  }
}

}

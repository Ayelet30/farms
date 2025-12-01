// app/secretary/billing/secretary-payments.component.ts
import {
  Component,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

  constructor() {}

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
}

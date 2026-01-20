// src/app/pages/secretarial-series-requests/secretarial-series-requests.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SeriesRequestsService, SeriesRequestRow } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';

@Component({
  selector: 'app-secretarial-series-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './request-new-series-details.component.html',
  styleUrls: ['./request-new-series-details.component.scss'],
})
export class SecretarialSeriesRequestsComponent implements OnInit {
  private api = inject(SeriesRequestsService);
  private ui = inject(UiDialogService);

  loading = signal(false);
  rows = signal<SeriesRequestRow[]>([]);
  error = signal<string | null>(null);

  noteById: Record<string, string> = {};

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set(null);

      const data = await this.api.listPending();
      this.rows.set(data ?? []);
    } catch (e: any) {
      console.error('Series requests reload failed', e);
      this.error.set(e?.message ?? 'שגיאה בטעינה');
      await this.ui.alert(this.error()!, 'שגיאה');
    } finally {
      this.loading.set(false);
    }
  }

  async approve(row: SeriesRequestRow): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'אישור בקשה',
      message: `לאשר את הבקשה?`,
      okText: 'כן, לאשר',
      cancelText: 'ביטול',
      showCancel: true,
    });
    if (!ok) return;

    try {
      this.loading.set(true);

      const uid = (await getCurrentUserData())?.uid ?? null;
      const note = (this.noteById[row.id] ?? '').trim();

      const res = await this.api.approve(row.id, uid, note);
      const first = Array.isArray(res) ? res[0] : res;

      if (!first?.ok) {
        await this.ui.alert(`לא ניתן לאשר: ${first?.deny_reason ?? 'unknown'}`, 'שגיאה');
        return;
      }

      await this.ui.alert('הבקשה אושרה בהצלחה.', 'הצלחה');
      await this.reload();
    } catch (e: any) {
      console.error('approve failed', e);
      await this.ui.alert(e?.message ?? 'שגיאה באישור', 'שגיאה');
    } finally {
      this.loading.set(false);
    }
  }

  async reject(row: SeriesRequestRow): Promise<void> {
    const note = (this.noteById[row.id] ?? '').trim();
    if (!note) {
      await this.ui.alert('כדי לדחות חייבים לכתוב סיבת דחייה קצרה.', 'חסר שדה');
      return;
    }

    const ok = await this.ui.confirm({
      title: 'דחיית בקשה',
      message: 'לדחות את הבקשה? הפעולה לא תשוב לאחור.',
      okText: 'כן, לדחות',
      cancelText: 'ביטול',
      showCancel: true,
    });
    if (!ok) return;

    try {
      this.loading.set(true);

      const uid = (await getCurrentUserData())?.uid ?? null;
      await this.api.reject(row.id, uid, note);

      await this.ui.alert('הבקשה נדחתה.', 'הצלחה');
      await this.reload();
    } catch (e: any) {
      console.error('reject failed', e);
      await this.ui.alert(e?.message ?? 'שגיאה בדחייה', 'שגיאה');
    } finally {
      this.loading.set(false);
    }
  }
}

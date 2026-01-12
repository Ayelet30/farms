import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SeriesRequestsService, SeriesRequestRow } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';
//import { getcurr } from '../../services/auth.service'; // אם אין לך - תחליפי בשליפה אצלך

@Component({
  selector: 'app-secretarial-series-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './request-new-series-details.component.html',
  styleUrls: ['./request-new-series-details.component.scss'],
})
export class SecretarialSeriesRequestsComponent implements OnInit {
  private api = inject(SeriesRequestsService);

  loading = signal(false);
  rows = signal<SeriesRequestRow[]>([]);
  error = signal<string | null>(null);

  noteById: Record<string, string> = {};

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    try {
      this.loading.set(true);
      this.error.set(null);
      this.rows.set(await this.api.listPending());
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה בטעינה');
    } finally {
      this.loading.set(false);
    }
  }

  async approve(row: SeriesRequestRow) {
    try {
      this.loading.set(true);
      const uid = (await getCurrentUserData())?.uid;
      const note = (this.noteById[row.id] ?? '').trim();

      const res = await this.api.approve(row.id, uid, note);
      const first = Array.isArray(res) ? res[0] : res;

      if (!first?.ok) {
        alert(`לא ניתן לאשר: ${first?.deny_reason ?? 'unknown'}`);
        return;
      }

      await this.reload();
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה באישור');
    } finally {
      this.loading.set(false);
    }
  }

  async reject(row: SeriesRequestRow) {
    const note = (this.noteById[row.id] ?? '').trim();
    if (!note) {
      alert('כדי לדחות חייבים לכתוב סיבת דחייה קצרה');
      return;
    }

    try {
      this.loading.set(true);
      const uid = (await getCurrentUserData())?.uid;
      await this.api.reject(row.id, uid, note);
      await this.reload();
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בדחייה');
    } finally {
      this.loading.set(false);
    }
  }
}

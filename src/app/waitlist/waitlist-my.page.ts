import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RidingType, WaitlistEntry } from '../Types/waitlist.types';
import { WaitlistService } from '../services/waitlist.service';
import { CurrentUserService } from '../core/auth/current-user.service';

@Component({
  selector: 'app-waitlist-my',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './waitlist-my.page.html',
  styleUrls: ['./waitlist-my.page.scss'],
})
export class WaitlistMyPage implements OnInit {
  loading = signal(false);
  errorText = signal<string | null>(null);
  items = signal<WaitlistEntry[]>([]);
  typesById = signal<Record<string, RidingType>>({});

  constructor(
    private wl: WaitlistService,
    private cu: CurrentUserService
  ) {}

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    this.errorText.set(null);
    try {
      const parentUid = await this.cu.getIdToken(); 
      const [types, entries] = await Promise.all([
        this.wl.listRidingTypes(),
        this.wl.listMyEntries(parentUid),
      ]);
      const map: Record<string, RidingType> = {};
      for (const t of types) map[t.id] = t;
      this.typesById.set(map);
      this.items.set(entries);
    } catch (e: any) {
      this.errorText.set(e?.message ?? 'שגיאה בטעינת רשימת ההמתנה שלי');
    } finally {
      this.loading.set(false);
    }
  }

  async cancel(id: string) {
    try {
      await this.wl.setStatus(id, 'cancelled');
      await this.refresh();
    } catch (e: any) {
      this.errorText.set(e?.message ?? 'שגיאה בביטול');
    }
  }

  async togglePause(e: WaitlistEntry) {
    try {
      await this.wl.setStatus(e.id, e.status === 'paused' ? 'active' : 'paused');
      await this.refresh();
    } catch (err: any) {
      this.errorText.set(err?.message ?? 'שגיאה בעדכון סטטוס');
    }
  }

  typeName(id: string) {
    return this.typesById()[id]?.name ?? '—';
  }
}

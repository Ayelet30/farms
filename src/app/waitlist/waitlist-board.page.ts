import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { RidingType, WaitlistEntry } from '../Types/waitlist.types';
import { WaitlistService } from '../services/waitlist.service';

@Component({
  selector: 'app-waitlist-board',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './waitlist-board.page.html',
  styleUrls: ['./waitlist-board.page.scss'],
})
export class WaitlistBoardPage implements OnInit {
  ridingTypes = signal<RidingType[]>([]);
  selectedTypeId = signal<string>('');
  requestedDay = signal<string>(''); // optional filter yyyy-mm-dd

  loading = signal(false);
  errorText = signal<string | null>(null);

  entries = signal<WaitlistEntry[]>([]);
  activeEntries = computed(() => this.entries().filter(e => e.status === 'active' || e.status === 'paused'));

  constructor(private wl: WaitlistService) {}

  async ngOnInit() {
    await this.loadTypes();
  }


  offeredEntries = computed(() =>
  this.entries().filter(e => e.status === 'offered')
);

  async loadTypes() {
    this.loading.set(true);
    this.errorText.set(null);
    try {
      const types = await this.wl.listRidingTypes();
      this.ridingTypes.set(types);
      if (types[0]?.id) {
        this.selectedTypeId.set(types[0].id);
        await this.refresh();
      }
    } catch (e: any) {
      this.errorText.set(e?.message ?? 'שגיאה בטעינת סוגי רכיבה');
    } finally {
      this.loading.set(false);
    }
  }

  async refresh() {
    const typeId = this.selectedTypeId();
    if (!typeId) return;

    this.loading.set(true);
    this.errorText.set(null);
    try {
      const day = this.requestedDay().trim() || undefined;
      const list = await this.wl.listEntriesByType({
        ridingTypeId: typeId,
        statuses: ['active','paused','offered'],
        requestedDay: day,
      });
      this.entries.set(list);
    } catch (e: any) {
      this.errorText.set(e?.message ?? 'שגיאה בטעינת רשימת המתנה');
    } finally {
      this.loading.set(false);
    }
  }

  async onTypeChanged() {
    await this.refresh();
  }

  async drop(ev: CdkDragDrop<WaitlistEntry[]>) {
    // UI reorder
    const arr = [...this.activeEntries()];
    moveItemInArray(arr, ev.previousIndex, ev.currentIndex);

    // נחשב before/after לפי המיקום החדש
    const moved = arr[ev.currentIndex];
    const before = ev.currentIndex > 0 ? arr[ev.currentIndex - 1] : null;
    const after = ev.currentIndex < arr.length - 1 ? arr[ev.currentIndex + 1] : null;

    // optimistic update: נבנה entries מחדש עם הסדר החדש בתוך active/paused
    const all = [...this.entries()];
    const map = new Map(arr.map((x, i) => [x.id, i]));
    all.sort((a, b) => {
      const ia = map.has(a.id) ? map.get(a.id)! : 999999;
      const ib = map.has(b.id) ? map.get(b.id)! : 999999;
      if (ia !== ib) return ia - ib;
      // offered נשארים אחרי active/paused
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
    this.entries.set(all);

    try {
      await this.wl.moveEntry(moved.id, before?.id ?? null, after?.id ?? null);
    } catch (e: any) {
      this.errorText.set(e?.message ?? 'שגיאה בהזזה. ריענון רשימה…');
      await this.refresh();
    }
  }

  async togglePause(e: WaitlistEntry) {
    const next = e.status === 'paused' ? 'active' : 'paused';
    try {
      await this.wl.setStatus(e.id, next);
      await this.refresh();
    } catch (err: any) {
      this.errorText.set(err?.message ?? 'שגיאה בעדכון סטטוס');
    }
  }

  async bumpPriority(e: WaitlistEntry, delta: number) {
    try {
      await this.wl.setPriority(e.id, (e.priority ?? 0) + delta);
      await this.refresh();
    } catch (err: any) {
      this.errorText.set(err?.message ?? 'שגיאה בעדכון קדימות');
    }
  }

  async markContacted(e: WaitlistEntry) {
    try {
      await this.wl.setLastContacted(e.id);
      await this.refresh();
    } catch (err: any) {
      this.errorText.set(err?.message ?? 'שגיאה בעדכון “נוצר קשר”');
    }
  }

  async normalizePositions() {
    try {
      await this.wl.normalize(this.selectedTypeId());
      await this.refresh();
    } catch (err: any) {
      this.errorText.set(err?.message ?? 'שגיאה ב־Normalize');
    }
  }
}

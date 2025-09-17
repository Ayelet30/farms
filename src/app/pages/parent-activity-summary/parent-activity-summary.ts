import { Component, OnInit, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// עדכני נתיבים לפי הפרויקט שלך
import { dbTenant, fetchMyChildren } from '../../services/supabaseClient';

interface ChildRow {
  child_uuid: string;
  full_name: string;
  color?: string | null;
}

interface ChildItem {
  child_uuid: string;
  full_name: string;
  color?: string | null;
}

interface ActivityRowRPC {
  occ_date: string;        // 'YYYY-MM-DD'
  start_time: string;      // 'HH:MM:SS'
  end_time: string;        // 'HH:MM:SS'
  child_id: string;        // uuid
  instructor_id: string | null;
  note_content: string | null;
}

interface ActivityRowView {
  date: string;
  time: string;
  instructor: string;
  child: string;
  note: string;
}

@Component({
  selector: 'app-parent-activity-summary',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-activity-summary.html',
  styleUrls: ['./parent-activity-summary.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentActivitySummaryComponent implements OnInit {
  // מסננים
  children = signal<ChildItem[]>([]);
  selectedChildIds = signal<string[]>([]);
  dateFrom = signal<string>('');
  dateTo = signal<string>('');

  // תצוגה
  rows = signal<ActivityRowView[]>([]);
  loading = signal<boolean>(false);

  async ngOnInit() {
    // חודש נוכחי כברירת מחדל
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    this.dateFrom.set(toISODate(from));
    this.dateTo.set(toISODate(to));

    await this.loadChildren();
    await this.refresh();
  }

  /** עטיפה קטנה שתעבוד גם אם dbTenant הוא פונקציה שמחזירה client וגם אם הוא client עצמו */
  private getDb(): any {
    const maybe = dbTenant as unknown as any;
    return typeof maybe === 'function' ? maybe() : maybe;
  }

  private async loadChildren() {
    // fetchMyChildren מחזיר או מערך, או מעטפת { ok, data, error }
    const res = (await fetchMyChildren()) as any;
    const data: ChildRow[] = Array.isArray(res) ? res : (res?.data ?? []);

    const kids: ChildItem[] = (data ?? []).map((r: ChildRow) => ({
      child_uuid: r.child_uuid,
      full_name: r.full_name,
      color: r.color ?? null,
    }));

    this.children.set(kids);
    this.selectedChildIds.set(kids.map(k => k.child_uuid)); // ברירת מחדל: כל הילדים
  }

  async refresh() {
    this.loading.set(true);
    try {
      const db = this.getDb();

      const childIds = this.selectedChildIds();
      const from = this.dateFrom();
      const to   = this.dateTo();

      const { data, error } = await db.rpc('get_parent_activity', {
        p_from: from,
        p_to: to,
        p_child_ids: childIds.length ? childIds : null,
      });
      if (error) throw error;

      const hhmm = (t?: string) => (t ? t.slice(0, 5) : '');
      const childMap = new Map(this.children().map(c => [c.child_uuid, c.full_name]));

      const list = ((data ?? []) as ActivityRowRPC[]).map(r => ({
        date: r.occ_date,
        time: `${hhmm(r.start_time)}–${hhmm(r.end_time)}`,
        instructor: r.instructor_id || '',
        child: childMap.get(r.child_id) || r.child_id,
        note: r.note_content || '',
      }));

      this.rows.set(list);
    } catch (e) {
      console.error('refresh error:', e);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  // --- פעולות בחירת ילדים ---
  onToggleChild(child: ChildItem, checked: boolean) {
    const set = new Set(this.selectedChildIds());
    if (checked) set.add(child.child_uuid);
    else set.delete(child.child_uuid);
    this.selectedChildIds.set([...set]);
  }

  selectAllChildren() {
    this.selectedChildIds.set(this.children().map(c => c.child_uuid));
  }

  clearChildren() {
    this.selectedChildIds.set([]);
  }

  // --- ייצוא CSV ---
  exportCsv() {
    const csv = [
      ['תאריך', 'שעות', 'מדריך', 'ילד', 'הערת מדריך'],
      ...this.rows().map(r => [
        r.date,
        r.time,
        r.instructor,
        r.child,
        (r.note ?? '').replace(/\n/g, ' '),
      ]),
    ]
      .map(row => row.map(cell => escapeCsv(cell ?? '')).join(','))
      .join('\n');

    downloadText('activity-summary.csv', csv);
  }
}

// ===== Helpers =====
function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function escapeCsv(s: string) {
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import { Component, OnInit, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// עדכני נתיבים לפי הפרויקט שלך
import { dbTenant } from '../../services/legacy-compat';
import { fetchMyChildren } from '../../services/supabaseClient.service';

interface ChildRow {
  child_uuid: string;
  first_name: string;
  last_name: string;
  color?: string | null;
}
interface ChildItem {
  child_uuid: string;
  first_name: string;
  last_name: string;
  color?: string | null;
}

// ❶ עדכון ה-Interface מה-RPC:
interface ActivityRowRPC {
  occ_date: string;
  start_time: string;
  end_time: string;
  child_id: string;               // uuid
  child_name: string | null;      // לצורך תצוגה
  instructor_id: string | null;
  instructor_name: string | null; // לצורך תצוגה
  lesson_type: string | null;
  status: string | null;
  note_content: string | null;
}

// ❷ שורות לתצוגה
interface ActivityRowView {
  date: string;
  time: string;
  instructor: string;
  child: string;
  child_id: string;               // לסינון
  status?: string | null;
  note: string;
}

// —— Helper: פיצול "שם מלא" לשם פרטי/משפחה במקרה הצורך ——
function splitName(full: string): { first: string; last: string } {
  const s = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };
  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
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

  // --- Tabs ---
  tab = signal<'month'|'year'|'all'>('month');

  // --- Filter state (single-select child, month, year) ---
  children = signal<ChildItem[]>([]);
  selectedChildId = signal<string | undefined>(undefined);

  readonly months = [
    { value: 1, label: 'ינואר' }, { value: 2, label: 'פברואר' }, { value: 3, label: 'מרץ' },
    { value: 4, label: 'אפריל' }, { value: 5, label: 'מאי' }, { value: 6, label: 'יוני' },
    { value: 7, label: 'יולי' }, { value: 8, label: 'אוגוסט' }, { value: 9, label: 'ספטמבר' },
    { value: 10, label: 'אוקטובר' }, { value: 11, label: 'נובמבר' }, { value: 12, label: 'דצמבר' },
  ];
  years = [2024, 2025, 2026];

  month = signal<number>(new Date().getMonth() + 1);
  year  = signal<number>(new Date().getFullYear());
  monthLabel = computed(() => this.months.find(m => m.value === this.month())?.label ?? '');

  // --- Data ---
  rows = signal<ActivityRowView[]>([]);
  loading = signal<boolean>(false);

  async ngOnInit() {
    await this.loadChildren();
    await this.refresh();
  }

  onChildChange(val: string | null) {
    const v = (val ?? '').trim();
    this.selectedChildId.set(v ? v : undefined);
    this.refresh();
  }

  /** תאימות ל-dbTenant כפונקציה/אובייקט */
  private getDb(): any {
    const maybe = dbTenant as any;
    return typeof maybe === 'function' ? maybe() : maybe;
  }

  // --- טעינת ילדים לחשבון ההורה הנוכחי ---
  private async loadChildren() {
    const res = (await fetchMyChildren()) as any;
    const data: any[] = Array.isArray(res) ? res : (res?.data ?? []);

    const kids: ChildItem[] = (data ?? [])
      .map((r: any) => {
        const uuid =
          r.child_uuid ??
          r.child_id ??
          r.uuid ??
          r.id ??
          r.id_number ??
          r.childUuid ??
          r.childId ??
          null;

        if (!uuid) return null;

        // ננסה קודם כל לקחת שדות first_name / last_name ישירות מהנתונים
let first = (r.first_name || '').trim();
let last  = (r.last_name  || '').trim();

// אם אין ערכים — ננסה לפצל מתוך "שם מלא" או שמות חלופיים
if (!first && !last) {
  const full =
    r.full_name ||
    r.child_name ||
    r.name ||
    r.fullName ||
    r.childName ||
    '';

  const cleaned = String(full).trim();
  if (cleaned) {
    const [f, ...rest] = cleaned.split(/\s+/);
    first = f || '';
    last = rest.join(' ') || '';
  }
}
 return {
          child_uuid: String(uuid),
          first_name: first,
          last_name: last,
          color: r.color ?? null,
        } as ChildItem;
      })
      .filter((k: ChildItem | null): k is ChildItem => !!k && !!k.child_uuid);

    this.children.set(kids);
    this.selectedChildId.set(undefined); // ברירת מחדל: כל הילדים
  }

  // --- Load rows for selected YEAR (and optionally child) ---
  async refresh() {
    this.loading.set(true);
    try {
      const db = this.getDb();
      const from = `${this.year()}-01-01`;
      const to   = `${this.year()}-12-31`;

      let cid = this.selectedChildId();
      if (cid) cid = cid.trim();
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const pChildIds: string[] | null = cid && uuidRe.test(cid) ? [cid] : null;

      const { data, error } = await db.rpc('get_parent_activity_from_view', {
        p_from: from,
        p_to: to,
        p_child_ids: pChildIds, // ← תמיד null או [uuid תקין]
      });
      if (error) throw error;

      const hhmm = (t?: string) => (t ? t.slice(0, 5) : '');
      const list: ActivityRowView[] = ((data ?? []) as ActivityRowRPC[]).map(r => ({
        date: r.occ_date,
        time: `${hhmm(r.start_time)}–${hhmm(r.end_time)}`,
        instructor: r.instructor_name || r.instructor_id || '',
        child: r.child_name || '',
        child_id: (r as any).child_id ?? (r as any).child_uuid,
        status: r.status || null,
        note: r.note_content || '',
      }));

      this.rows.set(list.sort((a, b) => a.date.localeCompare(b.date)));
    } catch (e) {
      console.error('refresh error:', e);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  // --- Month view helpers ---

  // TODO: להחליף לסכומים אמתיים כאשר תוסיפי שדות כספיים מה-DB
  monthSubsidies = computed(() => 0);
  monthDiscounts = computed(() => 0);
  monthTotal     = computed(() => 0);

  monthRows = computed(() => this.filteredRows()); // טאב 'month' — אותה תוצאה
  yearRows  = computed(() => this.filteredRows()); // 'year'/'all' — בלי סינון חודש

  // ספירת שיעורים אמיתיים (ללא ביטולים)
  monthLessonsCount = computed(() =>
    this.filteredRows().filter(r => r.status !== 'בוטל').length
  );

  onYearChange(y: number) {
    this.year.set(Number(y));
    this.refresh();
  }

  // שורות מסוננות לפי טאב/חודש/שנה/ילד
  filteredRows = computed(() => {
    const y = this.year();
    const m = this.month();
    const tab = this.tab();
    const childId = (this.selectedChildId() ?? '').trim().toLowerCase();

    const isMonth = tab === 'month';

    const rows = this.rows() ?? [];
    return rows.filter(r => {
      if (!r?.date) return false;
      const [yy, mm] = r.date.split('-').map(Number);
      const okY = yy === y;
      const okM = isMonth ? (mm === m) : true;

      const rid = (r.child_id ?? '').toString().trim().toLowerCase();
      const okC = childId ? (rid === childId) : true;

      return okY && okM && okC;
    });
  });

  // TODO: להחליף לנתוני סטטוס אמיתיים כשיהיו
  yearActive     = computed(() => this.yearRows().length);
  yearCancelPaid = computed(() => 0);
  yearCancelFree = computed(() => 0);
  yearTotal      = computed(() => 0);

  yearBars = computed(() => {
    const labels = this.months.map(m => m.label);
    const counts = Array(12).fill(0);
    this.yearRows().forEach(r => counts[new Date(r.date).getMonth()]++);
    return counts.map((c, i) => ({ label: labels[i], count: c }));
  });

  // --- Export CSV ---
  exportCsv() {
    const csv = [
      ['תאריך', 'שעות', 'מדריך', 'ילד', 'הערת מדריך'],
      ...this.yearRows().map(r => [r.date, r.time, r.instructor, r.child, (r.note ?? '').replace(/\n/g, ' ')])
    ].map(row => row.map(cell => escapeCsv(cell ?? '')).join(',')).join('\n');

    downloadText('activity-summary.csv', csv);
  }
}

// ===== Helpers =====
function escapeCsv(s: string) {
  return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

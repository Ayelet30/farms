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
   base_price?: number | null;
  subsidy_amount?: number | null;
  discount_amount?: number | null;
  final_price?: number | null;
    riding_type_id?: string | null;
  riding_type_name?: string | null;

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
   lesson_type?: string | null;
  base_price?: number | null;
  subsidy?: number | null;
  discount?: number | null;
  pay_amount?: number | null;
    riding_type_id?: string | null;
  riding_type_name?: string | null;

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
selectedRidingTypeId = signal<string | undefined>(undefined);

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

ridingTypeOptions = computed(() => {
  const map = new Map<string, string>();
  for (const r of this.rows()) {
    const id = (r.riding_type_id ?? '').trim();
    const name = (r.riding_type_name ?? '').trim();
    console.log(name+"!!!!!!!!!!!!!1"); 
    if (id) map.set(id, name || id);
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
});
ridingTypes = signal<{id:string; name:string}[]>([]);

private async loadRidingTypes() {
  const db = this.getDb();
  const { data, error } = await db.from('riding_types').select('id,name').order('name');
  if (error) throw error;
  this.ridingTypes.set((data ?? []).map((x:any)=>({id:String(x.id), name:String(x.name)})));
}

onRidingTypeChange(val: string) {
  this.selectedRidingTypeId.set((val ?? '').trim());
}

  async ngOnInit() {
    await this.loadChildren();
    await this.loadRidingTypes();
    await this.refresh();
  }

  onChildChange(val: string | null) {
    const v = (val ?? '').trim();
const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // אם זה לא UUID → לא נכניס ל-selectedChildId
  this.selectedChildId.set(v && uuidRe.test(v) ? v : undefined);
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
  r.childUuid ??
  r.childId ??
  null;
  const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!uuid || !uuidRe.test(String(uuid))) return null;


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

      // let cid = this.selectedChildId();
      // if (cid) cid = cid.trim();
      // const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      // const pChildIds: string[] | null = cid && uuidRe.test(cid) ? [cid] : null;

const cid = (this.selectedChildId() ?? '').trim();

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pChildIds: string[] | null =
  cid && uuidRe.test(cid) ? [cid] : null;
console.log('selectedChildId =', this.selectedChildId());
console.log('p_child_ids =', pChildIds);

   const { data, error } = await db.rpc('get_parent_activity_from_view', {
  p_from: from,
  p_to: to,
  p_child_ids: pChildIds, // ← תמיד רשימה, לא null
});

      if (error) throw error;

 const hhmm = (t?: string) => (t ? t.slice(0, 5) : '');

const list: ActivityRowView[] = ((data ?? []) as ActivityRowRPC[]).map(r => ({
  date: r.occ_date,
  time: `${hhmm(r.start_time)}-${hhmm(r.end_time)}`, // שינינו גם ל "-" פשוט
  instructor: r.instructor_name || r.instructor_id || '',
  child: r.child_name || '',
child_id: r.child_id,
  status: r.status || null,
  note: r.note_content || '',

  // חדש:
  lesson_type: r.lesson_type || null,
  riding_type_id: (r as any).riding_type_id ?? null,
riding_type_name: (r as any).riding_type_name ?? null,


  // שמות גמישים – תתאימי לשמות בפועל ב-RPC
  base_price:
    (r as any).base_price ??
    (r as any).base_price_nis ??
    null,

  subsidy:
    (r as any).subsidy_amount ??
    (r as any).subsidy ??
    (r as any).subsidy_nis ??
    null,

  discount:
    (r as any).discount_amount ??
    (r as any).discount ??
    (r as any).discount_nis ??
    null,

  pay_amount:
    (r as any).final_price ??
    (r as any).amount_to_pay ??
    (r as any).total_to_pay ??
    null,
    
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
  const ridingTypeId = this.selectedRidingTypeId();

  const isMonth = tab === 'month';

  return (this.rows() ?? []).filter(r => {
    if (!r?.date) return false;

    const [yy, mm] = r.date.split('-').map(Number);
    const okY = yy === y;
    const okM = isMonth ? (mm === m) : true;

    const okChild = childId
      ? r.child_id?.toLowerCase() === childId
      : true;

    const okRidingType = ridingTypeId
      ? r.riding_type_id === ridingTypeId
      : true;

    return okY && okM && okChild && okRidingType;
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

  // חדש – המקסימום לצורך גובה העמודה
  maxYearCount = computed(() => {
    const counts = this.yearBars().map(b => b.count);
    return counts.length ? Math.max(...counts) : 0;
  });


  // --- Export CSV ---
 exportCsv() {
  // נשתמש בשורות המסוננות לפי הטאב/שנה/חודש/ילד
  const rows = this.filteredRows();

  const header = [
    'תאריך',
    'ילד',
    'מדריך',
    'סוג שיעור',
    'שעות',
    'מחיר בסיסי',
    'סבסוד',
    // 'הנחה',
    'סכום לתשלום',
    'סטטוס',
    'הערת מדריך',
  ];

  const body = rows.map(r => [
    r.date || '',
    r.child || '',
    r.instructor || '',
    r.lesson_type ?? '',
    r.time || '',
    r.base_price != null ? r.base_price.toString() : '',
    r.subsidy    != null ? r.subsidy.toString()    : '',
    r.discount   != null ? r.discount.toString()   : '',
    r.pay_amount != null ? r.pay_amount.toString() : '',
    r.status ?? '',
    (r.note ?? '').replace(/\n/g, ' '),
  ]);

  const csv = [header, ...body]
    .map(row => row.map(cell => escapeCsv(cell ?? '')).join(','))
    .join('\n');

  downloadText('activity-summary.csv', csv);
}

}

// ===== Helpers =====
function escapeCsv(s: string) {
  return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadText(filename: string, content: string) {
  // BOM ל-UTF-8
  const BOM = '\uFEFF';

  const blob = new Blob([BOM + content], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


import {
  Component,
  OnInit,
  computed,
  signal,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { dbTenant } from '../../services/supabaseClient.service';

// ===============================
//       TYPE DEFINITIONS
// ===============================
type UUID = string;
type LessonStatus = 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם' | 'בוצע';
type LessonType = 'רגיל' | 'השלמה';

// שורה מתוך ה-VIEW ב־Supabase
type MonthlyReportRow = {
  lesson_id?: UUID | null;
  lesson_date: string | null;
  start_time: string | null;
  end_time: string | null;

  status?: string | null;
  child_name?: string | null;
  instructor_name?: string | null;

  // 👇 הוספה:
  riding_type_code?: string | null;
  riding_type_name?: string | null;

  approval_id?: UUID | null;
  is_cancellation?: boolean | null;
  is_makeup_target?: boolean | null;
  lesson_type?: string | null;
  child_id?: UUID | null;
  instructor_id?: string | number | null;
  lesson_price_agorot?: number | null;
};

interface LessonRow {
  lesson_id: UUID;
  child_id?: UUID;

  lesson_type: LessonType | null;
  status: LessonStatus | null;

  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;

  occur_date?: string | null;
  anchor_week_start?: string;

  //  הוספה:
  riding_type_code?: string | null;
  riding_type_name?: string | null;
  riding_type?: string | null;

  child?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;

  child_first_name?: string | null;
  child_last_name?: string | null;
  child_full_name?: string | null;

  instructor_uid?: string | null;
  instructor_first_name?: string | null;
  instructor_last_name?: string | null;

  instructor_name?: string | null;
}

interface PaymentRow {
  amount: number | null;
  date: string | null;
  parent_uid?: string | null;
  method?: string | null;
  invoice_url?: string | null;
}

interface CancelExceptionRow {
  occur_date?: string | null;
  status?: string | null;
  lesson_id?: UUID | null;
  note?: string | null;
}

interface Insights {
  totalLessons: number;
  cancelPct: number;
  successPct: number;
  newStudents: number;
  avgIncome: number;
}

interface Kpis {
  workedHours: string;
  canceled: number;
  done: number;
  pending: number;
  successPct: number;
  privCount: number;
  groupCount: number;
  income: number;
}

type KpiKey =
  | 'priv_vs_group'
  | 'success_pct'
  | 'done'
  | 'pending'
  | 'canceled'
  | 'worked_hours'
  | 'income';

export interface ChartPoint {
  label: string;
  value: number;
}

interface LessonOccurrenceRow {
  occur_date: string | null;
  status: string | null;
  lesson_id?: UUID | null;
}

// ===============================
//        COMPONENT
// ===============================
@Component({
  selector: 'app-monthly-summary',
  standalone: true,
  templateUrl: './monthly-summary.html',
  styleUrls: ['./monthly-summary.scss'],
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatSelectModule,
    MatButtonModule,
    MatTableModule,
    MatProgressSpinnerModule,
  ],
})
export class MonthlySummaryComponent implements OnInit {
  private dbc = dbTenant();

  // אחרי kpiCharts:
  privVsGroupCharts = signal<{
    priv: ChartPoint[];
    group: ChartPoint[];
  }>({
    priv: [],
    group: [],
  });

  // --- הגדרות בסיס לגרף ---
  private readonly axisLeft = 40;
  private readonly axisRight = 580;
  private readonly axisTop = 20;
  private readonly axisBottom = 170;

  @Input() monthlyTitle = 'הסיכום החודשי שלי';
  @Input() yearlyTitle = 'הסיכום השנתי שלי';

  mode = signal<'month' | 'year'>('month');

  years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  months = [
    { v: 1, t: 'ינואר' },
    { v: 2, t: 'פברואר' },
    { v: 3, t: 'מרץ' },
    { v: 4, t: 'אפריל' },
    { v: 5, t: 'מאי' },
    { v: 6, t: 'יוני' },
    { v: 7, t: 'יולי' },
    { v: 8, t: 'אוגוסט' },
    { v: 9, t: 'ספטמבר' },
    { v: 10, t: 'אוקטובר' },
    { v: 11, t: 'נובמבר' },
    { v: 12, t: 'דצמבר' },
  ];

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  loading = false;

  viewMode: 'charts' | 'reports' = 'reports';
  selectedKpi: KpiKey = 'done';

  kpiCharts: Record<KpiKey, ChartPoint[]> = {
    priv_vs_group: [],
    success_pct: [],
    done: [],
    pending: [],
    canceled: [],
    worked_hours: [],
    income: [],
  };

  // ===============================
  //           FILTERS
  // ===============================
  typeFilter = signal<'all' | 'regular' | 'makeup'>('all');
  statusFilter = signal<'all' | 'pending' | 'approved' | 'canceled' | 'done'>(
    'all'
  );
  search = signal('');
  instructorFilter = signal<'all' | string>('all');

  // DATA
  lessons = signal<LessonRow[]>([]);
  payments = signal<PaymentRow[]>([]);
  cancelExceptions = signal<CancelExceptionRow[]>([]);
  occurrences = signal<LessonOccurrenceRow[]>([]);

  insights = signal<Insights>({
    totalLessons: 0,
    cancelPct: 0,
    successPct: 0,
    newStudents: 0,
    avgIncome: 0,
  });

  // ===============================
  //   Helpers for new VIEW rows
  // ===============================
  private timeFromTs(ts: string | null | undefined): string | null {
    if (!ts) return null;
    const part = ts.includes('T') ? ts.split('T')[1] : ts.split(' ')[1];
    if (!part) return null;
    return part.slice(0, 5); // HH:MM
  }

  private countPendingOccurrences(rows: LessonOccurrenceRow[]): number {
    return rows.filter(
      (o) => (o.status || '').trim() === 'ממתין לאישור'
    ).length;
  }

  private deriveStatus(raw: MonthlyReportRow): LessonStatus | null {
    const s = (raw.status || '').trim();
    if (
      s === 'אושר' ||
      s === 'בוטל' ||
      s === 'ממתין לאישור' ||
      s === 'הושלם' ||
      s === 'בוצע'
    ) {
      return s as LessonStatus;
    }

    if (raw.is_cancellation) return 'בוטל';
    if (raw.approval_id) return 'אושר';
    return 'ממתין לאישור';
  }

  private deriveLessonType(raw: MonthlyReportRow): LessonType | null {
    const t = (raw.lesson_type || '').trim();
    if (t === 'רגיל' || t === 'השלמה') return t as LessonType;

    if (raw.is_makeup_target) return 'השלמה';
    return 'רגיל';
  }

  // ===============================
  //    UI helper classes
  // ===============================
  statusClass(status: LessonStatus | null | undefined): string {
    switch (status) {
      case 'אושר':
        return 'status-approved';
      case 'בוטל':
        return 'status-canceled';
      case 'ממתין לאישור':
        return 'status-pending';
      case 'הושלם':
      case 'בוצע':
        return 'status-done';
      default:
        return 'status-default';
    }
  }

  // רשימת מדריכים ייחודית עבור ה-select
  instructors = computed<string[]>(() => {
    const set = new Set<string>();
    for (const l of this.lessons()) {
      const name = (l.instructor_name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  });

  filteredLessons = computed<LessonRow[]>(() => {
    const q = (this.search() || '').trim().toLowerCase();
    const type = this.typeFilter();
    const statusF = this.statusFilter();
    const instructorF = this.instructorFilter();
    const rows = this.lessons();

    const map: Record<string, LessonStatus[]> = {
      pending: ['ממתין לאישור'],
      approved: ['אושר'],
      canceled: ['בוטל'],
      done: ['הושלם', 'בוצע', 'אושר'],
      all: [],
    };

    return rows.filter((l: LessonRow) => {
      // סוג שיעור
      if (type === 'regular' && l.lesson_type !== 'רגיל') return false;
      if (type === 'makeup' && l.lesson_type !== 'השלמה') return false;

      // סטטוס
      if (statusF !== 'all') {
        const allowed = map[statusF];
        if (!l.status || !allowed.includes(l.status)) return false;
      }

      // מדריך
      if (instructorF !== 'all') {
        const instName = (l.instructor_name || '').trim();
        if (instName !== instructorF) return false;
      }

      // חיפוש טקסט חופשי
      if (q) {
        const childName =
          (l.child_full_name || '').trim() ||
          `${l.child_first_name || ''} ${l.child_last_name || ''}`.trim() ||
          `${l.child?.first_name || ''} ${l.child?.last_name || ''}`.trim();

        const hay = `${childName} ${l.lesson_type || ''} ${
          l.riding_type || ''
        } ${l.instructor_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  });

  // ===============================
  //            KPIs
  // ===============================
  kpis = computed<Kpis>(() => {
    const all = this.lessons();
    const cancels = this.cancelExceptions();
    const payRows = this.payments();
    const occs = this.occurrences();

    const income = payRows.reduce(
      (sum: number, p: PaymentRow) => sum + (p.amount ?? 0),
      0
    );

    if (!all.length && !cancels.length) {
      return {
        workedHours: '0:00',
        canceled: 0,
        done: 0,
        pending: 0,
        successPct: 0,
        privCount: 0,
        groupCount: 0,
        income,
      };
    }

    const doneStatuses: LessonStatus[] = ['הושלם', 'בוצע', 'אושר'];
    const done = all.filter(
      (l: LessonRow) => l.status && doneStatuses.includes(l.status)
    );
    const pendingCount = this.countPendingOccurrences(occs);

    const canceledInLessons = all.filter(
      (l: LessonRow) => l.status === 'בוטל'
    ).length;
    const canceledByExceptions = cancels.length;
    const canceled = canceledInLessons + canceledByExceptions;

    let minutes = 0;
    for (const l of done) {
      if (l.start_time && l.end_time) {
        const s = new Date(`1970-01-01T${l.start_time}`);
        const e = new Date(`1970-01-01T${l.end_time}`);
        minutes += (e.getTime() - s.getTime()) / 60000;
      }
    }

    const workedHours = `${Math.floor(minutes / 60)}:${(minutes % 60)
      .toString()
      .padStart(2, '0')}`;

    const totalForSuccess = all.length + canceledByExceptions;
    const successPct =
      totalForSuccess > 0
        ? Math.round((done.length / totalForSuccess) * 100)
        : 0;

    // === ספירת פרטי / לא־פרטי לפי סוג הרכיבה מה־view ===
    let privCount = 0;
    let groupCount = 0;

    for (const l of all) {
      const code = (l.riding_type_code || '').trim().toLowerCase();
      const name = (l.riding_type_name || '').trim();

      // אם אין בכלל סוג רכיבה – מדלגים
      if (!code && !name) continue;

      // פרטי = code 'private' או שהשם בעברית מכיל "פרטי"
      const isPrivate = code === 'private' || name.includes('פרטי');

      if (isPrivate) {
        // סופרים מספר שיעורים (לא לפי max_participants)
        privCount++;
      } else {
        // כל השאר – לא פרטי (קבוצתי/זוגי וכו')
        groupCount++;
      }
    }

    return {
      workedHours,
      canceled,
      done: done.length,
      pending: pendingCount,
      successPct,
      privCount,
      groupCount,
      income,
    };
  });

  // ===============================
  //   DERIVED TOTALS FOR CHART
  // ===============================

  // סכום שנתי של פרטי / קבוצתי – לפי ה-KPI
  get totalPrivate(): number {
    return this.kpis().privCount || 0;
  }

  get totalGroup(): number {
    return this.kpis().groupCount || 0;
  }

  // מקסימום לשני הקווים ביחד – נוח לשימוש מה־HTML
  get maxPrivGroup(): number {
    return this.maxPrivVsGroupValue();
  }
    // המספר השני על הציר – המינימום החיובי מבין פרטי / לא-פרטי
  get minPrivGroup(): number {
    const vals = [this.totalPrivate, this.totalGroup].filter((v) => v > 0);
    if (!vals.length) return 0;
    return Math.min(...vals);
  }


  // ===============================
  //        LOAD DATA
  // ===============================
  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;

    try {
      let from: string;
      let to: string;

      if (this.mode() === 'month') {
        const monthStart = new Date(this.year, this.month - 1, 1);
        const monthEnd = new Date(this.year, this.month, 0);
        from = monthStart.toISOString().slice(0, 10);
        to = monthEnd.toISOString().slice(0, 10);
      } else {
        const yearStart = new Date(this.year, 0, 1);
        const yearEnd = new Date(this.year, 11, 31);
        from = yearStart.toISOString().slice(0, 10);
        to = yearEnd.toISOString().slice(0, 10);
      }

      const lessonsViewName = 'lessons_schedule_view';

      const [
        { data: rawLessons, error: lessonsErr },
        { data: paymentsData, error: paymentsErr },
        { data: cancelsData, error: cancelsErr },
        { data: occurrencesData, error: occErr },
      ] = await Promise.all([
        this.dbc
          .from(lessonsViewName)
          .select('*')
          .gte('lesson_date', from)
          .lte('lesson_date', to)
          .order('lesson_date', { ascending: true })
          .order('start_time', { ascending: true })
          .order('instructor_name', { ascending: true }),

        this.dbc
          .from('payments')
          .select('amount,date,parent_uid,method,invoice_url')
          .gte('date', from)
          .lte('date', to),

        this.dbc
          .from('lesson_occurrence_exceptions')
          .select('occur_date,status,lesson_id,note')
          .gte('occur_date', from)
          .lte('occur_date', to),

        // טבלת ה-lessons_occurrences
        this.dbc
          .from('lessons_occurrences')
          .select('occur_date,status,lesson_id')
          .gte('occur_date', from)
          .lte('occur_date', to),
      ]);

      if (lessonsErr) throw lessonsErr;
      if (paymentsErr) throw paymentsErr;
      if (cancelsErr) throw cancelsErr;
      if (occErr) throw occErr;

      const rows = (rawLessons ?? []) as MonthlyReportRow[];

      const normalizedLessons: LessonRow[] = rows.map(
        (raw: MonthlyReportRow): LessonRow => {
          const childFull = (raw.child_name || '').trim() || null;
          const instructorName = (raw.instructor_name || '').trim() || null;

          const lessonType = this.deriveLessonType(raw);
          const status = this.deriveStatus(raw);

          // שדה נוח שמעדיף שם, ואם אין – קוד
          const ridingType =
            (raw.riding_type_name || '').trim() ||
            (raw.riding_type_code || '').trim() ||
            null;

          return {
            lesson_id: (raw.lesson_id ?? '') as UUID,
            occur_date: raw.lesson_date ?? null,

            start_time: raw.start_time ? raw.start_time.slice(0, 5) : null,
            end_time: raw.end_time ? raw.end_time.slice(0, 5) : null,

            lesson_type: lessonType,
            status,

            riding_type_code: raw.riding_type_code ?? null,
            riding_type_name: raw.riding_type_name ?? null,
            riding_type: ridingType,

            child_full_name: childFull,
            child_first_name: null,
            child_last_name: null,

            instructor_name: instructorName,
          };
        }
      );

      this.lessons.set(normalizedLessons);
      this.payments.set((paymentsData ?? []) as PaymentRow[]);
      this.cancelExceptions.set((cancelsData ?? []) as CancelExceptionRow[]);
      this.occurrences.set(
        (occurrencesData ?? []) as LessonOccurrenceRow[]
      );

      this.computeInsights(this.lessons());
      this.buildCharts();
    } catch (err: any) {
      console.error('❌ load summary failed', err);
      alert('שגיאה בטעינת נתונים: ' + (err?.message || 'ראה קונסול בדפדפן'));
    } finally {
      this.loading = false;
    }
  }

  // ===============================
  //       COMPUTE INSIGHTS
  // ===============================
  computeInsights(rows: LessonRow[]): void {
    const cancels = this.cancelExceptions();
    const payRows = this.payments();

    const incomeSum = payRows.reduce(
      (sum: number, p: PaymentRow) => sum + (p.amount ?? 0),
      0
    );
    const total = rows.length + cancels.length;

    if (!total) {
      this.insights.set({
        totalLessons: 0,
        cancelPct: 0,
        successPct: 0,
        newStudents: 0,
        avgIncome: 0,
      });
      return;
    }

    const canceledInLessons = rows.filter(
      (r: LessonRow) => r.status === 'בוטל'
    ).length;
    const canceledByExceptions = cancels.length;
    const canceledCount = canceledInLessons + canceledByExceptions;

    const doneStatuses: LessonStatus[] = ['הושלם', 'בוצע', 'אושר'];
    const doneCount = rows.filter((r: LessonRow) =>
      doneStatuses.includes((r.status ?? '') as LessonStatus)
    ).length;

    const cancelPct = Math.round((canceledCount / total) * 100);
    const successPct = Math.round((doneCount / total) * 100);

    const uniqueStudents = new Set(
      rows
        .map((r: LessonRow) =>
          (
            r.child_full_name ||
            `${r.child_first_name || ''} ${r.child_last_name || ''}`.trim()
          ).trim()
        )
        .filter((n: string) => !!n)
    );

    const newStudents = uniqueStudents.size;
    const avgIncome = total > 0 ? Math.round(incomeSum / total) : 0;

    this.insights.set({
      totalLessons: total,
      cancelPct,
      successPct,
      newStudents,
      avgIncome,
    });
  }

  // ===============================
  //        FILTER EVENTS
  // ===============================
  setMode(m: 'month' | 'year'): void {
    if (this.mode() === m) return;
    this.mode.set(m);

    if (m === 'month' && this.viewMode === 'charts') {
      this.viewMode = 'reports';
    }

    this.load();
  }

  onMonthChange(): void {
    this.load();
  }

  onYearChange(): void {
    this.load();
  }

  onTypeChange(v: 'all' | 'regular' | 'makeup'): void {
    this.typeFilter.set(v);
  }

  onStatusChange(v: 'all' | 'pending' | 'approved' | 'canceled' | 'done'): void {
    this.statusFilter.set(v);
  }

  onInstructorChange(v: string): void {
    this.instructorFilter.set(v);
  }

  onSearchChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.search.set(target.value);
  }

  clearSearch(): void {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
    this.instructorFilter.set('all');
  }

  // ===============================
  //        EXCEL EXPORT
  // ===============================
  async exportExcel(): Promise<void> {
    const rows = this.filteredLessons();

    try {
      const XLSXmod: any = await import('xlsx');
      const XLSX = XLSXmod.default ?? XLSXmod;

      const exportRows = rows.map((r: LessonRow) => ({
        'תאריך שיעור': r.occur_date ?? '',
        'תלמיד/ה':
          (
            r.child_full_name ||
            `${r.child_first_name || ''} ${r.child_last_name || ''}`.trim() ||
            ''
          ).trim(),
        'מדריך/ה': r.instructor_name ?? '',
        'סוג שיעור': r.lesson_type ?? '',
        'סוג רכיבה': r.riding_type ?? '',
        סטטוס: r.status ?? '',
        'שעת התחלה': r.start_time ?? '',
        'שעת סיום': r.end_time ?? '',
      }));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      const sheetName = this.mode() === 'month' ? 'Monthly' : 'Yearly';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const fileName =
        this.mode() === 'month'
          ? `monthly_${this.year}_${this.month}.xlsx`
          : `yearly_${this.year}.xlsx`;

      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error(e);
      alert('יש להתקין: npm i xlsx');
    }
  }

  // ===============================
  //      CHARTS & KPI VIEW
  // ===============================
  private buildCharts(): void {
    const lessons = this.lessons();
    const cancels = this.cancelExceptions();
    const pays = this.payments();
    const k = this.kpis();
    const occs = this.occurrences(); // לממתינים בלבד

    const doneStatuses: LessonStatus[] = ['הושלם', 'בוצע', 'אושר'];

    // מערכים לכל חודש (0–11)
    const doneByMonth = Array(12).fill(0);
    const pendingByMonth = Array(12).fill(0);
    const canceledByMonth = Array(12).fill(0);
    const minutesByMonth = Array(12).fill(0); // שעות עבודה
    const incomeByMonth = Array(12).fill(0);  // הכנסות
    const privByMonth = Array(12).fill(0);    // שיעורים פרטיים
    const groupByMonth = Array(12).fill(0);   // שיעורים לא-פרטיים

    // ---- DONE / CANCELED / שעות עבודה + פרטי/קבוצתי – לפי lessons_schedule_view ----
    for (const l of lessons) {
      if (!l.occur_date) continue;
      const d = new Date(l.occur_date);
      if (isNaN(d.getTime())) continue;

      const m = d.getMonth(); // 0–11

      // 1. סטטוס – בוצעו / בוטלו
      if (l.status && doneStatuses.includes(l.status)) {
        doneByMonth[m]++;

        if (l.start_time && l.end_time) {
          const s = new Date(`1970-01-01T${l.start_time}`);
          const e = new Date(`1970-01-01T${l.end_time}`);
          minutesByMonth[m] += (e.getTime() - s.getTime()) / 60000;
        }
      } else if (l.status === 'בוטל') {
        canceledByMonth[m]++;
      }

      // 2. פרטי / לא-פרטי לפי סוג רכיבה
      const code = (l.riding_type_code || '').trim().toLowerCase();
      const name = (l.riding_type_name || '').trim();

      if (!code && !name) continue;

      const isPrivate =
        code === 'private' ||
        name.includes('פרטי');

      if (isPrivate) {
        privByMonth[m]++;   // שיעור פרטי אחד
      } else {
        groupByMonth[m]++;  // שיעור לא-פרטי אחד
      }
    }

    // === הופכים את הספירה לחודשית לספירה מצטברת שנתית ===
    const privCumulativeByMonth = [...privByMonth];
    const groupCumulativeByMonth = [...groupByMonth];

    for (let i = 1; i < 12; i++) {
      privCumulativeByMonth[i] += privCumulativeByMonth[i - 1];
      groupCumulativeByMonth[i] += groupCumulativeByMonth[i - 1];
    }

    // ---- ממתינים – מטבלת lessons_occurrences ----
    for (const o of occs) {
      if (!o.occur_date) continue;
      const d = new Date(o.occur_date);
      if (isNaN(d.getTime())) continue;

      const m = d.getMonth();
      if ((o.status || '').trim() === 'ממתין לאישור') {
        pendingByMonth[m]++;
      }
    }

    // ביטולים מתוך exceptions
    for (const c of cancels) {
      if (!c.occur_date) continue;
      const d = new Date(c.occur_date);
      if (isNaN(d.getTime())) continue;
      const m = d.getMonth();
      canceledByMonth[m]++;
    }

    // הכנסות לפי חודשים – מטבלת payments
    for (const p of pays) {
      if (!p.date || p.amount == null) continue;
      const d = new Date(p.date);
      if (isNaN(d.getTime())) continue;
      const m = d.getMonth();
      incomeByMonth[m] += p.amount;
    }

    // ===== גרף קטן של הקובייה: פרטי / לא-פרטי =====
    this.kpiCharts.priv_vs_group = [
      { label: 'פרטי',    value: k.privCount },
      { label: 'לא פרטי', value: k.groupCount },
    ];

    // ===== גרפים של KPI =====

    // שיעורים שבוצעו
    this.kpiCharts.done = this.months.map((m) => ({
      label: m.t,
      value: doneByMonth[m.v - 1] ?? 0,
    }));

    // ממתינים
    this.kpiCharts.pending = this.months.map((m) => ({
      label: m.t,
      value: pendingByMonth[m.v - 1] ?? 0,
    }));

    // בוטלו
    this.kpiCharts.canceled = this.months.map((m) => ({
      label: m.t,
      value: canceledByMonth[m.v - 1] ?? 0,
    }));

    // פרטי מול קבוצתי – הגרף השנתי הגדול עם שני קווים (מצטבר)
    const privSeries: ChartPoint[] = [];
    const groupSeries: ChartPoint[] = [];

    let privRunning = 0;
    let groupRunning = 0;

    for (const m of this.months) {
      const idx = m.v - 1; // 0–11

      privRunning += privByMonth[idx] ?? 0;
      groupRunning += groupByMonth[idx] ?? 0;

      privSeries.push({
        label: m.t,
        value: privRunning,
      });

      groupSeries.push({
        label: m.t,
        value: groupRunning,
      });
    }

    this.privVsGroupCharts.set({ priv: privSeries, group: groupSeries });

    // אחוז הצלחה – סה"כ
    this.kpiCharts.success_pct = [{ label: 'סה״כ', value: k.successPct }];

    // שעות עבודה בשנה – לפי חודשים (שעות כמשהו עשרוני)
    this.kpiCharts.worked_hours = this.months.map((m) => ({
      label: m.t,
      value: (minutesByMonth[m.v - 1] || 0) / 60,
    }));

    // הכנסה שנתית – לפי חודשים
    this.kpiCharts.income = this.months.map((m) => ({
      label: m.t,
      value: incomeByMonth[m.v - 1] ?? 0,
    }));
  }

  onKpiClick(key: KpiKey): void {
    this.selectedKpi = key;
  }

  setViewMode(mode: 'charts' | 'reports'): void {
    if (mode === 'charts' && this.mode() === 'month') return;
    this.viewMode = mode;
  }

  maxChartValue(): number {
    const data = this.selectedChart();
    return data.reduce((m, p) => (p.value > m ? p.value : m), 0);
  }

  // מקסימום לשני קווים יחד (פרטי + קבוצתי)
  maxPrivVsGroupValue(): number {
    const series = this.privVsGroupCharts();
    const allPoints = [...series.priv, ...series.group];
    if (!allPoints.length) return 0;
    return allPoints.reduce((m, p) => (p.value > m ? p.value : m), 0);
  }

  // חישוב Y עם מקסימום שמקבלים מבחוץ (לגרף מרובה–קווים)
  getPointYWithMax(value: number, max: number): number {
    const safeMax = max || 1;
    const plotHeight = this.axisBottom - this.axisTop;
    return this.axisBottom - (value / safeMax) * plotHeight;
  }

  // בניית polyline לסדרה אחת (משתמשים בה פעמיים – פרטי + קבוצתי)
  buildPolylineFor(series: ChartPoint[], max: number): string {
    const total = series.length;
    if (!total) return '';
    return series
      .map(
        (p, i) =>
          `${this.getPointX(i, total)},${this.getPointYWithMax(
            p.value,
            max
          )}`
      )
      .join(' ');
  }

  getPointX(index: number, total: number): number {
    if (total <= 1) return (this.axisLeft + this.axisRight) / 2;
    const step = (this.axisRight - this.axisLeft) / (total - 1);
    return this.axisLeft + index * step;
  }

  getPointY(value: number): number {
    const max = this.maxChartValue() || 1;
    const plotHeight = this.axisBottom - this.axisTop;
    return this.axisBottom - (value / max) * plotHeight;
  }

  buildPolyline(): string {
    const data = this.selectedChart();
    const total = data.length;
    return data
      .map((p, i) => `${this.getPointX(i, total)},${this.getPointY(p.value)}`)
      .join(' ');
  }

  selectedChart(): ChartPoint[] {
    return this.kpiCharts[this.selectedKpi] ?? [];
  }

  getBarHeight(point: ChartPoint): number {
    const data = this.selectedChart();
    const max = data.reduce((m, p) => (p.value > m ? p.value : m), 0);
    if (!max) return 0;
    return (point.value / max) * 100;
  }

  kpiLabel(key: KpiKey): string {
    switch (key) {
      case 'priv_vs_group':
        return 'פרטי מול קבוצתי';
      case 'success_pct':
        return 'אחוז הצלחה';
      case 'done':
        return 'שיעורים שבוצעו';
      case 'pending':
        return 'ממתינים';
      case 'canceled':
        return 'בוטלו';
      case 'worked_hours':
        return 'שעות עבודה';
      case 'income':
        return 'הכנסה';
      default:
        return '';
    }
  }

  // === קיבוץ שורות של אותו שיעור בטבלה ===
  private isSameLesson(
    a: LessonRow | undefined,
    b: LessonRow | undefined
  ): boolean {
    if (!a || !b) return false;
    if (!a.lesson_id || !b.lesson_id) return false;
    return a.lesson_id === b.lesson_id;
  }

  isSameLessonAsPrev(index: number): boolean {
    const rows = this.filteredLessons();
    if (index <= 0 || index >= rows.length) return false;
    return this.isSameLesson(rows[index], rows[index - 1]);
  }

  // מפתח קבוצה: מדריך + תאריך + התחלה + סיום
  private groupKey(l: LessonRow | null | undefined): string {
    if (!l) return '';
    return [
      (l.occur_date || '').trim(),
      (l.start_time || '').trim(),
      (l.end_time || '').trim(),
      (l.instructor_name || '').trim(),
    ].join('|');
  }

  private isSameGroup(a?: LessonRow, b?: LessonRow): boolean {
    if (!a || !b) return false;
    return this.groupKey(a) === this.groupKey(b);
  }

  // האם זו השורה הראשונה בקבוצה
  isGroupFirst(index: number): boolean {
    const rows = this.filteredLessons();
    if (index <= 0) return true;
    return !this.isSameGroup(rows[index], rows[index - 1]);
  }

  // האם זו שורה המשך (לא ראשונה)
  isGroupContinuation(index: number): boolean {
    const rows = this.filteredLessons();
    if (index <= 0 || index >= rows.length) return false;
    return this.isSameGroup(rows[index], rows[index - 1]);
  }

  isGroupLast(index: number): boolean {
    const rows = this.filteredLessons();
    if (index < 0 || index >= rows.length - 1) return true;
    return !this.isSameGroup(rows[index], rows[index + 1]);
  }

  isGroupMiddle(index: number): boolean {
    return !this.isGroupFirst(index) && !this.isGroupLast(index);
  }
}

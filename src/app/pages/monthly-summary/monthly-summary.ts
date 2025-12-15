// app/.../monthly-summary.component.ts
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

  // יש לנו לפעמים child כ־json (תלוי ב־view)
  child?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;

  // שדות שטוחים מה־view (אם קיימים)
  child_first_name?: string | null;
  child_last_name?: string | null;
  child_full_name?: string | null;

  // מדריך
  instructor_uid?: string | null;
  instructor_first_name?: string | null;
  instructor_last_name?: string | null;

  /** שם מדריך שישמש למסך ולחיפוש */
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
  // ✅ חשוב: מאתחלים מיד! (זה הפתרון ל-getSession undefined)
  private dbc = dbTenant();

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
  statusFilter = signal<'all' | 'pending' | 'approved' | 'canceled' | 'done'>('all');
  search = signal('');
  instructorFilter = signal<'all' | string>('all');

  // DATA
  lessons = signal<LessonRow[]>([]);
  payments = signal<PaymentRow[]>([]);
  cancelExceptions = signal<CancelExceptionRow[]>([]);

  insights = signal<Insights>({
    totalLessons: 0,
    cancelPct: 0,
    successPct: 0,
    newStudents: 0,
    avgIncome: 0,
  });

  statusClass(status: LessonStatus | null | undefined): string {
    switch (status) {
      case 'אושר': return 'status-approved';
      case 'בוטל': return 'status-canceled';
      case 'ממתין לאישור': return 'status-pending';
      case 'הושלם':
      case 'בוצע': return 'status-done';
      default: return 'status-default';
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

  filteredLessons = computed(() => {
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

    return rows.filter((l) => {
      if (type === 'regular' && l.lesson_type !== 'רגיל') return false;
      if (type === 'makeup' && l.lesson_type !== 'השלמה') return false;

      if (statusF !== 'all') {
        const allowed = map[statusF];
        if (!l.status || !allowed.includes(l.status)) return false;
      }

      if (instructorF !== 'all') {
        const instName = (l.instructor_name || '').trim();
        if (instName !== instructorF) return false;
      }

      if (q) {
        const childName =
          (l.child_full_name || '').trim() ||
          `${l.child_first_name || ''} ${l.child_last_name || ''}`.trim() ||
          `${l.child?.first_name || ''} ${l.child?.last_name || ''}`.trim();

        const hay = `${childName} ${l.lesson_type || ''} ${l.instructor_name || ''}`.toLowerCase();
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

    const income = payRows.reduce((sum, p) => sum + (p.amount ?? 0), 0);

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
    const done = all.filter((l) => l.status && doneStatuses.includes(l.status));
    const pending = all.filter((l) => l.status === 'ממתין לאישור');

    const canceledInLessons = all.filter((l) => l.status === 'בוטל').length;
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

    const workedHours = `${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, '0')}`;

    const totalForSuccess = all.length + canceledByExceptions;
    const successPct = totalForSuccess > 0 ? Math.round((done.length / totalForSuccess) * 100) : 0;

    return {
      workedHours,
      canceled,
      done: done.length,
      pending: pending.length,
      successPct,
      privCount: all.filter((l) => l.lesson_type === 'רגיל').length,
      groupCount: all.filter((l) => l.lesson_type === 'השלמה').length,
      income,
    };
  });

  // ===============================
  //        LOAD DATA
  // ===============================
  ngOnInit() {
    this.load();
  }

  async load() {
    this.loading = true;

    // ✅ debug שלא מפיל את המסך
    try {
      const sessionRes = await this.dbc.auth.getSession();
      console.log('SESSION 👉', sessionRes.data?.session);
    } catch (e) {
      console.warn('getSession failed (non-blocking):', e);
    }

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

      // ✅ מקור הנתונים: ה-view שעובד ומכיל שמות מדריכים (לפי התמונות)
      const lessonsViewName = 'monthly_lessons_report_v2';

      const [
        { data: lessonsData, error: lessonsErr },
        { data: paymentsData, error: paymentsErr },
        { data: cancelsData, error: cancelsErr },
      ] = await Promise.all([
        this.dbc
          .from(lessonsViewName)
          .select('*')
          .gte('occur_date', from)
          .lte('occur_date', to)
          .order('occur_date', { ascending: true }),

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
      ]);

      if (lessonsErr) throw lessonsErr;
      if (paymentsErr) throw paymentsErr;
      if (cancelsErr) throw cancelsErr;

      // ✅ normalize לפי שדות שמגיעים מה-view + fallback ל-json אם קיים
      const normalizedLessons: LessonRow[] = (lessonsData ?? []).map((raw: any) => {
        const childFull =
          (raw.child_full_name || '').trim() ||
          `${raw.child_first_name || ''} ${raw.child_last_name || ''}`.trim() ||
          `${raw.child?.first_name || ''} ${raw.child?.last_name || ''}`.trim();

        const instructorFull =
          (raw.instructor_name || '').trim() ||
          `${raw.instructor_first_name || ''} ${raw.instructor_last_name || ''}`.trim() ||
          `${raw.instructor?.first_name || ''} ${raw.instructor?.last_name || ''}`.trim();

        return {
          ...raw,
          child: raw.child ?? null,
          child_full_name: childFull || null,
          instructor_name: instructorFull || null,
        } as LessonRow;
      });

      this.lessons.set(normalizedLessons);
      this.payments.set((paymentsData ?? []) as PaymentRow[]);
      this.cancelExceptions.set((cancelsData ?? []) as CancelExceptionRow[]);

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
  computeInsights(rows: LessonRow[]) {
    const cancels = this.cancelExceptions();
    const payRows = this.payments();

    const incomeSum = payRows.reduce((sum, p) => sum + (p.amount ?? 0), 0);
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

    const canceledInLessons = rows.filter((r) => r.status === 'בוטל').length;
    const canceledByExceptions = cancels.length;
    const canceledCount = canceledInLessons + canceledByExceptions;

    const doneStatuses: LessonStatus[] = ['הושלם', 'בוצע', 'אושר'];
    const doneCount = rows.filter((r) => doneStatuses.includes((r.status ?? '') as LessonStatus)).length;

    const cancelPct = Math.round((canceledCount / total) * 100);
    const successPct = Math.round((doneCount / total) * 100);

    const uniqueStudents = new Set(
      rows
        .map((r) => (r.child_full_name || `${r.child_first_name || ''} ${r.child_last_name || ''}`.trim()).trim())
        .filter((n) => !!n)
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
  setMode(m: 'month' | 'year') {
    if (this.mode() === m) return;
    this.mode.set(m);

    if (m === 'month' && this.viewMode === 'charts') {
      this.viewMode = 'reports';
    }

    this.load();
  }

  onMonthChange() { this.load(); }
  onYearChange() { this.load(); }

  onTypeChange(v: any) { this.typeFilter.set(v); }
  onStatusChange(v: any) { this.statusFilter.set(v); }
  onInstructorChange(v: any) { this.instructorFilter.set(v); }

  onSearchChange(e: any) { this.search.set(e.target.value); }

  clearSearch() {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
    this.instructorFilter.set('all');
  }

  // ===============================
  //        EXCEL EXPORT
  // ===============================
  async exportExcel() {
    const rows = this.filteredLessons();

    try {
      const XLSXmod: any = await import('xlsx');
      const XLSX = XLSXmod.default ?? XLSXmod;

      const exportRows = rows.map((r) => ({
        'תאריך שיעור': r.occur_date ?? '',
        'תלמיד/ה': (r.child_full_name || `${r.child_first_name || ''} ${r.child_last_name || ''}`.trim() || '').trim(),
        'מדריך/ה': r.instructor_name ?? '',
        'סוג שיעור': r.lesson_type ?? '',
        'סטטוס': r.status ?? '',
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
  private buildCharts() {
    const lessons = this.lessons();
    const cancels = this.cancelExceptions();
    const pays = this.payments();
    const k = this.kpis();

    const doneStatuses: LessonStatus[] = ['הושלם', 'בוצע', 'אושר'];

    const doneByMonth = Array(12).fill(0);
    const pendingByMonth = Array(12).fill(0);
    const canceledByMonth = Array(12).fill(0);

    for (const l of lessons) {
      if (!l.occur_date) continue;
      const d = new Date(l.occur_date);
      const monthIndex = d.getMonth();

      if (l.status && doneStatuses.includes(l.status)) doneByMonth[monthIndex]++;
      else if (l.status === 'ממתין לאישור') pendingByMonth[monthIndex]++;
      else if (l.status === 'בוטל') canceledByMonth[monthIndex]++;
    }

    for (const c of cancels) {
      if (!c.occur_date) continue;
      const d = new Date(c.occur_date);
      canceledByMonth[d.getMonth()]++;
    }

    this.kpiCharts.done = this.months.map((m) => ({ label: m.t, value: doneByMonth[m.v - 1] ?? 0 }));
    this.kpiCharts.pending = this.months.map((m) => ({ label: m.t, value: pendingByMonth[m.v - 1] ?? 0 }));
    this.kpiCharts.canceled = this.months.map((m) => ({ label: m.t, value: canceledByMonth[m.v - 1] ?? 0 }));

    this.kpiCharts.priv_vs_group = [
      { label: 'פרטי', value: k.privCount },
      { label: 'קבוצתי', value: k.groupCount },
    ];

    this.kpiCharts.success_pct = [{ label: 'סה״כ', value: k.successPct }];

    this.kpiCharts.worked_hours = [
      { label: 'סה״כ שעות', value: this.parseHoursToNumber(k.workedHours) },
    ];

    const totalIncome = pays.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    this.kpiCharts.income = [{ label: 'סה״כ', value: totalIncome }];
  }

  private parseHoursToNumber(hhmm: string): number {
    if (!hhmm) return 0;
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr) || 0;
    const m = Number(mStr) || 0;
    return h + m / 60;
  }

  onKpiClick(key: KpiKey) {
    this.selectedKpi = key;
  }

  setViewMode(mode: 'charts' | 'reports') {
    if (mode === 'charts' && this.mode() === 'month') return;
    this.viewMode = mode;
  }

  maxChartValue(): number {
    const data = this.selectedChart();
    return data.reduce((m, p) => (p.value > m ? p.value : m), 0);
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
      case 'priv_vs_group': return 'פרטי מול קבוצתי';
      case 'success_pct': return 'אחוז הצלחה';
      case 'done': return 'שיעורים שבוצעו';
      case 'pending': return 'ממתינים';
      case 'canceled': return 'בוטלו';
      case 'worked_hours': return 'שעות עבודה';
      case 'income': return 'הכנסה';
    }
  }
}

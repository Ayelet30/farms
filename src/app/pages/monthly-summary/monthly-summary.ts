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
  child_id: UUID;
  lesson_type: LessonType | null;
  status: LessonStatus | null;
  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  child?: {
    first_name?: string | null;
    last_name?: string | null;
  };
  anchor_week_start: string;
  occur_date?: string | null;
  child_full_name?: string | null;
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
  status?: string | null;  // בדרך כלל "בוטל"
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

  /** כותרות – אפשר להחליף במסך חווה */
  @Input() monthlyTitle = 'הסיכום החודשי שלי';
  @Input() yearlyTitle = 'הסיכום השנתי שלי';

  /** מצב: חודשי / שנתי */
  mode = signal<'month' | 'year'>('month');

  years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  months = [
    { v: 1, t: 'ינואר' }, { v: 2, t: 'פברואר' }, { v: 3, t: 'מרץ' },
    { v: 4, t: 'אפריל' }, { v: 5, t: 'מאי' }, { v: 6, t: 'יוני' },
    { v: 7, t: 'יולי' }, { v: 8, t: 'אוגוסט' }, { v: 9, t: 'ספטמבר' },
    { v: 10, t: 'אוקטובר' }, { v: 11, t: 'נובמבר' }, { v: 12, t: 'דצמבר' },
  ];

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  loading = false;

  // פילטרים
  typeFilter = signal<'all' | 'regular' | 'makeup'>('all');
  statusFilter = signal<'all' | 'pending' | 'approved' | 'canceled' | 'done'>('all');
  search = signal('');

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

  // ===============================
  //      FILTERED LESSONS
  // ===============================
  filteredLessons = computed(() => {
    const q = (this.search() || '').trim().toLowerCase();
    const type = this.typeFilter();
    const statusF = this.statusFilter();
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
        if (!l.status || !map[statusF].includes(l.status)) return false;
      }

      if (q) {
        const hay = `${l.child?.first_name || ''} ${l.child?.last_name || ''} ${l.lesson_type || ''}`.toLowerCase();
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

    const income = payRows.reduce(
      (sum, p) => sum + (p.amount ?? 0),
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

    const doneStatuses = ['הושלם', 'בוצע', 'אושר'];
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

    const workedHours = `${Math.floor(minutes / 60)}:${(minutes % 60)
      .toString()
      .padStart(2, '0')}`;

    const totalForSuccess = all.length + canceledByExceptions; // שיעורים + ביטולים מטבלת חריגות
    const successPct =
      totalForSuccess > 0
        ? Math.round((done.length / totalForSuccess) * 100)
        : 0;

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

      // טוענים שלוש טבלאות במקביל
      const [
        { data: lessonsData, error: lessonsErr },
        { data: paymentsData, error: paymentsErr },
        { data: cancelsData, error: cancelsErr },
      ] = await Promise.all([
        this.dbc
          .from('lessons_with_children')
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

      this.lessons.set((lessonsData ?? []) as LessonRow[]);
      this.payments.set((paymentsData ?? []) as PaymentRow[]);
      this.cancelExceptions.set((cancelsData ?? []) as CancelExceptionRow[]);

      this.computeInsights(this.lessons());
    } catch (err) {
      console.error('❌ load summary failed', err);
      alert('שגיאה בטעינת נתונים');
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

    const incomeSum = payRows.reduce(
      (sum, p) => sum + (p.amount ?? 0),
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

    const canceledInLessons = rows.filter((r) => r.status === 'בוטל').length;
    const canceledByExceptions = cancels.length;
    const canceledCount = canceledInLessons + canceledByExceptions;

    const doneStatuses = ['הושלם', 'בוצע', 'אושר'];
    const doneCount = rows.filter((r) =>
      doneStatuses.includes((r.status ?? '') as LessonStatus)
    ).length;

    const cancelPct = Math.round((canceledCount / total) * 100);
    const successPct = Math.round((doneCount / total) * 100);

    const uniqueStudents = new Set(
      rows
        .map(
          (r) =>
            `${r.child?.first_name || ''} ${r.child?.last_name || ''}`.trim()
        )
        .filter((n) => !!n)
    );

    const newStudents = uniqueStudents.size;

    const avgIncome =
      total > 0 ? Math.round(incomeSum / total) : 0;

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
    this.load();
  }

  onMonthChange() {
    this.load();
  }

  onYearChange() {
    this.load();
  }

  onTypeChange(v: any) {
    this.typeFilter.set(v);
  }

  onStatusChange(v: any) {
    this.statusFilter.set(v);
  }

  onSearchChange(e: any) {
    this.search.set(e.target.value);
  }

  clearSearch() {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
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
        'תלמיד/ה': `${r.child?.first_name || ''} ${
          r.child?.last_name || ''
        }`.trim(),
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
}

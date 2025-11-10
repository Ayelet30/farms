import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { dbTenant } from '../../services/supabaseClient.service';

type UUID = string;
type LessonStatus = 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם' | 'בוצע';
type LessonType = 'רגיל' | 'השלמה';

interface LessonRow {
  id: UUID;
  lesson_type: LessonType | null;
  status: LessonStatus | null;
  anchor_week_start: string;
  start_time?: string | null;
  end_time?: string | null;
  child?: { full_name?: string | null };
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

interface Insights {
  totalLessons: number;
  cancelPct: number;
  successPct: number;
  newStudents: number;
  avgIncome: number;
}

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

  years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);
  months = [
    { v: 1, t: 'ינואר' }, { v: 2, t: 'פברואר' }, { v: 3, t: 'מרץ' },
    { v: 4, t: 'אפריל' }, { v: 5, t: 'מאי' }, { v: 6, t: 'יוני' },
    { v: 7, t: 'יולי' }, { v: 8, t: 'אוגוסט' }, { v: 9, t: 'ספטמבר' },
    { v: 10, t: 'אוקטובר' }, { v: 11, t: 'נובמבר' }, { v: 12, t: 'דצמבר' },
  ];

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  loading = false;

  typeFilter = signal<'all' | 'regular' | 'makeup'>('all');
  statusFilter = signal<'all' | 'pending' | 'approved' | 'canceled' | 'done'>('all');
  search = signal('');
  lessons = signal<LessonRow[]>([]);
  insights = signal<Insights>({
    totalLessons: 0,
    cancelPct: 0,
    successPct: 0,
    newStudents: 0,
    avgIncome: 0,
  });

  filteredLessons = computed(() => {
    const q = (this.search() || '').trim().toLowerCase();
    const type = this.typeFilter();
    const statusF = this.statusFilter();
    const items = this.lessons();

    return items.filter((l) => {
      if (type === 'regular' && l.lesson_type !== 'רגיל') return false;
      if (type === 'makeup' && l.lesson_type !== 'השלמה') return false;
      if (statusF !== 'all') {
        const map: Record<'pending' | 'approved' | 'canceled' | 'done', LessonStatus[]> = {
          pending: ['ממתין לאישור'],
          approved: ['אושר'],
          canceled: ['בוטל'],
          done: ['הושלם', 'בוצע', 'אושר'],
        };
        if (!l.status || !map[statusF].includes(l.status)) return false;
      }
      if (q) {
        const hay = `${l.child?.full_name || ''} ${l.lesson_type || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  kpis = computed<Kpis>(() => {
    const all = this.lessons();
    if (!all.length)
      return {
        workedHours: '0:00',
        canceled: 0,
        done: 0,
        pending: 0,
        successPct: 0,
        privCount: 0,
        groupCount: 0,
        income: 0,
      };

    const doneStatuses = ['הושלם', 'בוצע', 'אושר'];
    const canceledStatuses = ['בוטל'];
    const pendingStatuses = ['ממתין לאישור', 'בהמתנה'];

    const done = all.filter((l) => !!l.status && doneStatuses.includes(l.status));
    const canceled = all.filter((l) => !!l.status && canceledStatuses.includes(l.status));
    const pending = all.filter((l) => !!l.status && pendingStatuses.includes(l.status));

    let minutes = 0;
    for (const l of done) {
      if (l.start_time && l.end_time) {
        const s = new Date(`1970-01-01T${l.start_time}`);
        const e = new Date(`1970-01-01T${l.end_time}`);
        const diff = (e.getTime() - s.getTime()) / 60000;
        if (diff > 0 && Number.isFinite(diff)) minutes += diff;
      }
    }

    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    const workedHours = `${h}:${m.toString().padStart(2, '0')}`;

    const privCount = all.filter((l) => l.lesson_type === 'רגיל').length;
    const groupCount = all.filter((l) => l.lesson_type === 'השלמה').length;
    const successPct = all.length ? Math.round((done.length / all.length) * 100) : 0;
    const hourlyRate = 120;
    const income = Math.round((minutes / 60) * hourlyRate);

    return { workedHours, canceled: canceled.length, done: done.length, pending: pending.length, successPct, privCount, groupCount, income };
  });

  ngOnInit(): void {
    this.load();
  }

  async load() {
    this.loading = true;
    try {
      const start = new Date(this.year, this.month - 1, 1);
      const end = new Date(this.year, this.month, 0);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);

      const { data, error } = await this.dbc
        .from('lessons')
        .select(`id, lesson_type, status, anchor_week_start, start_time, end_time, child:children(full_name)`)
        .gte('anchor_week_start', startDate)
        .lte('anchor_week_start', endDate)
        .order('anchor_week_start', { ascending: true });

      if (error) throw error;
      const rows = (data || []) as LessonRow[];
      this.lessons.set(rows);
      this.computeInsights(rows);
    } catch (e) {
      console.error('❌ load monthly summary failed', e);
      alert('שגיאה בטעינת הנתונים.');
    } finally {
      this.loading = false;
    }
  }

  onMonthChange() {
    this.load();
  }

  onTypeChange(value: 'all' | 'regular' | 'makeup') {
    this.typeFilter.set(value);
  }

  onStatusChange(value: 'all' | 'pending' | 'approved' | 'canceled' | 'done') {
    this.statusFilter.set(value);
  }

  onSearchChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.search.set(input.value);
  }

  clearSearch() {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
  }

  computeInsights(rows: LessonRow[]) {
    if (!rows || !rows.length) {
      this.insights.set({ totalLessons: 0, cancelPct: 0, successPct: 0, newStudents: 0, avgIncome: 0 });
      return;
    }

    const total = rows.length;
    const doneStatuses = ['הושלם', 'בוצע', 'אושר'];
    const canceled = rows.filter(r => r.status === 'בוטל').length;
    const done = rows.filter(r => doneStatuses.includes(r.status || '')).length;
    const cancelPct = Math.round((canceled / total) * 100);
    const successPct = Math.round((done / total) * 100);
    const uniqueStudents = new Set(rows.map(r => r.child?.full_name || '').filter(n => !!n));
    const newStudents = uniqueStudents.size;

    let minutes = 0;
    for (const l of rows) {
      if (l.start_time && l.end_time) {
        const s = new Date(`1970-01-01T${l.start_time}`);
        const e = new Date(`1970-01-01T${l.end_time}`);
        const diff = (e.getTime() - s.getTime()) / 60000;
        if (diff > 0 && Number.isFinite(diff)) minutes += diff;
      }
    }

    const hourlyRate = 120;
    const totalIncome = (minutes / 60) * hourlyRate;
    const avgIncome = Math.round(totalIncome / total);

    this.insights.set({ totalLessons: total, cancelPct, successPct, newStudents, avgIncome });
  }

  async exportExcel() {
    const rows = this.filteredLessons();
    try {
      const XLSX: any = await import('xlsx');
      const exportRows = rows.map((r) => ({
        'תאריך': r.anchor_week_start,
        'תלמיד/ה': r.child?.full_name || '',
        'סוג שיעור': r.lesson_type || '',
        'סטטוס': r.status || '',
        'שעת התחלה': r.start_time || '',
        'שעת סיום': r.end_time || '',
      }));
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Monthly');
      XLSX.writeFile(wb, `monthly_${this.year}_${this.month}.xlsx`);
    } catch {
      alert('יש להתקין: npm i xlsx');
    }
  }

  async exportPdf() {
    const rows = this.filteredLessons();
    try {
      const jsPDF: any = (await import('jspdf')).default;
      await import('jspdf-autotable');

      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFont('helvetica', 'normal');
      const head = [['תאריך', 'תלמיד/ה', 'סוג שיעור', 'סטטוס', 'התחלה', 'סיום']];
      const body = rows.map((r) => [
        r.anchor_week_start,
        r.child?.full_name || '',
        r.lesson_type || '',
        r.status || '',
        r.start_time || '',
        r.end_time || '',
      ]);
      (doc as any).autoTable({
        head,
        body,
        styles: { halign: 'right' },
        theme: 'grid',
      });
      doc.save(`monthly_${this.year}_${this.month}.pdf`);
    } catch {
      alert('חיש להתקין: npm i jspdf jspdf-autotable');
    }
  }
}

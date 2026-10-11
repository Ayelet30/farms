import { Component, OnInit, OnDestroy, computed, signal, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../services/ui-dialog.service';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { getAuth } from 'firebase/auth';

import { DB_TENANT } from '../../services/db-tenant.token';

// ===============================
//       TYPE DEFINITIONS
// ===============================
type UUID = string;

interface ManagementBillingRow {
  month: number;
  status: string;
  currency: string;
  chargeCount: number;
  parentCount: number;
  amountAgorot: number;
}

interface ManagementDbResponse<T> {
  data: T | null;
  error: { code?: string; message: string; details?: string; hint?: string } | null;
}

interface ManagementInstructorRow {
  id_number: string | number;
  first_name: string | null;
  last_name: string | null;
}
type LessonStatus = 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם';
type LessonType = 'רגיל' | 'השלמה';

type MonthlyReportRow = {
  lesson_id?: UUID | null;
  lesson_date: string | null;
  start_time: string | null;
  end_time: string | null;
  office_note?: string | null;
  instructor_note?: string | null;

  status?: string | null;
  child_name?: string | null;
  instructor_name?: string | null;

  instructor_uid?: string | null;

  riding_type_code?: string | null;
  riding_type_name?: string | null;

  approval_id?: UUID | null;
  is_cancellation?: boolean | null;
  is_makeup_target?: boolean | null;
  lesson_type?: string | null;
  child_id?: UUID | null;
  instructor_id?: string | number | null;
  lesson_price_agorot?: number | null;

  canceller_role?: string | null;
  is_billable?: boolean | null;
  is_makeup_allowed?: boolean | null;
  occur_date?: string | null;
};

interface LessonRow {
  lesson_id: UUID;
  child_id?: UUID | null;
  office_note?: string | null;
  instructor_note?: string | null;

  lesson_type: LessonType | null;
  status: LessonStatus | null;

  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;

  occur_date?: string | null;
  anchor_week_start?: string;

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
  instructor_id?: string | number | null;
  appointment_kind?: string | null;
  payment_plan_id?: UUID | null;
  lesson_price_agorot?: number | null;

  canceller_role?: string | null;
  is_billable?: boolean | null;
  is_makeup_allowed?: boolean | null;
}
interface LessonNoteRow {
  lesson_id: UUID;
  child_id: UUID | null;
  occur_date: string | null;
  note: string | null;
  category: string | null;
  created_at?: string | null;
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
  canceledByFarmOrInstructor: number;
canceledByParents: number;
completedMakeups: number;
}

type KpiKey =
  | 'priv_vs_group'
  | 'success_pct'
  | 'done'
  | 'pending'
  | 'canceled'
  | 'worked_hours'
  | 'income'
  | 'canceled_by_parents'
| 'canceled_by_team'
| 'completed_makeups';

export interface ChartPoint {
  label: string;
  value: number;
}

interface LessonOccurrenceRow {
  occur_date: string | null;
  status: string | null;
  lesson_id?: UUID | null;
}

interface OccWithAttendanceRow {
  occur_date: string | null;
  status: string | null;
  lesson_id?: UUID | null;
  is_cancellation?: boolean | null;
  attendance_status?: string | null;
  lesson_type?: string | null;
}

interface InstructorBreakRow {
  instructor_id_number: string;
  break_date: string;
  start_time: string;
  end_time: string;
  duration_minutes?: number | null;
}

interface InstructorUnavailabilityRow {
  instructor_id_number: string;
  from_ts: string;
  to_ts: string;
  reason?: string | null;
  category?: string | null;
  all_day: boolean;
}

interface ManagementMonth {
  month: number;
  fund: string;

  activeChildren: number | null;
  scheduledChildren: number;
  lessonCount?: number | null;

  present: number;
  absent: number;
  unknownAttendance: number;
  canceled: number;

  plannedValueAgorot: number | null;
  dueAgorot: number | null;
  receivedAgorot: number | null;
  overdueAgorot: number | null;
  openBalanceAgorot: number;

  eligible: number | null;
  reported: number | null;
  accepted: number | null;
  rejected: number | null;
  conflictingClaims: number;

  forecastAgorot: number | null;
  forecastLowAgorot: number | null;
  forecastHighAgorot: number | null;
}

interface ManagementPayload {
  version: 1;
  year: number;
  asOf: string;
  instructorId: string | null;

  months: ManagementMonth[];

  forecastBasis: string;
  activeBasis: string;
  receiptBasis: string;

  lowBalanceChildren: number;
  unallocatedAgorot: number;
  scope: string;
}

interface AnnualActivity {
  month: number;
  children: number;
  lessons: number;
  canceled: number;
  hours: number;
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
    MatTooltipModule,
  ],
})
export class MonthlySummaryComponent implements OnInit, OnDestroy {
  private dbTenantFactory = inject(DB_TENANT);
  private ui = inject(UiDialogService);

  private dbc = this.dbTenantFactory();
  private route = inject(ActivatedRoute);
  private router = inject(Router);



  readonly isSecretary = signal<boolean>(true);

  readonly baseColumns = [
    'date',
    'student',
    'instructor',
    'type',
    'ridingType',
    'status',
    'start',
    'end',
  ];

  lesson_price_agorot?: number | null;

  canceller_role?: string | null;
is_billable?: boolean | null;
is_makeup_allowed?: boolean | null;



  readonly displayedColumns = computed(() =>
    this.isSecretary()
      ? [...this.baseColumns, 'office_note', 'instructor_note']
      : this.baseColumns
  );


  // ✅ Safe debug logger: runs only on localhost/dev and never prints sensitive payloads
  private readonly isDev =
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')) ||
    false;

  private debug(msg: string, meta?: Record<string, unknown>): void {
    if (!this.isDev) return;
    // Never print raw rows / uids / names
    const safeMeta = meta ? JSON.parse(JSON.stringify(meta)) : undefined;
    // eslint-disable-next-line no-console
  }

  privVsGroupCharts = signal<{ priv: ChartPoint[]; group: ChartPoint[] }>({
    priv: [],
    group: [],
  });

  readonly axisLeft = 40;
  readonly axisRight = 580;
  readonly axisTop = 20;
  readonly axisBottom = 170;

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
    canceled_by_parents: [],
    canceled_by_team: [],
    completed_makeups: [],
  };

  maxIndex(series: 'priv' | 'group'): number {
    const s =
      series === 'priv' ? this.privVsGroupCharts().priv : this.privVsGroupCharts().group;
    if (!s.length) return -1;

    let maxI = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i].value > s[maxI].value) maxI = i;
    }
    return maxI;
  }

  isMaxIndex(series: 'priv' | 'group', index: number): boolean {
    return index === this.maxIndex(series);
  }

  // ===============================
  //           FILTERS
  // ===============================
  typeFilter = signal<'all' | 'regular' | 'makeup'>('all');
  statusFilter = signal<'all' | 'pending' | 'approved' | 'canceled' | 'done'>('all');
  search = signal('');
  childSearch = signal('');

  instructorFilter = signal<'all' | string>('all');
  selectedChildId = signal<string | null>(null);
  fromChildCard = signal<boolean>(false);
  selectedChildName = signal<string | null>(null);

  // DATA
  lessons = signal<LessonRow[]>([]);
  payments = signal<PaymentRow[]>([]);
  cancelExceptions = signal<CancelExceptionRow[]>([]);
  occurrences = signal<LessonOccurrenceRow[]>([]);
  occWithAttendance = signal<OccWithAttendanceRow[]>([]);

  insights = signal<Insights>({
    totalLessons: 0,
    cancelPct: 0,
    successPct: 0,
    newStudents: 0,
    avgIncome: 0,
  });

  // ===============================
  //   Helpers
  // ===============================
  private clean(v: string | null | undefined): string {
    return (v ?? '').trim();
  }

  private countPendingOccurrences(rows: LessonOccurrenceRow[]): number {
    return rows.filter((o) => this.clean(o.status) === 'ממתין לאישור').length;
  }

  // ✅ החליפי למנגנון הרשאות אמיתי אצלך
  private isInstructor(): boolean {
    return window.location.pathname.includes('instructor');
  }

  private getFirebaseUidOrNull(): string | null {
    const fbUser = getAuth().currentUser;
    return fbUser?.uid ?? null;
  }


  
  private deriveStatus(raw: MonthlyReportRow): LessonStatus | null {
    const s = this.clean(raw.status);

    if (s === 'אושר' || s === 'בוטל' || s === 'ממתין לאישור' || s === 'הושלם') {
      return s as LessonStatus;
    }

    if (raw.is_cancellation) return 'בוטל';
    if (raw.approval_id) return 'אושר';
    return 'ממתין לאישור';
  }

  private deriveLessonType(raw: MonthlyReportRow): LessonType | null {
    const t = this.clean(raw.lesson_type);
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
        return 'status-done';
      default:
        return 'status-default';
    }
  }

  instructors = computed<string[]>(() => {
    const set = new Set<string>();
    for (const l of this.lessons()) {
      const name = this.clean(l.instructor_name);
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  });

  filteredLessons = computed<LessonRow[]>(() => {
    const childId = this.selectedChildId();

    const q = this.clean(this.search()).toLowerCase();
    const childQ = this.clean(this.childSearch()).toLowerCase();

    const type = this.typeFilter();
    const statusF = this.statusFilter();
    const instructorF = this.instructorFilter();

    const rows = this.lessons();

    const map: Record<string, LessonStatus[]> = {
      pending: ['ממתין לאישור'],
      approved: ['אושר'],
      canceled: ['בוטל'],
      done: ['הושלם', 'אושר'],
      all: [],
    };

    return rows.filter((l: LessonRow) => {
      const childName =
        this.clean(l.child_full_name) ||
        `${this.clean(l.child_first_name)} ${this.clean(l.child_last_name)}`.trim() ||
        `${this.clean(l.child?.first_name)} ${this.clean(l.child?.last_name)}`.trim();

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
        const instName = this.clean(l.instructor_name);
        if (instName !== instructorF) return false;
      }

      // 🔹 אם הגענו מכרטיס ילד – סינון לפי child_id בלבד
      // 🔹 אם הגענו מכרטיס ילד – סינון לפי שם הילד
      // 🔒 סינון מכרטסת ילד – ילד אחד בלבד
      if (this.fromChildCard()) {
        const childId = this.selectedChildId();
        if (!childId) return true; // ← אל תחסום אם אין מזהה

        // השוואה בטוחה (string)
        if (String(l.child_id) !== String(childId)) return false;
      }


      // 🔹 חיפוש חופשי כללי
      if (q) {
        const hay = `${childName} ${l.lesson_type || ''} ${l.riding_type || ''} ${l.instructor_name || ''
          }`.toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    });

  });

  // ===============================
  //            KPIs
  // ===============================
  kpis = computed<Kpis>(() => {
    
    const monthPrefix = `${this.year}-${String(this.month).padStart(2, '0')}`;

    const all = this.mode() === 'month'
  ? this.lessons().filter(l => l.occur_date?.startsWith(monthPrefix))
  : this.lessons();
    const cancels = this.cancelExceptions();
    const payRows = this.payments();
    const occs = this.occurrences();

    const income = payRows.reduce((sum: number, p: PaymentRow) => sum + (p.amount ?? 0), 0);

    const occAtt = this.occWithAttendance();
    const successCount = occAtt.filter((o) => {
      const s = this.clean(o.status);
      return s === 'אושר' || s === 'הושלם';
    }).length;

    const totalForSuccess = occAtt.length;
    const successPct = totalForSuccess > 0 ? Math.round((successCount / totalForSuccess) * 100) : 0;

    

    if (!all.length && !cancels.length) {
      return {
        workedHours: '0:00',
        canceled: 0,
        done: 0,
        pending: 0,
        successPct,
        privCount: 0,
        groupCount: 0,
        income,
        canceledByFarmOrInstructor: 0,
        canceledByParents: 0,
        completedMakeups: 0,
      };
    }

    const doneStatuses: LessonStatus[] = ['הושלם', 'אושר'];
    const done = all.filter((l: LessonRow) => l.status && doneStatuses.includes(l.status));

    const pendingCount = this.countPendingOccurrences(occs);

    let minutes = 0;
    for (const l of done) {
      if (l.start_time && l.end_time) {
        const s = new Date(`1970-01-01T${l.start_time}`);
        const e = new Date(`1970-01-01T${l.end_time}`);
        minutes += (e.getTime() - s.getTime()) / 60000;
      }
    }

    const workedHours = `${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, '0')}`;

    let privCount = 0;
    let groupCount = 0;

    for (const l of all) {
      const code = this.clean(l.riding_type_code).toLowerCase();
      const name = this.clean(l.riding_type_name);

      if (!code && !name) continue;

      const isPrivate = code === 'private' || name.includes('פרטי');
      if (isPrivate) privCount++;
      else groupCount++;
    }

    const canceledRows = all.filter(l => l.status === 'בוטל');

const canceledByParents = canceledRows.filter(l =>
  l.canceller_role === 'parent'
).length;

const canceledByFarmOrInstructor = canceledRows.filter(l =>
  ['admin', 'manager', 'secretary', 'instructor'].includes(l.canceller_role ?? '')
).length;

const completedMakeups = all.filter(l =>
  l.lesson_type === 'השלמה' &&
  (l.status === 'אושר' || l.status === 'הושלם')
).length;

const canceled = canceledRows.length;


    return {
      workedHours,
      canceled,
      done: done.length,
      pending: pendingCount,
      successPct,
      privCount,
      groupCount,
      income,
      canceledByFarmOrInstructor,
      canceledByParents,
      completedMakeups,
    };
  });

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const childId = params['childId'] ?? null;

      this.selectedChildId.set(childId);

      // 🔒 רק אם באמת הגיע childId – נחשב "מכרטסת ילד"
      this.fromChildCard.set(
        params['fromChild'] === 'true' && !!childId
      );
    });

    this.load();
  }

private toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


 async load(): Promise<void> {
  void this.refreshManagement();

  this.loading = true;

    try {
      let from: string;
      let to: string;

      if (this.mode() === 'month') {
        const monthStart = new Date(this.year, this.month - 1, 1);
        const monthEnd = new Date(this.year, this.month, 0);
        from = this.toLocalDateString(monthStart);
to = this.toLocalDateString(monthEnd);
      } else {
        const yearStart = new Date(this.year, 0, 1);
        const yearEnd = new Date(this.year, 11, 31);
        from = this.toLocalDateString(yearStart);
        to = this.toLocalDateString(yearEnd);
      }

      // 🔒 no printing uid
      const uid = this.getFirebaseUidOrNull();


      const lessonsViewName = 'lessons_schedule_view';

      let lessonsQuery = this.dbc
        .from(lessonsViewName)
        .select('*')
        .gte('lesson_date', from)
        .lte('lesson_date', to)
        .order('lesson_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (this.isInstructor()) {
        if (!uid) {
          await this.ui.alert('לא נמצא משתמש מחובר. התחברי מחדש.', 'שגיאה');
          return;
        }
        lessonsQuery = lessonsQuery.eq('instructor_uid', uid);
      }


      const [
        { data: rawLessons, error: lessonsErr },
        { data: paymentsData, error: paymentsErr },
        { data: cancelsData, error: cancelsErr },
        { data: occurrencesData, error: occErr },
        { data: occAttData, error: occAttErr },
        { data: notesData, error: notesErr },

      ] = await Promise.all([
        lessonsQuery,

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

        this.dbc
          .from('lessons_occurrences')
          .select('occur_date,status,lesson_id')
          .gte('occur_date', from)
          .lte('occur_date', to),

        this.dbc
          .from('lessons_occurrences_with_attendance')
          .select('occur_date,status,lesson_id,is_cancellation,attendance_status,lesson_type')
          .gte('occur_date', from)
          .lte('occur_date', to),
        this.dbc
          .from('lesson_notes_simple')
          .select('lesson_id, child_id, occur_date, note, category, created_at')
          .gte('occur_date', from)
          .lte('occur_date', to),
      ]);

      if (lessonsErr) throw lessonsErr;
      if (paymentsErr) throw paymentsErr;
      if (cancelsErr) throw cancelsErr;
      if (occErr) throw occErr;
      if (occAttErr) throw occAttErr;
      if (notesErr) throw notesErr;

      const rows = (rawLessons ?? []) as MonthlyReportRow[];
      const noteRows = (notesData ?? []) as LessonNoteRow[];

      const noteKey = (lessonId: string | null | undefined, childId: string | null | undefined, occurDate: string | null | undefined): string =>
        `${lessonId ?? ''}__${childId ?? ''}__${occurDate ?? ''}`;

      const notesMap = new Map<string, { office_note: string | null; instructor_note: string | null }>();

      for (const n of noteRows) {
        const key = noteKey(n.lesson_id, n.child_id, n.occur_date);

        if (!notesMap.has(key)) {
          notesMap.set(key, {
            office_note: null,
            instructor_note: null,
          });
        }

        const current = notesMap.get(key)!;
        const category = (n.category ?? '').trim();
        const text = (n.note ?? '').trim();

        if (!text) continue;

        if (category === 'office') {
          current.office_note = current.office_note
            ? `${current.office_note} | ${text}`
            : text;
        } else if (category === 'general') {
          current.instructor_note = current.instructor_note
            ? `${current.instructor_note} | ${text}`
            : text;
        }
      }

      // ✅ safe debug: counts only
      this.debug('loaded data', {
        mode: this.mode(),
        year: this.year,
        month: this.month,
        lessons: rows.length,
        payments: (paymentsData ?? []).length,
        cancels: (cancelsData ?? []).length,
        occurrences: (occurrencesData ?? []).length,
        occAttendance: (occAttData ?? []).length,
      });

      const lessonKey = (raw: MonthlyReportRow): string =>
        `${raw.lesson_id ?? ''}__${raw.child_id ?? ''}__${raw.lesson_date  ?? ''}`;

      const dedupedMap = new Map<string, LessonRow>();

      for (const raw of rows) {
        const key = lessonKey(raw);

        const childFull = this.clean(raw.child_name) || null;
        const instructorName = this.clean(raw.instructor_name) || null;
        const lessonType = this.deriveLessonType(raw);
        const status = this.deriveStatus(raw);
        const ridingType =
          this.clean(raw.riding_type_name) || this.clean(raw.riding_type_code) || null;

        const notes = notesMap.get(
          noteKey(raw.lesson_id ?? null, raw.child_id ?? null, raw.lesson_date  ?? null)
        );

        if (!dedupedMap.has(key)) {
          dedupedMap.set(key, {
            lesson_id: (raw.lesson_id ?? '') as UUID,
            child_id: raw.child_id ?? null,
            occur_date: raw.lesson_date  ?? null,

            office_note: notes?.office_note ?? null,
            instructor_note: notes?.instructor_note ?? null,

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
            instructor_uid: raw.instructor_uid ?? null,
            instructor_id: raw.instructor_id ?? null,
            appointment_kind: null,
            payment_plan_id: null,
            lesson_price_agorot: raw.lesson_price_agorot ?? null,

            canceller_role: raw.canceller_role ?? null,
            is_billable: raw.is_billable ?? true,
            is_makeup_allowed: raw.is_makeup_allowed ?? false,
          });
        } else {
          const existing = dedupedMap.get(key)!;

          if (!existing.office_note && notes?.office_note) {
            existing.office_note = notes.office_note;
          }

          if (!existing.instructor_note && notes?.instructor_note) {
            existing.instructor_note = notes.instructor_note;
          }
        }
      }

      const normalizedLessons = Array.from(dedupedMap.values());

      this.lessons.set(normalizedLessons);

      // ✅ אם הגענו מכרטיס ילד – סינון אוטומטי לפי שם הילד
      // ✅ סינון אוטומטי לפי שם הילד שממנו הגענו (לפי childId)
      if (this.fromChildCard() && this.selectedChildId()) {
        const childId = this.selectedChildId();

        const match = normalizedLessons.find(
          l => l.child_id === childId
        );

        if (match) {
          const name =
            this.clean(match.child_full_name) ||
            `${this.clean(match.child_first_name)} ${this.clean(match.child_last_name)}`.trim();

          if (name) {
            this.childSearch.set(name);
          }
        }
      }


      this.payments.set((paymentsData ?? []) as PaymentRow[]);
      this.cancelExceptions.set((cancelsData ?? []) as CancelExceptionRow[]);
      this.occurrences.set((occurrencesData ?? []) as LessonOccurrenceRow[]);
      this.occWithAttendance.set((occAttData ?? []) as OccWithAttendanceRow[]);

      this.computeInsights(this.lessons());
      this.buildCharts();
    } catch (err: any) {
      // 🔒 no raw data in error logs
      // eslint-disable-next-line no-console
      console.error('❌ load summary failed', err?.message || err);
      await this.ui.alert(
        'שגיאה בטעינת נתונים: ' + (err?.message || 'בדקי קונסול בדפדפן'),
        'שגיאה'
      );

    } finally {
      this.loading = false;
    }
  }

  // ===============================
  //       COMPUTE INSIGHTS
  // ===============================
  computeInsights(rows: LessonRow[]): void {
    const payRows = this.payments();

    const incomeSum = payRows.reduce((sum: number, p: PaymentRow) => sum + (p.amount ?? 0), 0);

    const occAtt = this.occWithAttendance();
    const total = occAtt.length;

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

    const successCount = occAtt.filter((o) => {
      const s = this.clean(o.status);
      return s === 'אושר' || s === 'הושלם';
    }).length;

    const canceledCount = occAtt.filter((o) => this.clean(o.status) === 'בוטל').length;

    const cancelPct = Math.round((canceledCount / total) * 100);
    const successPct = Math.round((successCount / total) * 100);

    const uniqueStudents = new Set(
      rows
        .map((r) =>
          (
            r.child_full_name ||
            `${this.clean(r.child_first_name)} ${this.clean(r.child_last_name)}`.trim()
          ).trim()
        )
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
  onChildSearchChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.childSearch.set(target.value);
  }

  clearChildSearch(): void {
    this.childSearch.set('');
  }

  clearSearch(): void {
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
    this.instructorFilter.set('all');
  }
  // ===============================
  //        EXCEL EXPORT (SAFE)
  // ===============================
  async exportExcel(): Promise<void> {
    const rows = this.filteredLessons();

    try {
      const XLSXmod: any = await import('xlsx');
      const XLSX = XLSXmod.default ?? XLSXmod;

      const exportRows = rows.map((r) => ({
        'תאריך שיעור': r.occur_date ?? '',
        'תלמיד/ה': (
          r.child_full_name ||
          `${this.clean(r.child_first_name)} ${this.clean(r.child_last_name)}`.trim() ||
          ''
        ).trim(),
        'מדריך/ה': r.instructor_name ?? '',
        'סוג שיעור': r.lesson_type ?? '',
        'סוג רכיבה': r.riding_type ?? '',
        סטטוס: r.status ?? '',
        'הערת משרד': r.office_note ?? '',
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
      this.ui.alert('חסר xlsx. להריץ: npm i xlsx', 'שגיאה');
    }
  }

  private lessonMinutes(l: LessonRow): number {
  if (!l.start_time || !l.end_time) return 0;

  const s = new Date(`1970-01-01T${l.start_time}`);
  const e = new Date(`1970-01-01T${l.end_time}`);

  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;

  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
}

private minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

private minutesToTime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}:${String(safeMinutes % 60).padStart(2, '0')}`;
}

private isBillableLesson(l: LessonRow): boolean {
  return (l.status === 'אושר' || l.status === 'הושלם')
    && l.is_billable !== false;
}

async exportInstructorsMonthlyReport(): Promise<void> {
  if (this.mode() !== 'month') {
    await this.ui.alert('דוח שעות מדריכים זמין כרגע לפי חודש בלבד.', 'שימי לב');
    return;
  }

  try {
    const monthStart = this.toLocalDateString(new Date(this.year, this.month - 1, 1));
    const nextMonthStart = this.toLocalDateString(new Date(this.year, this.month, 1));
    const monthEnd = this.toLocalDateString(new Date(this.year, this.month, 0));

    // Supabase מחזיר כברירת מחדל עד 1,000 שורות. בדוח שכר חייבים
    // להביא את כל החודש, אחרת סוף החודש נחתך מהחישוב.
    const reportRawRows: MonthlyReportRow[] = [];
    const pageSize = 1000;
    for (let fromIndex = 0; ; fromIndex += pageSize) {
      let pageQuery = this.dbc
        .from('lessons_schedule_view')
        .select('*')
        .gte('lesson_date', monthStart)
        .lte('lesson_date', monthEnd)
        .order('lesson_date', { ascending: true })
        .order('start_time', { ascending: true })
        .range(fromIndex, fromIndex + pageSize - 1);

      if (this.isInstructor()) {
        const uid = this.getFirebaseUidOrNull();
        if (!uid) {
          await this.ui.alert('לא נמצא משתמש מחובר. התחברי מחדש.', 'שגיאה');
          return;
        }
        pageQuery = pageQuery.eq('instructor_uid', uid);
      }

      const { data, error } = await pageQuery;
      if (error) throw error;

      const page = (data ?? []) as MonthlyReportRow[];
      reportRawRows.push(...page);
      if (page.length < pageSize) break;
    }

    const reportLessons: LessonRow[] = reportRawRows.map((raw) => ({
      lesson_id: (raw.lesson_id ?? '') as UUID,
      child_id: raw.child_id ?? null,
      occur_date: raw.lesson_date ?? null,
      start_time: raw.start_time ? raw.start_time.slice(0, 5) : null,
      end_time: raw.end_time ? raw.end_time.slice(0, 5) : null,
      lesson_type: this.deriveLessonType(raw),
      status: this.deriveStatus(raw),
      riding_type_code: raw.riding_type_code ?? null,
      riding_type_name: raw.riding_type_name ?? null,
      riding_type: this.clean(raw.riding_type_name) || this.clean(raw.riding_type_code) || null,
      child_full_name: this.clean(raw.child_name) || null,
      instructor_name: this.clean(raw.instructor_name) || null,
      instructor_uid: raw.instructor_uid ?? null,
      instructor_id: raw.instructor_id ?? null,
      lesson_price_agorot: raw.lesson_price_agorot ?? null,
      canceller_role: raw.canceller_role ?? null,
      is_billable: raw.is_billable ?? true,
      is_makeup_allowed: raw.is_makeup_allowed ?? false,
    }));

    const lessonIds = Array.from(
      new Set(reportLessons.map((l) => l.lesson_id).filter(Boolean))
    );

    const lessonMetaQuery = lessonIds.length
      ? this.dbc
          .from('lessons')
          .select('id,payment_plan_id,appointment_kind')
          .in('id', lessonIds)
      : Promise.resolve({ data: [], error: null });

    const [lessonMetaResult, plansResult, breaksResult, absenceResult, instructorsResult] =
      await Promise.all([
        lessonMetaQuery,
        this.dbc.from('payment_plans').select('id,name'),
        this.dbc
          .from('instructor_break_occurrences')
          .select('instructor_id_number,break_date,start_time,end_time,duration_minutes')
          .gte('break_date', monthStart)
          .lte('break_date', monthEnd),
        this.dbc
          .from('instructor_unavailability')
          .select('instructor_id_number,from_ts,to_ts,reason,category,all_day')
          .lt('from_ts', `${nextMonthStart}T00:00:00`)
          .gt('to_ts', `${monthStart}T00:00:00`),
        this.dbc.from('instructors').select('id_number,first_name,last_name'),
      ]);

    const firstError = [
      lessonMetaResult.error,
      plansResult.error,
      breaksResult.error,
      absenceResult.error,
      instructorsResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const XLSXmod: any = await import('xlsx');
    const XLSX = XLSXmod.default ?? XLSXmod;

    type Summary = {
      instructorId: string;
      instructorName: string;
      privateCount: number;
      privateMinutes: number;
      pairCount: number;
      pairMinutes: number;
      groupCount: number;
      groupMinutes: number;
      breakCount: number;
      breakMinutes: number;
      intakeCount: number;
      intakeMinutes: number;
      workDates: Set<string>;
      vacationDates: Set<string>;
      sickDates: Set<string>;
    };

    const namesById = new Map<string, string>();
    for (const i of (instructorsResult.data ?? []) as any[]) {
      namesById.set(
        String(i.id_number),
        `${this.clean(i.first_name)} ${this.clean(i.last_name)}`.trim() || String(i.id_number)
      );
    }

    const planNames = new Map<string, string>(
      ((plansResult.data ?? []) as any[]).map((p) => [String(p.id), this.clean(p.name)])
    );
    const lessonMeta = new Map<string, { payment_plan_id: string | null; appointment_kind: string | null }>(
      ((lessonMetaResult.data ?? []) as any[]).map((m) => [
        String(m.id),
        {
          payment_plan_id: m.payment_plan_id ? String(m.payment_plan_id) : null,
          appointment_kind: m.appointment_kind ?? null,
        },
      ])
    );

    const summaries = new Map<string, Summary>();
    const ensureSummary = (id: string, name?: string | null): Summary => {
      if (!summaries.has(id)) {
        summaries.set(id, {
          instructorId: id,
          instructorName: this.clean(name) || namesById.get(id) || id,
          privateCount: 0,
          privateMinutes: 0,
          pairCount: 0,
          pairMinutes: 0,
          groupCount: 0,
          groupMinutes: 0,
          breakCount: 0,
          breakMinutes: 0,
          intakeCount: 0,
          intakeMinutes: 0,
          workDates: new Set<string>(),
          vacationDates: new Set<string>(),
          sickDates: new Set<string>(),
        });
      }
      return summaries.get(id)!;
    };

    const isPaidForInstructor = (l: LessonRow): boolean => {
      if (l.status === 'בוטל') return l.canceller_role === 'parent';
      return l.status === 'אושר' || l.status === 'הושלם';
    };

    type Slot = {
      instructorId: string;
      instructorName: string;
      date: string;
      start: string;
      end: string;
      minutes: number;
      isIntake: boolean;
      children: Set<string>;
      statuses: Set<string>;
    };

    const slots = new Map<string, Slot>();
    for (const l of reportLessons.filter(isPaidForInstructor)) {
      const instructorId = String(l.instructor_id ?? '');
      const date = l.occur_date ?? '';
      const start = l.start_time ?? '';
      const end = l.end_time ?? '';
      if (!instructorId || !date || !start || !end) continue;

      const meta = lessonMeta.get(String(l.lesson_id));
      const planName = meta?.payment_plan_id
        ? planNames.get(meta.payment_plan_id) ?? ''
        : '';
      const isIntake = this.clean(planName) === 'אינטק';
      const key = `${instructorId}__${date}__${start}__${end}__${isIntake ? 'intake' : 'lesson'}`;

      if (!slots.has(key)) {
        slots.set(key, {
          instructorId,
          instructorName: this.clean(l.instructor_name) || namesById.get(instructorId) || instructorId,
          date,
          start,
          end,
          minutes: this.lessonMinutes(l),
          isIntake,
          children: new Set<string>(),
          statuses: new Set<string>(),
        });
      }
      const slot = slots.get(key)!;
      slot.children.add(String(l.child_id ?? l.lesson_id));
      if (l.status) slot.statuses.add(l.status);
    }

    const detailsRows: Record<string, string | number>[] = [];
    for (const slot of slots.values()) {
      const summary = ensureSummary(slot.instructorId, slot.instructorName);
      if (slot.statuses.has('אושר') || slot.statuses.has('הושלם')) {
        summary.workDates.add(slot.date);
      }

      let category: 'פרטי' | 'זוגי' | 'קבוצתי';
      if (slot.isIntake) {
        summary.intakeCount += 1;
        summary.intakeMinutes += slot.minutes;
      }

      // אינטייק הוא מידע נפרד בדוח, אך לצורך שכר הוא שיעור רגיל
      // ומסווג לפי מספר התלמידים במשבצת.
      if (slot.children.size >= 3) {
        category = 'קבוצתי';
        summary.groupCount += 1;
        summary.groupMinutes += slot.minutes;
      } else if (slot.children.size === 2) {
        category = 'זוגי';
        summary.pairCount += 1;
        summary.pairMinutes += slot.minutes;
      } else {
        category = 'פרטי';
        summary.privateCount += 1;
        summary.privateMinutes += slot.minutes;
      }

      detailsRows.push({
        'תאריך': slot.date,
        'מדריך/ה': slot.instructorName,
        'קטגוריה לחישוב': category,
        'מספר תלמידים משובצים': slot.children.size,
        'שעת התחלה': slot.start,
        'שעת סיום': slot.end,
        'משך': this.minutesToTime(slot.minutes),
        'סטטוס': Array.from(slot.statuses).join(', '),
        'האם אינטייק': slot.isIntake ? 'כן' : 'לא',
      });
    }

    // הפסקה נספרת רק ביום שבו הייתה פעילות בפועל, ולא ביום חופש/מחלה.
    const activityDates = new Set<string>();
    for (const l of reportLessons) {
      if ((l.status === 'אושר' || l.status === 'הושלם') && l.instructor_id && l.occur_date) {
        activityDates.add(`${String(l.instructor_id)}__${l.occur_date}`);
      }
    }

    const blockedBreakDates = new Set<string>();
    const addAbsenceDates = (row: InstructorUnavailabilityRow): void => {
      if (!row.all_day) return;
      const id = String(row.instructor_id_number);
      const summary = ensureSummary(id);
      const description = `${row.category ?? ''} ${row.reason ?? ''}`.toLowerCase();
      const target = description.includes('מחלה') || description.includes('sick')
        ? summary.sickDates
        : summary.vacationDates;
      const first = new Date(row.from_ts);
      const rawEnd = new Date(row.to_ts);
      const last = new Date(Math.max(first.getTime(), rawEnd.getTime() - 1));
      const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
      const lastDate = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      while (cursor <= lastDate) {
        const date = this.toLocalDateString(cursor);
        if (date >= monthStart && date <= monthEnd) {
          target.add(date);
          blockedBreakDates.add(`${id}__${date}`);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    };
    for (const absence of (absenceResult.data ?? []) as InstructorUnavailabilityRow[]) {
      addAbsenceDates(absence);
    }

    for (const b of (breaksResult.data ?? []) as InstructorBreakRow[]) {
      const id = String(b.instructor_id_number);
      const dayKey = `${id}__${b.break_date}`;

      if (!activityDates.has(dayKey) || blockedBreakDates.has(dayKey)) {
        continue;
      }

      const breakStart = b.start_time?.slice(0, 5) ?? '';
      const breakEnd = b.end_time?.slice(0, 5) ?? '';
      const hasOverlappingLesson = Array.from(slots.values()).some((slot) =>
        slot.instructorId === id &&
        slot.date === b.break_date &&
        slot.start < breakEnd &&
        slot.end > breakStart
      );

      // כאשר נקבע שיעור בזמן ההפסקה, השיעור מחליף את ההפסקה.
      if (hasOverlappingLesson) {
        continue;
      }

      const minutes = b.duration_minutes ?? this.lessonMinutes({
        lesson_id: '', lesson_type: null, status: null,
        start_time: b.start_time, end_time: b.end_time,
      });
      const summary = ensureSummary(id);
      summary.breakCount += 1;
      summary.breakMinutes += minutes;
      summary.workDates.add(b.break_date);
      detailsRows.push({
        'תאריך': b.break_date,
        'מדריך/ה': summary.instructorName,
        'קטגוריה לחישוב': 'הפסקה',
        'מספר תלמידים משובצים': 0,
        'שעת התחלה': breakStart,
        'שעת סיום': breakEnd,
        'משך': this.minutesToTime(minutes),
        'סטטוס': '',
      });
    }

    const summaryRows = Array.from(summaries.values())
      .sort((a, b) => a.instructorName.localeCompare(b.instructorName, 'he'))
      .map((r) => {
        const lessonMinutes = r.privateMinutes + r.pairMinutes + r.groupMinutes;
        // האינטייק כבר כלול בזמן השיעורים ולכן אין להוסיף אותו פעם נוספת.
        const totalMinutes = lessonMinutes + r.breakMinutes;
        return {
          'מדריך/ה': r.instructorName,
          'מספר שיעורים פרטיים': r.privateCount,
          'זמן שיעורים פרטיים': this.minutesToTime(r.privateMinutes),
          'מספר שיעורים זוגיים': r.pairCount,
          'זמן שיעורים זוגיים': this.minutesToTime(r.pairMinutes),
          'מספר שיעורים קבוצתיים': r.groupCount,
          'זמן שיעורים קבוצתיים': this.minutesToTime(r.groupMinutes),
          'סה״כ מספר שיעורים': r.privateCount + r.pairCount + r.groupCount,
          'סה״כ זמן שיעורים': this.minutesToTime(lessonMinutes),
          'מספר הפסקות': r.breakCount,
          'זמן הפסקות': this.minutesToTime(r.breakMinutes),
          'מספר פרטי + הפסקות': r.privateCount + r.breakCount,
          'זמן פרטי + הפסקות': this.minutesToTime(r.privateMinutes + r.breakMinutes),
          'מספר אינטייקים': r.intakeCount,
          'זמן אינטייקים': this.minutesToTime(r.intakeMinutes),
          'סה״כ זמן לתשלום': this.minutesToTime(totalMinutes),
          'מספר ימי עבודה': r.workDates.size,
          'מספר ימי חופש': r.vacationDates.size,
          'מספר ימי מחלה': r.sickDates.size,
        };
      });

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summaryRows),
      'סיכום מדריכים'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(detailsRows),
      'פירוט שעות מדריכים'
    );

    XLSX.writeFile(wb, `instructors_hours_${this.year}_${this.month}.xlsx`);
  } catch (e) {
    console.error(e);
    this.ui.alert('חסר xlsx. להריץ: npm i xlsx', 'שגיאה');
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
    const occs = this.occurrences();
    const occAtt = this.occWithAttendance();

    const doneStatuses: LessonStatus[] = ['הושלם', 'אושר'];

    const doneByMonth = Array(12).fill(0);
    const pendingByMonth = Array(12).fill(0);
    const canceledByMonth = Array(12).fill(0);
    const minutesByMonth = Array(12).fill(0);
    const incomeByMonth = Array(12).fill(0);
    const privByMonth = Array(12).fill(0);
    const groupByMonth = Array(12).fill(0);

    for (const l of lessons) {
      if (!l.occur_date) continue;
      const d = new Date(l.occur_date);
      if (isNaN(d.getTime())) continue;

      const m = d.getMonth();

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

      const code = this.clean(l.riding_type_code).toLowerCase();
      const name = this.clean(l.riding_type_name);

      if (!code && !name) continue;

      const isPrivate = code === 'private' || name.includes('פרטי');
      if (isPrivate) privByMonth[m]++;
      else groupByMonth[m]++;
    }

    for (const o of occs) {
      if (!o.occur_date) continue;
      const d = new Date(o.occur_date);
      if (isNaN(d.getTime())) continue;

      const m = d.getMonth();
      if (this.clean(o.status) === 'ממתין לאישור') {
        pendingByMonth[m]++;
      }
    }

    for (const p of pays) {
      if (!p.date || p.amount == null) continue;
      const d = new Date(p.date);
      if (isNaN(d.getTime())) continue;
      const m = d.getMonth();
      incomeByMonth[m] += p.amount;
    }

    const successByMonth = Array(12).fill(0);
    const notSuccessByMonth = Array(12).fill(0);

    for (const o of occAtt) {
      if (!o.occur_date) continue;
      const d = new Date(o.occur_date);
      if (isNaN(d.getTime())) continue;

      const m = d.getMonth();
      const s = this.clean(o.status);

      if (s === 'אושר' || s === 'הושלם') successByMonth[m]++;
      else notSuccessByMonth[m]++;
    }

    this.kpiCharts.success_pct = this.months.map((mm) => {
      const idx = mm.v - 1;
      const ok = successByMonth[idx] || 0;
      const notOk = notSuccessByMonth[idx] || 0;
      const total = ok + notOk;
      const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
      return { label: mm.t, value: pct };
    });

    this.kpiCharts.priv_vs_group = [
      { label: 'פרטי', value: k.privCount },
      { label: 'לא פרטי', value: k.groupCount },
    ];

    this.kpiCharts.done = this.months.map((m) => ({
      label: m.t,
      value: doneByMonth[m.v - 1] ?? 0,
    }));

    this.kpiCharts.pending = this.months.map((m) => ({
      label: m.t,
      value: pendingByMonth[m.v - 1] ?? 0,
    }));

    this.kpiCharts.canceled = this.months.map((m) => ({
      label: m.t,
      value: canceledByMonth[m.v - 1] ?? 0,
    }));

    const privSeries: ChartPoint[] = [];
    const groupSeries: ChartPoint[] = [];

    let privRunning = 0;
    let groupRunning = 0;

    for (const m of this.months) {
      const idx = m.v - 1;
      privRunning += privByMonth[idx] ?? 0;
      groupRunning += groupByMonth[idx] ?? 0;

      privSeries.push({ label: m.t, value: privRunning });
      groupSeries.push({ label: m.t, value: groupRunning });
    }

    this.privVsGroupCharts.set({ priv: privSeries, group: groupSeries });

    this.kpiCharts.worked_hours = this.months.map((m) => ({
      label: m.t,
      value: (minutesByMonth[m.v - 1] || 0) / 60,
    }));

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

  selectedChart(): ChartPoint[] {
    return this.kpiCharts[this.selectedKpi] ?? [];
  }

  maxChartValue(): number {
    const data = this.selectedChart();
    return data.reduce((m, p) => (p.value > m ? p.value : m), 0);
  }

  maxPrivVsGroupValue(): number {
    const series = this.privVsGroupCharts();
    const allPoints = [...series.priv, ...series.group];
    if (!allPoints.length) return 0;
    return allPoints.reduce((m, p) => (p.value > m ? p.value : m), 0);
  }

  getPointYWithMax(value: number, max: number): number {
    const safeMax = max || 1;
    const plotHeight = this.axisBottom - this.axisTop;
    return this.axisBottom - (value / safeMax) * plotHeight;
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

  buildPolylineFor(series: ChartPoint[], max: number): string {
    const total = series.length;
    if (!total) return '';
    return series
      .map((p, i) => `${this.getPointX(i, total)},${this.getPointYWithMax(p.value, max)}`)
      .join(' ');
  }

  buildPolyline(): string {
    const data = this.selectedChart();
    const total = data.length;
    return data.map((p, i) => `${this.getPointX(i, total)},${this.getPointY(p.value)}`).join(' ');
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

  miniPolyline(key: KpiKey): string {
    const data = this.kpiCharts[key] ?? [];
    if (!data.length) return '';

    const w = 120;
    const h = 34;
    const pad = 2;

    let min = Infinity;
    let max = -Infinity;
    for (const p of data) {
      const v = Number(p.value) || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const range = Math.max(max - min, 1);
    const denom = Math.max(data.length - 1, 1);

    return data
      .map((p, i) => {
        const v = Number(p.value) || 0;
        const x = (i / denom) * (w - pad * 2) + pad;
        const t = (v - min) / range;
        const y = h - pad - t * (h - pad * 2);
        return `${x},${y}`;
      })
      .join(' ');
  }

  private isSameLesson(a: LessonRow | undefined, b: LessonRow | undefined): boolean {
    if (!a || !b) return false;
    if (!a.lesson_id || !b.lesson_id) return false;
    return a.lesson_id === b.lesson_id;
  }

  isSameLessonAsPrev(index: number): boolean {
    const rows = this.filteredLessons();
    if (index <= 0 || index >= rows.length) return false;
    return this.isSameLesson(rows[index], rows[index - 1]);
  }

  private groupKey(l: LessonRow | null | undefined): string {
    if (!l) return '';
    return [
      this.clean(l.occur_date),
      this.clean(l.start_time),
      this.clean(l.end_time),
      this.clean(l.instructor_name),
    ].join('|');
  }

  private isSameGroup(a?: LessonRow, b?: LessonRow): boolean {
    if (!a || !b) return false;
    return this.groupKey(a) === this.groupKey(b);
  }

  isGroupFirst(index: number): boolean {
    const rows = this.filteredLessons();
    if (index <= 0) return true;
    return !this.isSameGroup(rows[index], rows[index - 1]);
  }

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
  backToChildCard(): void {
    const childId = this.selectedChildId();

    this.router.navigate(['/secretary/children'], {
      queryParams: childId ? { childId } : {},
    });
  }

  get isInstructorView(): boolean {
  return this.isInstructor();
}

managementBusy = signal(false);
managementError = signal('');
managementActivityError = signal('');

managementPayload = signal<ManagementPayload | null>(null);
annualSchedule = signal<MonthlyReportRow[]>([]);

managementYear = signal(new Date().getFullYear());
managementMonth = signal(new Date().getMonth() + 1);

managementInstructor = signal<string>('all');
managementFund = signal<string>('all');

private managementRequest = 0;

managementFunds = computed(() => {
  const rows = this.managementPayload()?.months ?? [];

  return [...new Set(rows.map(row => row.fund))]
    .sort((a, b) => a.localeCompare(b, 'he'));
});

managementInstructorOptions = signal<Array<{ id: string; name: string }>>([]);
managementInstructors = computed(() => this.managementInstructorOptions());

managementRows = computed(() => {
  const rows = this.managementPayload()?.months ?? [];
  const fund = this.managementFund();

  return rows.filter(row =>
    fund === 'all' || row.fund === fund
  );
});

managementSelectedRows = computed(() => {
  const month = this.managementMonth();

  return this.managementRows()
    .filter(row => row.month === month);
});

annualActivity = computed<AnnualActivity[]>(() => {
  const selectedInstructor = this.managementInstructor();

  const rows = this.annualSchedule().filter(row =>
    selectedInstructor === 'all'
    || String(row.instructor_id) === selectedInstructor
  );

  return this.months.map(month => {
    const monthlyRows = rows.filter(row =>
      Number((row.lesson_date || '').slice(5, 7)) === month.v
    );

    const seen = new Set<string>();
    const children = new Set<string>();

    const slots = new Map<
      string,
      Array<[number, number]>
    >();

    let lessons = 0;
    let canceled = 0;

    for (const row of monthlyRows) {
      const key = [
        row.lesson_id,
        row.child_id,
        row.lesson_date,
        row.start_time
      ].join('|');

      if (seen.has(key)) continue;
      seen.add(key);

      if (row.status === 'בוטל' || row.is_cancellation) {
        canceled++;
        continue;
      }

      lessons++;

      if (row.child_id) {
        children.add(row.child_id);
      }

      if (
        row.instructor_id == null
        || !row.start_time
        || !row.end_time
      ) {
        continue;
      }

      const toMinutes = (time: string): number =>
        Number(time.slice(0, 2)) * 60
        + Number(time.slice(3, 5));

      const start = toMinutes(row.start_time);
      const end = toMinutes(row.end_time);

      if (
        !Number.isFinite(start)
        || !Number.isFinite(end)
        || end <= start
      ) {
        continue;
      }

      const slotKey = [
        row.instructor_id,
        row.lesson_date
      ].join('|');

      const intervals = slots.get(slotKey) ?? [];

      intervals.push([start, end]);
      slots.set(slotKey, intervals);
    }

    // איחוד חפיפות לפי מדריך ויום.
    // שיעור זוגי/קבוצתי אינו מוכפל במספר הילדים.
    let durationMinutes = 0;

    for (const intervals of slots.values()) {
      intervals.sort((a, b) => a[0] - b[0]);

      let currentStart = -1;
      let currentEnd = -1;

      for (const [start, end] of intervals) {
        if (currentStart < 0) {
          currentStart = start;
          currentEnd = end;
        } else if (start <= currentEnd) {
          currentEnd = Math.max(currentEnd, end);
        } else {
          durationMinutes += currentEnd - currentStart;
          currentStart = start;
          currentEnd = end;
        }
      }

      if (currentStart >= 0) {
        durationMinutes += currentEnd - currentStart;
      }
    }

    return {
      month: month.v,
      children: children.size,
      lessons,
      canceled,
      hours: durationMinutes / 60
    };
  });
});

managementForecastRows = computed(() => {
  return this.months.map(month => {
    const rows = this.managementRows()
      .filter(row => row.month === month.v);

    const total = (
      field:
        | 'receivedAgorot'
        | 'forecastAgorot'
        | 'forecastLowAgorot'
        | 'forecastHighAgorot'
    ): number | null => {
      if (
        !rows.length
        || rows.some(row => row[field] == null)
      ) {
        return null;
      }

      return rows.reduce(
        (sum, row) => sum + Number(row[field]),
        0
      );
    };

    return {
      month: month.v,
      received: total('receivedAgorot'),
      forecast: total('forecastAgorot'),
      low: total('forecastLowAgorot'),
      high: total('forecastHighAgorot')
    };
  });
});

managementActions = computed(() => {
  const rows = this.mode() === 'year' ? this.managementRows() : this.managementSelectedRows();

  const total = (
    field:
      | 'unknownAttendance'
      | 'rejected'
      | 'conflictingClaims'
  ): number => {
    return rows.reduce(
      (sum, row) => sum + Number(row[field] ?? 0),
      0
    );
  };

  return [
    {
      title: 'תביעות שנדחו',
      value: total('rejected'),
      action: 'בדיקת סיבת הדחייה והשלמת מסמכים בדף דיווח הקופה'
    },
    {
      title: 'נוכחות שטרם סומנה',
      value: total('unknownAttendance'),
      action: 'השלמת נוכחות במפגשים שכבר הגיע מועד תחילתם'
    },
    {
      title: 'תביעות עם סטטוסים סותרים',
      value: total('conflictingClaims'),
      action: 'בדיקת מצב התביעה ותיקון חוסר ההתאמה ברישום'
    },
    {
      title: 'ילדים עם 3 טיפולים או פחות — כל הקופות',
      value: this.managementPayload()?.lowBalanceChildren ?? 0,
      action: 'בדיקת חידוש אישור מול ההורה והקופה; נתון עדכני למדריך הנבחר'
    }
  ].filter(action => action.value > 0);
});

managementBar(value: number | null): number {
  const values = this.managementForecastRows()
    .flatMap(row => [
      row.received ?? 0,
      row.forecast ?? 0
    ]);

  const max = Math.max(1, ...values);

  return Math.min(
    100,
    Math.max(0, ((value ?? 0) / max) * 100)
  );
}

managementTotal(
  field: keyof ManagementMonth,
  annual = false
): number | null {
  const rows = annual
    ? this.managementRows()
    : this.managementSelectedRows();

  if (
    !rows.length
    || rows.some(row => row[field] == null)
  ) {
    return null;
  }

  return rows.reduce(
    (sum, row) => sum + Number(row[field]),
    0
  );
}

managementAmount(value: number | null): string {
  if (value == null) return 'אין נתון';

  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0
  }).format(value / 100);
}

managementCount(value: number | null): string {
  return value == null
    ? 'אין נתון'
    : value.toLocaleString('he-IL');
}


managementTab = signal<'overview' | 'funds' | 'billing' | 'hours'>('overview');
managementScheduleBusy = signal(false);
managementInstructorError = signal('');
private managementScheduleRequest = 0;
private managementScheduleYear: number | null = null;
private managementFinanceController: AbortController | null = null;
private managementScheduleController: AbortController | null = null;
private managementInstructorController: AbortController | null = null;
private managementDestroyed = false;

managementPeriodLabel = computed(() => this.mode() === 'year'
  ? `שנת ${this.managementYear()}`
  : `${this.months[this.managementMonth() - 1].t} ${this.managementYear()}`);

managementPeriodReceipts = computed<number | null>(() => {
  const rows = this.mode() === 'year'
    ? this.managementRows().filter(r => r.receivedAgorot !== null)
    : this.managementSelectedRows();
  if (!rows.length || rows.some(r => r.receivedAgorot == null)) return null;
  return rows.reduce((sum, r) => sum + Number(r.receivedAgorot), 0);
});

managementActiveChildren = computed<number | null>(() => {
  const rows = this.managementRows().filter(r => r.activeChildren != null);
  return rows.length ? rows.reduce((sum, r) => sum + Number(r.activeChildren), 0) : null;
});

managementFundSummary = computed<ManagementMonth[]>(() => {
  if (this.mode() === 'month') return this.managementSelectedRows();
  const grouped = new Map<string, ManagementMonth[]>();
  for (const row of this.managementRows()) {
    const list = grouped.get(row.fund) ?? [];
    list.push(row); grouped.set(row.fund, list);
  }
  return [...grouped.values()].map(rows => {
    const sum = (key: keyof ManagementMonth) => rows.reduce((total, r) => total + Number(r[key] ?? 0), 0);
    const nullableSum = (key: keyof ManagementMonth) => rows.some(r => r[key] == null) ? null : sum(key);
    const active = rows.find(r => r.activeChildren != null);
    const receipts = rows.filter(r => r.receivedAgorot != null);
    return {
      ...rows[0], activeChildren: active?.activeChildren ?? null,
      lessonCount: nullableSum('lessonCount'),
      present: sum('present'), absent: sum('absent'),
      unknownAttendance: sum('unknownAttendance'), canceled: sum('canceled'),
      dueAgorot: nullableSum('dueAgorot'),
      receivedAgorot: receipts.length ? receipts.reduce((total, r) => total + Number(r.receivedAgorot), 0) : null,
      openBalanceAgorot: sum('openBalanceAgorot'),
      reported: nullableSum('reported'), accepted: nullableSum('accepted'), rejected: nullableSum('rejected'),
      forecastAgorot: nullableSum('forecastAgorot'),
      forecastLowAgorot: nullableSum('forecastLowAgorot'),
      forecastHighAgorot: nullableSum('forecastHighAgorot')
    };
  });
});

onManagementInstructorChange(id: string): void {
  this.managementInstructor.set(id);
  this.syncManagementInstructor();
  void this.refreshManagement(true);
}

private syncManagementInstructor(): void {
  const id = this.managementInstructor();
  const instructor = this.managementInstructors().find(item => item.id === id);
  this.onInstructorChange(id === 'all' ? 'all' : instructor?.name ?? id);
}

selectManagementTab(tab: 'overview' | 'funds' | 'billing' | 'hours'): void {
  this.managementTab.set(tab);
  if (tab === 'billing') void this.loadManagementBilling();
  if (tab === 'hours') {
    this.viewMode = 'reports';
    this.syncManagementInstructor();
    // The existing payroll export is monthly. Retain that behavior.
    if (this.mode() !== 'month') this.setMode('month');
    void this.loadManagementSchedule();
  }
}

private async withManagementTimeout<T>(
  task: PromiseLike<T>, controller: AbortController, timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('MANAGEMENT_TIMEOUT'));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

private managementErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (e?.message === 'MANAGEMENT_TIMEOUT') return 'טעינת הנתונים התארכה. אפשר לנסות שוב.';
  if (e?.code === '42501') return 'אין הרשאה לקריאת הנתונים הניהוליים. יש לבדוק את הרשאת המשתמש בחווה.';
  if (e?.code === 'PGRST202' || e?.code === '42883') return 'פונקציית הנתונים הניהוליים אינה זמינה. יש להתקין את פונקציית ה־SQL שנמסרה.';
  return 'לא ניתן לטעון את הנתונים הניהוליים. אפשר לנסות שוב.';
}

private async loadManagementInstructors(force = false): Promise<void> {
  if (this.managementDestroyed || (this.managementInstructors().length && !force)) return;
  this.managementInstructorController?.abort();
  const controller = new AbortController();
  this.managementInstructorController = controller;
  this.managementInstructorError.set('');
  try {
    const instructors: Array<{ id: string; name: string }> = [];
    const deadline = Date.now() + 20000;
    for (let offset = 0; ; offset += 500) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('MANAGEMENT_TIMEOUT');
      const { data, error } = await this.withManagementTimeout<ManagementDbResponse<ManagementInstructorRow[]>>(
        this.dbc.from('instructors').select('id_number,first_name,last_name')
          .order('id_number').range(offset, offset + 499).abortSignal(controller.signal),
        controller, remaining
      );
      if (controller.signal.aborted || this.managementDestroyed) return;
      if (error) throw error;
      for (const row of data ?? []) {
        const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
        instructors.push({ id: String(row.id_number), name: name || String(row.id_number) });
      }
      if ((data ?? []).length < 500) break;
    }
    instructors.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    this.managementInstructorOptions.set(instructors);
    this.syncManagementInstructor();
  } catch (error) {
    if (this.managementInstructorController === controller && !this.managementDestroyed) {
      this.managementInstructorError.set('רשימת המדריכים לא נטענה. אפשר לרענן ולנסות שוב.');
    }
  }
}

async loadManagementSchedule(force = false): Promise<void> {
  if (this.managementDestroyed || this.isInstructor() || this.fromChildCard()) return;
  const year = this.year;
  if (!force && this.managementScheduleYear === year) return;
  if (!force && this.managementScheduleBusy() && this.managementScheduleYear === -year) return;
  this.managementScheduleController?.abort();
  const controller = new AbortController();
  this.managementScheduleController = controller;
  const request = ++this.managementScheduleRequest;
  this.managementScheduleYear = -year;
  this.managementScheduleBusy.set(true);
  this.managementActivityError.set('');
  this.annualSchedule.set([]);
  try {
    const result: MonthlyReportRow[] = [];
    const deadline = Date.now() + 45000;
    for (let offset = 0; ; offset += 500) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('MANAGEMENT_TIMEOUT');
      const { data, error } = await this.withManagementTimeout<ManagementDbResponse<MonthlyReportRow[]>>(
        this.dbc.from('lessons_schedule_view')
          .select('lesson_id,lesson_date,child_id,instructor_id,instructor_name,status,is_cancellation,start_time,end_time')
          .gte('lesson_date', `${year}-01-01`).lt('lesson_date', `${year + 1}-01-01`)
          .order('lesson_date').order('lesson_id').order('child_id').order('start_time')
          .range(offset, offset + 499).abortSignal(controller.signal),
        controller, remaining
      );
      if (request !== this.managementScheduleRequest || this.managementDestroyed) return;
      if (error) throw error;
      result.push(...((data ?? []) as MonthlyReportRow[]));
      if ((data ?? []).length < 500) break;
    }
    if (request === this.managementScheduleRequest && !controller.signal.aborted) {
      this.annualSchedule.set(result);
      this.managementScheduleYear = year;
    }
  } catch (error) {
    if (request === this.managementScheduleRequest && !this.managementDestroyed) {
      this.managementScheduleYear = null;
      this.managementActivityError.set('לא ניתן לטעון את פירוט הפעילות השנתית. נסי שוב.');
    }
  } finally {
    if (request === this.managementScheduleRequest && !this.managementDestroyed) {
      this.managementScheduleBusy.set(false);
    }
  }
}

async refreshManagement(force = false): Promise<void> {
  if (this.managementDestroyed || this.isInstructor() || this.fromChildCard()) return;
  this.managementYear.set(this.year);
  this.managementMonth.set(this.month);
  if (this.managementTab() === 'billing') void this.loadManagementBilling(force);
  const year = this.year;
  const instructor = this.managementInstructor();
  void this.loadManagementInstructors(force && !!this.managementInstructorError());
  if (this.managementTab() === 'hours') void this.loadManagementSchedule(force);
  const previous = this.managementPayload();
  if (!force && previous?.year === year && previous.instructorId === (instructor === 'all' ? null : instructor)) return;
  this.managementFinanceController?.abort();
  const controller = new AbortController();
  this.managementFinanceController = controller;
  const request = ++this.managementRequest;
  this.managementBusy.set(true);
  this.managementError.set('');
  this.managementPayload.set(null);
  try {
    const { data, error } = await this.withManagementTimeout<ManagementDbResponse<unknown>>(
      this.dbc.rpc('get_farm_management_dashboard', {
        p_year: year, p_instructor_id: instructor === 'all' ? null : instructor
      }).abortSignal(controller.signal),
      controller, 25000
    );
    if (request !== this.managementRequest || this.managementDestroyed || controller.signal.aborted) return;
    if (error) throw error;
    const payload = data as ManagementPayload;

    if (
      !payload
      || payload.version !== 1
      || payload.year !== year
      || payload.instructorId !== (
        instructor === 'all' ? null : instructor
      )
      || !Array.isArray(payload.months)
      || !payload.asOf
      || !payload.forecastBasis
    ) {
      throw new Error('Invalid management dashboard response');
    }

    const numericFields = [
      'activeChildren',
      'scheduledChildren',
      'present',
      'absent',
      'unknownAttendance',
      'canceled',
      'plannedValueAgorot',
      'dueAgorot',
      'receivedAgorot',
      'overdueAgorot',
      'openBalanceAgorot',
      'eligible',
      'reported',
      'accepted',
      'rejected',
      'conflictingClaims',
      'forecastAgorot',
      'forecastLowAgorot',
      'forecastHighAgorot'
    ] as const;

    const signedFields = new Set<string>([
      'plannedValueAgorot',
      'dueAgorot',
      'receivedAgorot',
      'openBalanceAgorot',
      'forecastAgorot',
      'forecastLowAgorot',
      'forecastHighAgorot'
    ]);

    const seen = new Set<string>();

    for (const row of payload.months) {
      const key = `${row.month}|${row.fund}`;

      const invalidNumbers = numericFields.some(field => {
        const value = row[field];

        return value !== null && (
          !Number.isSafeInteger(value)
          || (
            !signedFields.has(field)
            && Number(value) < 0
          )
        );
      });

      if (
        !Number.isInteger(row.month)
        || row.month < 1
        || row.month > 12
        || !row.fund
        || seen.has(key)
        || (row.lessonCount != null && (!Number.isSafeInteger(row.lessonCount) || row.lessonCount < 0))
        || invalidNumbers
      ) {
        throw new Error('Invalid management dashboard rows');
      }

      seen.add(key);
    }

    const funds = [
      ...new Set(payload.months.map(row => row.fund))
    ];

    if (
      funds.some(fund =>
        payload.months.filter(row => row.fund === fund)
          .length !== 12
      )
    ) {
      throw new Error('Incomplete management annual data');
    }

    this.managementPayload.set(payload);

    if (
      this.managementFund() !== 'all'
      && !funds.includes(this.managementFund())
    ) {
      this.managementFund.set('all');
    }
  } catch (error) {
    if (request === this.managementRequest && !this.managementDestroyed) {
      this.managementError.set(this.managementErrorMessage(error));
    }
  } finally {
    if (request === this.managementRequest && !this.managementDestroyed) this.managementBusy.set(false);
  }
}


managementBillingBusy = signal(false);
managementBillingError = signal('');
managementBillingRows = signal<ManagementBillingRow[]>([]);
private managementBillingYear: number | null = null;
private managementBillingRequest = 0;
private managementBillingController: AbortController | null = null;

managementSelectedBillingRows = computed(() => {
  const rows = this.managementBillingRows();
  return this.mode() === 'year' ? rows : rows.filter(r => r.month === this.managementMonth());
});

managementBillingTotals = computed(() => {
  const rows = this.managementSelectedBillingRows().filter(r => r.currency === 'ILS');
  const total = (status: string) => rows.filter(r => r.status === status)
    .reduce((sum, r) => sum + r.amountAgorot, 0);
  return { paid: total('paid'), failed: total('failed'), draft: total('draft') };
});

managementBillingStatus(status: string): string {
  const labels: Record<string, string> = {
    paid: 'שולם', failed: 'נכשל', draft: 'טיוטה', pending: 'ממתין',
    canceled: 'בוטל', cancelled: 'בוטל', refunded: 'הוחזר'
  };
  return labels[status] ?? status;
}

managementBillingAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value / 100);
  } catch {
    return `${(value / 100).toLocaleString('he-IL', {minimumFractionDigits: 2})} ${currency}`;
  }
}

async loadManagementBilling(force = false): Promise<void> {
  if (this.managementDestroyed || this.isInstructor() || this.fromChildCard()) return;
  const year = this.year;
  if (!force && this.managementBillingYear === year) return;
  if (!force && this.managementBillingBusy() && this.managementBillingYear === -year) return;
  this.managementBillingController?.abort();
  const controller = new AbortController();
  this.managementBillingController = controller;
  const request = ++this.managementBillingRequest;
  this.managementBillingYear = -year;
  this.managementBillingRows.set([]);
  this.managementBillingBusy.set(true);
  this.managementBillingError.set('');
  try {
    const {data, error} = await this.withManagementTimeout<ManagementDbResponse<unknown>>(
      this.dbc.rpc('get_farm_billing_summary', {p_year: year}).abortSignal(controller.signal),
      controller, 25000
    );
    if (request !== this.managementBillingRequest || this.managementDestroyed) return;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid billing summary');
    const rows = data as ManagementBillingRow[];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.month}|${row.status}|${row.currency}`;
      if (!Number.isInteger(row.month) || row.month < 1 || row.month > 12
          || typeof row.status !== 'string' || !row.status
          || typeof row.currency !== 'string' || !row.currency
          || !Number.isSafeInteger(row.chargeCount) || row.chargeCount < 0
          || !Number.isSafeInteger(row.parentCount) || row.parentCount < 0
          || !Number.isSafeInteger(row.amountAgorot) || seen.has(key)) {
        throw new Error('Invalid billing summary row');
      }
      seen.add(key);
    }
    this.managementBillingRows.set(rows);
    this.managementBillingYear = year;
  } catch (error) {
    if (request === this.managementBillingRequest && !this.managementDestroyed) {
      this.managementBillingYear = null;
      const e = error as {code?: string; message?: string};
      this.managementBillingError.set(e?.code === 'PGRST202' || e?.code === '42883'
        ? 'יש להתקין את פונקציית סיכום החיובים שנמסרה עם הקבצים.'
        : this.managementErrorMessage(error));
    }
  } finally {
    if (request === this.managementBillingRequest && !this.managementDestroyed)
      this.managementBillingBusy.set(false);
  }
}

ngOnDestroy(): void {
  this.managementBillingController?.abort();
  ++this.managementBillingRequest;
  this.managementDestroyed = true;
  ++this.managementRequest;
  ++this.managementScheduleRequest;
  this.managementFinanceController?.abort();
  this.managementScheduleController?.abort();
  this.managementInstructorController?.abort();
}

}

import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';

type UiRequest = any;

type OccRow = {
  lesson_id: string;
  occur_date: string;     // YYYY-MM-DD
  day_of_week: string;
  start_time: string;     // HH:MM:SS
  end_time: string;       // HH:MM:SS
  lesson_type: string | null;
  status: string;
  instructor_id: string;
};

type LessonMeta = {
  id: string;
  series_id: string | null;
  appointment_kind: string | null;
};

type InstructorMeta = {
  id_number: string;
  first_name: string | null;
  last_name: string | null;
};

type RemainingLessonVM = {
  instructorName: string;
  dayOfWeek: string;
  timeRange: string;
  lessonType: string;
  // תאריך יוצג רק אם זה לא סדרה (אחרת יהיה null)
  occurDate: string | null;
  status: string;
};

@Component({
  selector: 'app-request-remove-child-details',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './request-remove-child-details.component.html',
  styleUrls: ['./request-remove-child-details.component.css'],
})
export class RequestRemoveChildDetailsComponent implements OnInit {
  @Input({ required: true }) request!: UiRequest;
  @Input() decidedByUid?: string;

  // תמיכה גם ב-callbacks
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;

  // תמיכה גם ב-EventEmitters
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  // חילוץ payload בטוח
  payload = computed(() => (this.request?.payload ?? {}) as any);

  childFullName = computed(() => {
    const p = this.payload();
    const first = (p.first_name ?? p.firstName ?? '').toString().trim();
    const last = (p.last_name ?? p.lastName ?? '').toString().trim();
    const full = `${first} ${last}`.trim();
    return full || this.request?.childName || '—';
  });

  reason = computed(() => {
    const p = this.payload();
    return (
      p.reason ??
      p.delete_reason ??
      p.summary ??
      this.request?.summary ??
      ''
    )
      .toString()
      .trim();
  });

  // ===== שיעורים שנותרו (תצוגה) =====
  loadingRemaining = signal(false);
  remainingError = signal<string | null>(null);
  remainingLessons = signal<RemainingLessonVM[]>([]);

  ngOnInit(): void {
    // טוען אוטומטית כשפותחים את פרטי הבקשה
    void this.loadRemainingLessons();
  }

  private getChildId(): string | null {
    // אצלך ב-mapRowToUi יש childId
    return this.request?.childId ?? this.payload()?.child_id ?? null;
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private fmtTime(t: string | null | undefined): string {
    if (!t) return '—';
    return t.slice(0, 5); // HH:MM
  }

  private fullName(first: string | null, last: string | null): string {
    const f = (first ?? '').trim();
    const l = (last ?? '').trim();
    const full = `${f} ${l}`.trim();
    return full || '—';
  }

  async loadRemainingLessons() {
    const childId = this.getChildId();
    if (!childId) {
      this.remainingError.set('חסר childId בבקשה ולכן אי אפשר להביא שיעורים.');
      this.remainingLessons.set([]);
      return;
    }

    this.loadingRemaining.set(true);
    this.remainingError.set(null);

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      // 1) שליפה מה-view lessons_occurrences
      const { data: occData, error: occErr } = await db
        .from('lessons_occurrences')
        .select('lesson_id, occur_date, day_of_week, start_time, end_time, lesson_type, status, instructor_id')
        .eq('child_id', childId)
        .gte('occur_date', this.todayIso())
        .in('status', ['ממתין לאישור', 'אושר'])
        .order('occur_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (occErr) throw occErr;

      const occ = (occData ?? []) as OccRow[];
      if (!occ.length) {
        this.remainingLessons.set([]);
        return;
      }

      // 2) מביאים meta על השיעור מ-lessons (כדי לדעת אם סדרה)
      const lessonIds = Array.from(new Set(occ.map(o => o.lesson_id).filter(Boolean)));

      const { data: lessonsData, error: lessonsErr } = await db
        .from('lessons')
        .select('id, series_id, appointment_kind')
        .in('id', lessonIds);

      if (lessonsErr) throw lessonsErr;

      const lessonsMap = new Map<string, LessonMeta>();
      (lessonsData ?? []).forEach((l: any) => {
        lessonsMap.set(l.id, {
          id: l.id,
          series_id: l.series_id ?? null,
          appointment_kind: l.appointment_kind ?? null,
        });
      });

      // 3) מביאים שמות מדריכים (לפי instructor_id / id_number)
      const instructorIds = Array.from(new Set(occ.map(o => o.instructor_id).filter(Boolean)));

      const { data: instData, error: instErr } = await db
        .from('instructors')
        .select('id_number, first_name, last_name')
        .in('id_number', instructorIds);

      if (instErr) throw instErr;

      const instMap = new Map<string, InstructorMeta>();
      (instData ?? []).forEach((i: any) => {
        instMap.set(i.id_number, {
          id_number: i.id_number,
          first_name: i.first_name ?? null,
          last_name: i.last_name ?? null,
        });
      });

      // 4) בניית ViewModel למסך
      const vm: RemainingLessonVM[] = occ.map((o) => {
        const meta = lessonsMap.get(o.lesson_id);
        const isSeries =
          !!meta?.series_id || meta?.appointment_kind === 'therapy_series';

        const ins = instMap.get(o.instructor_id);

        return {
          instructorName: this.fullName(ins?.first_name ?? null, ins?.last_name ?? null),
          dayOfWeek: o.day_of_week || '—',
          timeRange: `${this.fmtTime(o.start_time)}–${this.fmtTime(o.end_time)}`,
          lessonType: o.lesson_type ?? '—',
          occurDate: isSeries ? null : o.occur_date,
          status: o.status,
        };
      });

      this.remainingLessons.set(vm);
    } catch (err: any) {
      console.error('loadRemainingLessons failed', err);
      this.remainingError.set(err?.message ?? 'שגיאה בשליפת שיעורים שנותרו');
      this.remainingLessons.set([]);
    } finally {
      this.loadingRemaining.set(false);
    }
  }

  // ===== פעולות (נשאר סימולציה כמו שביקשת) =====
  async approveSimulate() {
    try {
      const e = { requestId: this.request.id, newStatus: 'APPROVED' as const };
      this.approved.emit(e);
      this.onApproved?.(e);
    } catch (err: any) {
      const msg = err?.message ?? 'שגיאה באישור (סימולציה)';
      this.error.emit(msg);
      this.onError?.({ requestId: this.request?.id, message: msg, raw: err });
    }
  }

  rejectSimulate() {
    try {
      const ok = window.confirm(
        'לא מתבצעת מחיקה בדאטאבייס.\nרק סימון UI כ"נדחה".\nלהמשיך?'
      );
      if (!ok) return;

      const e = { requestId: this.request.id, newStatus: 'REJECTED' as const };
      this.rejected.emit(e);
      this.onRejected?.(e);
    } catch (err: any) {
      const msg = err?.message ?? 'שגיאה בדחייה (סימולציה)';
      this.error.emit(msg);
      this.onError?.({ requestId: this.request?.id, message: msg, raw: err });
    }
  }
}

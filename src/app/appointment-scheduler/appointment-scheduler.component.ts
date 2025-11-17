import { Component, Input, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, fetchMyChildren } from '../services/supabaseClient.service';
import { AppointmentMode, AppointmentTab, ChildRow, CurrentUser } from '../Types/detailes.model';
import { CurrentUserService } from '../core/auth/current-user.service';
import { ActivatedRoute } from '@angular/router';
import { SELECTION_LIST } from '@angular/material/list';


interface ApprovalBalance {
  approval_id: string;
  child_id: string;
  health_fund: string | null;
  approval_number: string | null;
  total_lessons: number;
  used_lessons_calc: number;
  remaining_lessons: number;
}

interface RecurringSlot {
  lesson_date: string;   // YYYY-MM-DD
  start_time: string;    // HH:MM:SS
  end_time: string;      // HH:MM:SS
  instructor_id: string; // text
}

interface MakeupSlot {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  remaining_capacity: number;
}

@Component({
  selector: 'app-appointment-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './appointment-scheduler.component.html',
  styleUrls: ['./appointment-scheduler.component.scss'],
})
export class AppointmentSchedulerComponent implements OnInit {

  /** רשימת ילדים מגיעה מהקומפוננטה ההורה */
  @Input() selectChild: string = "";

  /** מצב – הורה או מזכירה (לוגים/סטטוס ב־origin) */
  @Input() needApprove!: boolean;

  children: ChildRow[] = [];

  // מצב כללי
  selectedTab: AppointmentTab = 'series';
  selectedChildId: string | null = null;

  // ---- נתוני אישורים (קופה/פרטי) ----
  approvals: ApprovalBalance[] = [];
  selectedApprovalId: string | null = null;

  private readonly CHILD_SELECT =
  'child_uuid, first_name, last_name, instructor_id';

  get selectedApproval(): ApprovalBalance | undefined {
    return this.approvals.find(a => a.approval_id === this.selectedApprovalId);
  }

  // ---- סדרת טיפולים ----
  daysOfWeek = [
    { value: 0, label: 'ראשון' },
    { value: 1, label: 'שני' },
    { value: 2, label: 'שלישי' },
    { value: 3, label: 'רביעי' },
    { value: 4, label: 'חמישי' },
  ];

  seriesDayOfWeek: number | null = null;
  seriesStartTime = '16:00'; // קלט בצורת HH:MM
  paymentSourceForSeries: 'health_fund' | 'private' = 'health_fund';

  recurringSlots: RecurringSlot[] = [];
  loadingSeries = false;
  seriesError: string | null = null;
  seriesCreatedMessage: string | null = null;

  // ---- שיעור השלמה ----
  makeupFromDate: string | null = null; // YYYY-MM-DD
  makeupToDate: string | null = null;
  makeupSlots: MakeupSlot[] = [];
  loadingMakeup = false;
  makeupError: string | null = null;
  makeupCreatedMessage: string | null = null;
  user: CurrentUser | null = null;

  constructor(
  private currentUser: CurrentUserService,
  private route: ActivatedRoute
) {
  this.user = this.currentUser.current;
}

  async ngOnInit(): Promise<void> {
  // 1. אם הגיעו ילדים מהקומפוננטה ההורה → מצוין
  if (this.children && this.children.length > 0) {
    this.selectedChildId = this.children.length === 1 ? this.children[0].child_uuid : null;
    if (this.selectedChildId) await this.onChildChange();
    return;
  }

  // 2. אם הועברו ילדים דרך query params → נטען אותם
  const qpChildren = this.route.snapshot.queryParamMap.get('children');
  if (qpChildren) {
    try {
      this.children = JSON.parse(qpChildren);
      this.selectedChildId = this.children.length === 1 ? this.children[0].child_uuid : null;
      if (this.selectedChildId) await this.onChildChange();
      return;
    } catch (e) {
      console.error('invalid children param', e);
    }
  }

  // 3. לא הגיעו ילדים → נטען לפי המשתמש המחובר
  await this.loadChildrenFromCurrentUser();
}

private async loadChildrenFromCurrentUser(): Promise<void> {
  if (!this.user) return;

  const baseSelect =
    this.CHILD_SELECT && this.CHILD_SELECT.trim().length
  ? this.CHILD_SELECT
  : 'child_uuid, first_name, last_name, status';
    const hasStatus = /(^|,)\s*status\s*(,|$)/.test(baseSelect);
    const selectWithStatus = hasStatus ? baseSelect : `${baseSelect}, status`;

    const { data, error } =  await fetchMyChildren(selectWithStatus);

  if (!error && data) {
    this.children = data;
    if (this.children.length === 1) {
      this.selectedChildId = this.children[0].child_uuid;
      await this.onChildChange();
    }
  }
}


  // =========================================
  //  שינוי ילד – טוען אישורים ומנקה מצבים
  // =========================================
  async onChildChange(): Promise<void> {
    this.seriesError = null;
    this.makeupError = null;
    this.seriesCreatedMessage = null;
    this.makeupCreatedMessage = null;
    this.recurringSlots = [];
    this.makeupSlots = [];
    this.approvals = [];
    this.selectedApprovalId = null;

    if (!this.selectedChildId) return;

    const supa = dbTenant();
    const { data, error } = await supa
      .from('v_child_approval_balances')
      .select('*')
      .eq('child_id', this.selectedChildId)
      .order('remaining_lessons', { ascending: false });

    if (error) {
      console.error(error);
      this.seriesError = 'שגיאה בטעינת אישורי טיפול';
      return;
    }

    this.approvals = data ?? [];
    if (this.approvals.length > 0) {
      this.selectedApprovalId = this.approvals[0].approval_id;
    }
  }

  // =========================================
  //   חיפוש סדרות זמינות (find_recurring_slots)
  // =========================================
  async searchRecurringSlots(): Promise<void> {
    this.seriesError = null;
    this.seriesCreatedMessage = null;
    this.recurringSlots = [];

    if (!this.selectedChildId || !this.selectedApprovalId || this.seriesDayOfWeek === null) {
      this.seriesError = 'יש לבחור ילד, אישור ויום בשבוע';
      return;
    }

    const startTime = this.seriesStartTime.includes(':')
      ? this.seriesStartTime + ':00'
      : this.seriesStartTime; // לוודא HH:MM:SS

    this.loadingSeries = true;
    try {
      const { data, error } = await dbTenant().rpc('find_recurring_slots', {
        p_child_id: this.selectedChildId,
        p_approval_id: this.selectedApprovalId,
        p_day_of_week: this.seriesDayOfWeek,
        p_start_time: startTime,
      });

      if (error) {
        console.error(error);
        this.seriesError = 'שגיאה בחיפוש סדרות זמינות';
        return;
      }

      this.recurringSlots = (data ?? []) as RecurringSlot[];
    } finally {
      this.loadingSeries = false;
    }
  }

  // יצירת סדרה בפועל – insert ל-lessons (occurrences נוצרים מה-view)
  async createSeriesFromSlot(slot: RecurringSlot): Promise<void> {
    if (!this.selectedChildId) return;

    const approval = this.selectedApproval;
    if (!approval && this.paymentSourceForSeries === 'health_fund') {
      this.seriesError = 'לא נבחר אישור טיפול';
      return;
    }

    // כמה שיעורים לשבץ – לפי יתרה באישור, או 1 כפרטי אם אין אישור
    const repeatWeeks =
      this.paymentSourceForSeries === 'health_fund' && approval
        ? Math.max(1, approval.remaining_lessons)
        : 12; // ברירת מחדל – 12 שבועות (אפשר לשנות למשתנה בטופס)

    const anchorWeekStart = this.calcAnchorWeekStart(slot.lesson_date);
    const dayLabel = this.dayOfWeekLabel(this.seriesDayOfWeek!);

    const { data, error } = await dbTenant()
      .from('lessons')
      .insert({
        child_id: this.selectedChildId,
        instructor_id: slot.instructor_id,
        lesson_type: 'רגיל',
        status: 'אושר',
        day_of_week: dayLabel,
        start_time: slot.start_time,
        end_time: slot.end_time,
        repeat_weeks: repeatWeeks,
        anchor_week_start: anchorWeekStart,
        appointment_kind: 'therapy_series',
        approval_id:
          this.paymentSourceForSeries === 'health_fund' && approval
            ? approval.approval_id
            : null,
        origin: this.user!.role === 'parent' ? 'parent' : 'secretary',
        is_tentative: false,
        capacity: 1,
        current_booked: 1,
        payment_source:
          this.paymentSourceForSeries === 'health_fund' && approval
            ? 'health_fund'
            : 'private',
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      this.seriesError = 'שגיאה ביצירת הסדרה';
      return;
    }

    this.seriesCreatedMessage = 'הסדרה נוצרה בהצלחה';
    // אפשר לעדכן האישורים מה־view
    await this.onChildChange();
  }

  // =========================================
  //   חיפוש חורים להשלמות (find_makeup_slots)
  // =========================================
  async searchMakeupSlots(): Promise<void> {
    this.makeupError = null;
    this.makeupCreatedMessage = null;
    this.makeupSlots = [];

    if (!this.selectedChildId || !this.makeupFromDate || !this.makeupToDate) {
      this.makeupError = 'יש לבחור ילד וטווח תאריכים';
      return;
    }

    this.loadingMakeup = true;
    try {
      const { data, error } = await dbTenant().rpc('find_makeup_slots', {
        p_child_id: this.selectedChildId,
        p_from_date: this.makeupFromDate,
        p_to_date: this.makeupToDate,
      });

      if (error) {
        console.error(error);
        this.makeupError = 'שגיאה בחיפוש חורים להשלמה';
        return;
      }

      this.makeupSlots = (data ?? []) as MakeupSlot[];
    } finally {
      this.loadingMakeup = false;
    }
  }

  // יצירת שיעור השלמה – יוצר lesson יחיד (repeat_weeks = 1)
  async bookMakeupSlot(slot: MakeupSlot): Promise<void> {
    if (!this.selectedChildId) return;

    const dayLabel = this.dayOfWeekLabelFromDate(slot.occur_date);
    const anchorWeekStart = this.calcAnchorWeekStart(slot.occur_date);

    const { data, error } = await dbTenant()
      .from('lessons')
      .insert({
        child_id: this.selectedChildId,
        instructor_id: slot.instructor_id,
        lesson_type: 'השלמה',
        status: 'אושר',
        day_of_week: dayLabel,
        start_time: slot.start_time,
        end_time: slot.end_time,
        repeat_weeks: 1,
        anchor_week_start: anchorWeekStart,
        appointment_kind: 'therapy_makeup',
        // אם יש אישור פעיל – אפשר לבחור אחד approvals ולהצמיד אותו:
        approval_id: this.selectedApproval?.approval_id ?? null,
        origin: this.user!.role === 'parent' ? 'parent' : 'secretary',
        is_tentative: false,
        capacity: 1,
        current_booked: 1,
        payment_source: this.selectedApproval ? 'health_fund' : 'private',
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      this.makeupError = 'שגיאה ביצירת שיעור ההשלמה';
      return;
    }

    this.makeupCreatedMessage = 'שיעור ההשלמה נוצר בהצלחה';
    await this.onChildChange();
  }

  // =========================================
  //           עזרי תאריכים / ימים
  // =========================================
  private dayOfWeekLabel(value: number): string {
    return this.daysOfWeek.find(d => d.value === value)?.label ?? '';
  }

  private dayOfWeekLabelFromDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getUTCDay(); // 0-6
    return this.dayOfWeekLabel(dow);
  }

  /**
   * anchor_week_start = יום ראשון של השבוע של lesson_date
   */
  private calcAnchorWeekStart(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getUTCDay(); // 0=Sunday
    const sunday = new Date(d);
    sunday.setUTCDate(d.getUTCDate() - dow); // לחזור לראשון
    const yyyy = sunday.getUTCFullYear();
    const mm = String(sunday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(sunday.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

// src/app/pages/farm-settings/farm-settings.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { HDate } from '@hebcal/core';
import { UiDialogService } from '../../services/ui-dialog.service';

type UUID = string;

type LateCancelPolicy = 'CHARGE_FULL' | 'CHARGE_PARTIAL' | 'NO_CHARGE' | 'NO_MAKEUP';
type AttendanceDefault = 'ASSUME_ATTENDED' | 'ASSUME_ABSENT' | 'REQUIRE_MARKING';
type ReminderChannel = 'EMAIL' | 'SMS' | 'APP' | 'WHATSAPP';

type CalendarKind = 'GREGORIAN' | 'HEBREW';
type RecurrenceKind = 'ONCE' | 'YEARLY';
type DayType = 'FULL_DAY' | 'PARTIAL_DAY';

interface FarmSettings {
  id?: UUID;

  operating_hours_start: string | null;
  operating_hours_end: string | null;

  office_hours_start: string | null;
  office_hours_end: string | null;

  default_lessons_per_series: number | null;
  lesson_duration_minutes: number | null;
  default_lesson_price: number | null;

  makeup_allowed_days_back: number | null;
  makeup_allowed_days_ahead: number | null;
  max_makeups_in_period: number | null;
  makeups_period_days: number | null;
  displayed_makeup_lessons_count: number | null;
  min_time_between_cancellations: string | null;

  cancel_before_hours: number | null;
  late_cancel_policy: LateCancelPolicy | null;
  late_cancel_fee_amount: number | null;
  late_cancel_fee_percent: number | null;

  attendance_default: AttendanceDefault | null;

  monthly_billing_day: number | null;

  working_days: number[] | null;
  timezone: string | null;

  send_lesson_reminder: boolean | null;
  reminder_hours_before: number | null;
  reminder_channel: ReminderChannel | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;

  enable_discounts: boolean | null;
  late_payment_fee: number | null;
  interest_percent_monthly: number | null;

  late_payment_grace_days?: number | null;

  notify_before_farm_closure?: boolean | null;
  notify_before_farm_closure_hours?: number | null;

  suggest_makeup_on_cancel?: boolean | null;
  reminder_require_confirmation?: boolean | null;
  reminder_allow_cancel_link?: boolean | null;

  registration_fee: number | null;
  student_insurance_premiums: number | null;

  max_group_size?: number | null;
  max_lessons_per_week_per_child?: number | null;
  allow_online_booking?: boolean | null;

  updated_at?: string | null;
}

type ListNoteId = number;

interface ListNote {
  id: ListNoteId;
  note: string;
}

interface FundingSource {
  id: UUID;
  name: string;
  is_system: boolean;
  is_active: boolean;
}

interface PaymentPlanPriceVersion {
  id: UUID;
  valid_from: string;
  lesson_price: number;
  subsidy_amount: number;
  customer_amount: number;
}

interface PaymentPlan {
  id?: UUID;
  name: string;
  lesson_price: number | null;
  subsidy_amount: number | null;
  customer_amount?: number | null;
  funding_source_id: UUID | null;
  required_docs: string[];
  require_docs_at_booking: boolean;
  is_active?: boolean;

  // UI-only
  newVersionDate?: string | null;
  newVersionPrice?: number | null;
  newVersionSubsidy?: number | null;

  versions?: PaymentPlanPriceVersion[];
}

interface FarmDayOff {
  id?: UUID;

  // Gregorian (db)
  start_date: string | null;
  end_date: string | null;

  // UI
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;

  reason: string;
  is_active: boolean;

  created_at?: string;

  day_type?: DayType;
  recurrence?: RecurrenceKind;

  // Calendar kind + Hebrew fields
  calendar_kind?: CalendarKind;

  hebrew_day?: number | null; // 1..30
  hebrew_month?: number | null; // 1..13 (Hebcal)
  hebrew_end_day?: number | null;
  hebrew_end_month?: number | null;

  notify_parents_before?: boolean;
  notify_days_before?: number | null;
}

interface FarmWorkingHours {
  id?: UUID;
  day_of_week: number; // 1..7
  is_open: boolean;

  farm_start: string | null; // "HH:MM"
  farm_end: string | null;

  is_offical_open: boolean;
  office_start: string | null;
  office_end: string | null;
}

@Component({
  selector: 'app-farm-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './farm-settings.component.html',
  styleUrls: ['./farm-settings.component.scss'],
})
export class FarmSettingsComponent implements OnInit {
  private readonly SETTINGS_SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

  private get supabase() {
    return dbTenant();
  }

  private ui = inject(UiDialogService);

  // ====== Structured Notes (list_notes) ======
  listNotes = signal<ListNote[]>([]);
  showNewListNoteForm = signal(false);
  editingListNoteId = signal<ListNoteId | null>(null);

  newListNoteText = signal<string>('');
  listNotesExpanded = signal(true);
  // שבת: ו׳ מ-16:00 ועד מוצ"ש 19:00
private readonly SHABBAT_START = '16:00';
private readonly SHABBAT_END = '19:00';

private isFriday(day: number) { return day === 6; }   // ו'
private isSaturday(day: number) { return day === 7; } // ש'

  private flashTimer: any = null;

/** יש לפחות יום אחד פעיל (חווה או משרד) */
hasAnyActiveWorkingDay(): boolean {
  return this.workingHours().some(r => !!r.is_open || !!r.is_offical_open);
}


  toggleListNotesExpanded(): void {
    const next = !this.listNotesExpanded();
    this.listNotesExpanded.set(next);

    if (!next) {
      this.showNewListNoteForm.set(false);
      this.editingListNoteId.set(null);
      this.newListNoteText.set('');
    }
  }

  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  settings = signal<FarmSettings | null>(null);

  // Accordion hours
  workingHoursExpanded = signal(true);
  workingHoursError = signal<string | null>(null);

  // ====== Funding & Plans ======
  showNewFundingForm = signal(false);
  showNewPlanForm = signal(false);
  editingFundingId = signal<UUID | null>(null);
  editingPlanId = signal<UUID | null>(null);

  fundingSources = signal<FundingSource[]>([]);
  newFundingSourceName = signal<string>('');

  paymentPlans = signal<PaymentPlan[]>([]);
  newPlan: PaymentPlan = {
    name: '',
    lesson_price: null,
    subsidy_amount: 0,
    funding_source_id: null,
    required_docs: [],
    require_docs_at_booking: true,
    is_active: true,
  };

  // ===== Hebrew months (Hebcal) =====
  hebrewMonths = [
    { value: 1, label: 'תשרי' },
    { value: 2, label: 'חשוון' },
    { value: 3, label: 'כסלו' },
    { value: 4, label: 'טבת' },
    { value: 5, label: 'שבט' },
    { value: 6, label: 'אדר' },
    { value: 7, label: 'אדר ב' },
    { value: 8, label: 'ניסן' },
    { value: 9, label: 'אייר' },
    { value: 10, label: 'סיון' },
    { value: 11, label: 'תמוז' },
    { value: 12, label: 'אב' },
    { value: 13, label: 'אלול' },
  ];

  hebrewDays = Array.from({ length: 30 }, (_, i) => i + 1);

  // ====== Special days ======
  showSpecialDaysModal = signal(false);
  daysOff = signal<FarmDayOff[]>([]);
  specialDayForm = signal<FarmDayOff>({
    start_date: '',
    end_date: '',
    all_day: true,
    start_time: null,
    end_time: null,
    reason: '',
    is_active: true,
    recurrence: 'ONCE',
    notify_parents_before: false,
    notify_days_before: 1,

    calendar_kind: 'GREGORIAN',
    hebrew_day: null,
    hebrew_month: null,
    hebrew_end_day: null,
    hebrew_end_month: null,
  });

  dateRangeError = signal<string | null>(null);

  // ====== Working hours per day ======
  workingHours = signal<FarmWorkingHours[]>([]);

  // ================================
  async ngOnInit(): Promise<void> {
  this.loading.set(true);
  this.error.set(null);
  this.success.set(null);

  try {
    await Promise.all([
      this.loadSettings(),
      this.loadFundingSources(),
      this.loadPaymentPlans(),
      this.loadFarmDaysOff(),
      this.loadWorkingHours(),
      this.loadListNotes(),
    ]);

    if (!this.workingHours().length) {
      this.workingHours.set(this.enforceShabbatRules(this.buildEmptyWorkingHours()));
    } else {
      // ליתר ביטחון אחרי טעינה/seed
      this.workingHours.set(this.enforceShabbatRules(this.workingHours()));
    }

    // פעם אחת בלבד
    this.workingHoursError.set(this.validateAllWorkingHours());
  } catch (e) {
    console.error(e);
    await this.ui.alert('שגיאה בטעינת הנתונים.', 'שגיאה');
    this.error.set('שגיאה בטעינת הנתונים.');
  } finally {
    this.loading.set(false);
  }
}

  // =============================
  // Helpers
  // =============================
  toggleWorkingHoursExpanded(): void {
    this.workingHoursExpanded.set(!this.workingHoursExpanded());
  }

  trackByDay = (_: number, r: FarmWorkingHours) => r.day_of_week;

  getHebDayLabel(d: number): string {
    switch (d) {
      case 1: return 'א׳';
      case 2: return 'ב׳';
      case 3: return 'ג׳';
      case 4: return 'ד׳';
      case 5: return 'ה׳';
      case 6: return 'ו׳';
      case 7: return 'ש׳';
      default: return String(d);
    }
  }

  private t5(v: any): string | null {
    if (v == null) return null;
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
  }

  private timeToDb(t: string | null): string | null {
    if (!t) return null;
    return t.length === 5 ? `${t}:00` : t;
  }

  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** מחזיר את התאריך הלועזי הקרוב (מהיום והלאה) עבור יום/חודש עברי */
  private nextGregorianFromHebrew(heDay: number, heMonth: number): string {
    const today = new Date();
    const hToday = new HDate(today);
    let hy = hToday.getFullYear();

    let g = new HDate(heDay, heMonth, hy).greg();

    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (g < startOfToday) {
      hy += 1;
      g = new HDate(heDay, heMonth, hy).greg();
    }

    return this.toIsoDate(g);
  }



private clearFlash(): void {
  this.success.set(null);
  this.error.set(null);
  if (this.flashTimer) {
    clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }
}

private flashSuccess(msg: string): void {
  this.clearFlash();
  this.success.set(msg);
  this.flashTimer = setTimeout(() => this.success.set(null), 4000);
}

private flashError(msg: string): void {
  this.clearFlash();
  this.error.set(msg);
  this.flashTimer = setTimeout(() => this.error.set(null), 6000);
}


  /** סנכרון עברי->לועזי (start_date/end_date) כדי לשמור DB תקין */
  syncHebrewToGregorianDates(): void {
    const f = this.specialDayForm();
    if ((f.calendar_kind ?? 'GREGORIAN') !== 'HEBREW') return;

    const sd = f.hebrew_day ?? null;
    const sm = f.hebrew_month ?? null;
    const ed = f.hebrew_end_day ?? sd;
    const em = f.hebrew_end_month ?? sm;

    if (!sd || !sm) return;

    const start = this.nextGregorianFromHebrew(sd, sm);
    const end = ed && em ? this.nextGregorianFromHebrew(ed, em) : start;

    const next: FarmDayOff = {
      ...f,
      start_date: start,
      end_date: end,
      hebrew_end_day: ed,
      hebrew_end_month: em,
    };

    this.specialDayForm.set(next);
    this.validateSpecialDayDateRange(next);
  }

  setCalendarKind(kind: CalendarKind): void {
    const f = this.specialDayForm();

    if (kind === 'GREGORIAN') {
      this.specialDayForm.set({
        ...f,
        calendar_kind: 'GREGORIAN',
        hebrew_day: null,
        hebrew_month: null,
        hebrew_end_day: null,
        hebrew_end_month: null,
      });
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);

    this.specialDayForm.set({
      ...f,
      calendar_kind: 'HEBREW',
      recurrence: f.recurrence ?? 'YEARLY',
      start_date: f.start_date || todayIso,
      end_date: f.end_date || todayIso,
      hebrew_day: f.hebrew_day ?? 10,
      hebrew_month: f.hebrew_month ?? 1,
      hebrew_end_day: f.hebrew_end_day ?? f.hebrew_day ?? 10,
      hebrew_end_month: f.hebrew_end_month ?? f.hebrew_month ?? 1,
    });

    this.syncHebrewToGregorianDates();
  }

  // =============================
  // Working Hours (per day)
  // =============================
  async loadWorkingHours(): Promise<void> {
    const { data, error } = await this.supabase
      .from('farm_working_hours')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (error) {
      console.error('loadWorkingHours error', error);
      return;
    }

    console.log('loadWorkingHours data:', data);
    const list: FarmWorkingHours[] = (data || []).map((r: any) => ({
      id: r.id,
      day_of_week: r.day_of_week,
      is_open: r.is_open ?? true,
      farm_start: this.t5(r.farm_start),
      farm_end: this.t5(r.farm_end),
      is_offical_open: r.is_offical_open ?? false,
      office_start: this.t5(r.office_start),
      office_end: this.t5(r.office_end),
    }));

    console.log('loadWorkingHours before enforceShabbatRules:', list);
    this.workingHours.set(this.enforceShabbatRules(list));
    console.log('day_of_week values:', list.map(x => x.day_of_week));

  }

  private buildEmptyWorkingHours(): FarmWorkingHours[] {
  const s = this.settings();
  const defFarmStart = s?.operating_hours_start ?? '08:00';
  const defFarmEnd = s?.operating_hours_end ?? '20:00';

  const arr: FarmWorkingHours[] = [];
  for (let d = 1; d <= 7; d++) {
    const isSat = d === 7; // שבת
    arr.push({
      day_of_week: d,
      is_open: !isSat,
      farm_start: isSat ? null : defFarmStart,
      farm_end: isSat ? null : defFarmEnd,
      is_offical_open: false,
      office_start: null,
      office_end: null,
    });
  }
  return arr;
}

private compareTime(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b); // עובד ל-HH:MM
}

private enforceShabbatRulesRow(r: FarmWorkingHours): FarmWorkingHours {
  const next = { ...r };

  // שבת (7): אם פתוח, מתחילים לא לפני 19:00
  if (this.isSaturday(next.day_of_week)) {
    if (next.is_open) {
      if (!next.farm_start || this.compareTime(next.farm_start, this.SHABBAT_END) < 0) {
        next.farm_start = this.SHABBAT_END;
      }
      if (next.farm_end && this.compareTime(next.farm_end, next.farm_start) <= 0) next.farm_end = null;
    } else {
      next.farm_start = null;
      next.farm_end = null;
    }

    if (next.is_offical_open) {
      if (!next.office_start || this.compareTime(next.office_start, this.SHABBAT_END) < 0) {
        next.office_start = this.SHABBAT_END;
      }
      if (next.office_end && this.compareTime(next.office_end, next.office_start) <= 0) next.office_end = null;
    } else {
      next.office_start = null;
      next.office_end = null;
    }

    return next;
  }

  // שישי (6): לא לשים שעות אחרי 16:00
  if (this.isFriday(next.day_of_week)) {
    const clampEnd = (t: string | null) => (t && this.compareTime(t, this.SHABBAT_START) > 0 ? this.SHABBAT_START : t);
    const invalidStart = (t: string | null) => (t && this.compareTime(t, this.SHABBAT_START) >= 0);

    if (next.is_open) {
      if (invalidStart(next.farm_start)) next.farm_start = '08:00';
      next.farm_end = clampEnd(next.farm_end);
      if (next.farm_end && next.farm_start && this.compareTime(next.farm_end, next.farm_start) <= 0) next.farm_end = null;
    }

    if (next.is_offical_open) {
      if (invalidStart(next.office_start)) next.office_start = '08:30';
      next.office_end = clampEnd(next.office_end);
      if (next.office_end && next.office_start && this.compareTime(next.office_end, next.office_start) <= 0) next.office_end = null;
    }

    return next;
  }

  return next;
}

private enforceShabbatRules(rows: FarmWorkingHours[]): FarmWorkingHours[] {
  // שומר על immutable כדי שה-signal יעדכן UI
  return rows.map(r => this.enforceShabbatRulesRow(r));
}


 onWorkingHoursChanged(): void {
  // רק ולידציה (מהיר)
  this.workingHoursError.set(this.validateAllWorkingHours());
}

private applyWorkingHoursRulesAndValidate(): void {
  this.workingHours.update(rows => this.enforceShabbatRules(rows));
  this.workingHoursError.set(this.validateAllWorkingHours());
}


  private validateAllWorkingHours(): string | null {
    const rows = this.workingHours();
    for (const r of rows) {
      const msg = this.validateWorkingHoursRow(r);
      if (msg) return msg;
    }
    return null;
  }
  // ===== Special Day rules (Day 6/7) =====
private readonly DAY6_CUTOFF = '16:00'; // יום 6
private readonly DAY7_START  = '19:00'; // יום 7

private isoDow(isoDate: string | null): number | null {
  if (!isoDate) return null;
  // מונע בעיות TZ: בונים "צהריים" מקומי
  const d = new Date(`${isoDate}T12:00:00`);
  // JS: 0=Sunday ... 5=Friday ... 6=Saturday
  return d.getDay();
}

private clampMin(t: string | null, min: string): string | null {
  if (!t) return null;
  return t < min ? min : t;
}
private clampMax(t: string | null, max: string): string | null {
  if (!t) return null;
  return t > max ? max : t;
}

private applySpecialDayRules(form: FarmDayOff): FarmDayOff {
  // אוכפים רק כשזה "חלק מהיום" ובאותו יום (לא טווח)
  if (form.all_day) return form;
  if (!form.start_date || !form.end_date) return form;
  if (form.start_date !== form.end_date) return form;

  const dow = this.isoDow(form.start_date);
  if (dow == null) return form;

  const next = { ...form };

  // יום 7 (JS Saturday=6): אסור להתחיל לפני 19:00
  if (dow === 6) {
    next.start_time = this.clampMin(next.start_time, this.DAY7_START);
    // אם סיום לפני התחלה -> ננקה כדי שיראו שגיאה
    if (next.end_time && next.start_time && next.end_time <= next.start_time) {
      next.end_time = null;
    }
  }

  // יום 6 (JS Friday=5): אסור לסיים אחרי 16:00
  if (dow === 5) {
    next.end_time = this.clampMax(next.end_time, this.DAY6_CUTOFF);
    if (next.start_time && next.start_time >= this.DAY6_CUTOFF) {
      // אם שמו התחלה לא חוקית – נחזיר לברירת מחדל
      next.start_time = this.settings()?.operating_hours_start ?? '08:00';
    }
    if (next.end_time && next.start_time && next.end_time <= next.start_time) {
      next.end_time = null;
    }
  }

  return next;
}


  private validateWorkingHoursRow(r: FarmWorkingHours): string | null {
    const day = this.getHebDayLabel(r.day_of_week);

    // ---- חווה ----
    if (r.is_open) {
      if (!r.farm_start || !r.farm_end) {
        return `בשעות חווה: חסר טווח שעות ליום ${day}.`;
      }
      if (r.farm_end <= r.farm_start) {
        return `בשעות חווה: שעת סיום חייבת להיות אחרי שעת התחלה ביום ${day}.`;
      }
    }
    // שבת: אם פתוח, לא מתחילים לפני 19:00
    if (this.isSaturday(r.day_of_week)) {
  if (r.is_open) {
    if (r.farm_start && r.farm_start < this.SHABBAT_END) return 'בשבת אין להתחיל לפני 19:00.';
    if (r.farm_end && r.farm_end < this.SHABBAT_END) return 'ביום שישי לא ניתן לסיים לאחר 16:00.';
  }
  if (r.is_offical_open) {
    if (r.office_start && r.office_start < this.SHABBAT_END) return 'בשבת אין לפתוח משרד לפני 19:00.';
 }
}
    // שישי: לא מתחילים/מסיימים אחרי 16:00
    if (this.isFriday(r.day_of_week)) {
      if (r.is_open) {
        if (r.farm_start && r.farm_start >= this.SHABBAT_START) return 'ביום ו׳ אין להתחיל פעילות מ-16:00 ומעלה.';
        if (r.farm_end && r.farm_end > this.SHABBAT_START) return 'ביום ו׳ חייבים לסיים עד 16:00.';
      }
      if (r.is_offical_open) {
        if (r.office_start && r.office_start >= this.SHABBAT_START) return 'ביום ו׳ אין לפתוח משרד מ-16:00 ומעלה.';
        if (r.office_end && r.office_end > this.SHABBAT_START) return 'ביום ו׳ משרד חייב להיסגר עד 16:00.';
      }
    }


    // ---- משרד ----
    if (r.is_offical_open) {
      if (!r.office_start || !r.office_end) {
        return `בשעות משרד: המשרד פתוח ולכן חובה למלא התחלה וסיום ביום ${day}.`;
      }
      if (r.office_end <= r.office_start) {
        return `בשעות משרד: שעת סיום חייבת להיות אחרי שעת התחלה ביום ${day}.`;
      }
    }

    return null;
  }

  // ✅ חדש: כשסוגרים חווה - ננקה שעות כדי שלא יישמרו "שעות ישנות"
onFarmOpenToggle(r: FarmWorkingHours): void {
  if (!r.is_open) {
    r.farm_start = null;
    r.farm_end = null;
  } else {
    const s = this.settings();
    r.farm_start = r.farm_start ?? (s?.operating_hours_start ?? '08:00');
    r.farm_end = r.farm_end ?? (s?.operating_hours_end ?? '20:00');
  }

  this.applyWorkingHoursRulesAndValidate();
}

onOfficeOpenToggle(r: FarmWorkingHours): void {
  if (!r.is_offical_open) {
    r.office_start = null;
    r.office_end = null;
  } else {
    const s = this.settings();
    r.office_start = r.office_start ?? (s?.office_hours_start ?? '08:30');
    r.office_end = r.office_end ?? (s?.office_hours_end ?? '16:00');
  }

  this.applyWorkingHoursRulesAndValidate();
}

onWorkingHoursTimeChanged(): void {
  this.applyWorkingHoursRulesAndValidate();
}

  /** יש לפחות יום אחד פתוח בחווה */
hasAnyFarmOpenDay(): boolean {
  return this.workingHours().some(r => !!r.is_open);
}

/** יש לפחות יום אחד פתוח במשרד */
hasAnyOfficeOpenDay(): boolean {
  return this.workingHours().some(r => !!r.is_offical_open);
}

/** יש מינימום הגיוני לשמירה: חווה + משרד */
canSaveWorkingHours(): boolean {
  return this.hasAnyFarmOpenDay() && this.hasAnyOfficeOpenDay() && !this.workingHoursError();
}

  async saveWorkingHours(): Promise<void> {
      if (!this.hasAnyFarmOpenDay() || !this.hasAnyOfficeOpenDay()) {
    const msg = !this.hasAnyFarmOpenDay()
      ? 'חובה לסמן לפחות יום אחד פתוח בחווה.'
      : 'חובה לסמן לפחות יום אחד פתוח במשרד.';
    await this.ui.alert(msg, 'שגיאה');
    this.error.set(msg);
    return;
  }
    const rows = this.workingHours().length ? this.workingHours() : this.buildEmptyWorkingHours();

    const err = this.validateAllWorkingHours();
    this.workingHoursError.set(err);
    if (err) {
      await this.ui.alert(err, 'שגיאה');
      this.error.set(err);
      return;
    }

    // ✅ חשוב: אם יום סגור -> נשמור NULL לשעות
    const payload = rows.map(r => ({
      id: r.id,
      day_of_week: r.day_of_week,

      is_open: !!r.is_open,
      farm_start: r.is_open ? this.timeToDb(r.farm_start) : null,
      farm_end: r.is_open ? this.timeToDb(r.farm_end) : null,

      is_offical_open: !!r.is_offical_open,
      office_start: r.is_offical_open ? this.timeToDb(r.office_start) : null,
      office_end: r.is_offical_open ? this.timeToDb(r.office_end) : null,
    }));

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase
        .from('farm_working_hours')
        .upsert(payload, { onConflict: 'day_of_week' });

      if (error) {
        console.error('saveWorkingHours error', error);
        await this.ui.alert('שמירת שעות לפי יום נכשלה.', 'שגיאה');
        this.error.set('שמירת שעות לפי יום נכשלה.');
        return;
      }

      this.flashSuccess('שעות לפי יום נשמרו בהצלחה.');
      await this.ui.alert('שעות לפי יום נשמרו בהצלחה.', 'הצלחה');

      await this.loadWorkingHours();
      this.onWorkingHoursChanged();

      const s = this.settings();
      if (s) {
        const openDays = rows.filter(x => x.is_open).map(x => x.day_of_week).sort((a, b) => a - b);
        this.settings.set({ ...s, working_days: openDays });
      }
    } finally {
      this.saving.set(false);
    }
  }

  // =============================
  // Special Days
  // =============================
  private validateSpecialDayDateRange(form: FarmDayOff): void {
    this.dateRangeError.set(null);
    if (!form.start_date || !form.end_date) return;
    if (form.end_date < form.start_date) {
      this.dateRangeError.set('״עד תאריך״ לא יכול להיות קטן מ־״מתאריך״.');
    }
  }

  patchSpecialDayForm(patch: Partial<FarmDayOff>): void {
  let next = { ...this.specialDayForm(), ...patch };
  next = this.applySpecialDayRules(next);   // ✅ כאן
  this.specialDayForm.set(next);
  this.validateSpecialDayDateRange(next);
}


  openSpecialDays(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.dateRangeError.set(null);

    this.specialDayForm.set({
      start_date: today,
      end_date: today,
      all_day: true,
      start_time: null,
      end_time: null,
      reason: '',
      is_active: true,
      recurrence: 'ONCE',
      notify_parents_before: false,
      notify_days_before: 1,

      calendar_kind: 'GREGORIAN',
      hebrew_day: null,
      hebrew_month: null,
      hebrew_end_day: null,
      hebrew_end_month: null,
    });

    this.showSpecialDaysModal.set(true);
  }

  closeSpecialDaysModal(): void {
    this.showSpecialDaysModal.set(false);
  }

 onToggleAllDay(value: boolean): void {
  const cur = this.specialDayForm();
  let next: FarmDayOff;

  if (value) {
    next = { ...cur, all_day: true, start_time: null, end_time: null };
  } else {
    const s = this.settings();
    next = {
      ...cur,
      all_day: false,
      start_time: cur.start_time ?? (s?.operating_hours_start ?? '08:00'),
      end_time: cur.end_time ?? (s?.operating_hours_end ?? '20:00'),
    };
  }

  next = this.applySpecialDayRules(next);   // ✅ כאן
  this.specialDayForm.set(next);
  
}


  private async loadFarmDaysOff(): Promise<void> {
    const { data, error } = await this.supabase
      .from('farm_days_off')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadFarmDaysOff error', error);
      this.error.set('לא ניתן לטעון ימי חופש');
      return;
    }

    const list: FarmDayOff[] = (data || []).map((r: any) => ({
      id: r.id,
      start_date: r.start_date ?? null,
      end_date: r.end_date ?? null,

      all_day: (r.day_type ?? 'FULL_DAY') === 'FULL_DAY',
      start_time: r.start_time ? String(r.start_time).slice(0, 5) : null,
      end_time: r.end_time ? String(r.end_time).slice(0, 5) : null,

      reason: r.reason ?? '',
      is_active: r.is_active ?? true,
      day_type: r.day_type as DayType,
      created_at: r.created_at,

      recurrence: (r.recurrence ?? 'ONCE') as RecurrenceKind,
      notify_parents_before: r.notify_parents_before ?? false,
      notify_days_before: r.notify_days_before ?? 1,

      calendar_kind: (r.calendar_kind ?? 'GREGORIAN') as CalendarKind,
      hebrew_day: r.hebrew_day ?? null,
      hebrew_month: r.hebrew_month ?? null,
      hebrew_end_day: r.hebrew_end_day ?? null,
      hebrew_end_month: r.hebrew_end_month ?? null,
    }));

    this.daysOff.set(list);
  }

  async saveSpecialDay(): Promise<void> {
    const f = this.specialDayForm();
    this.validateSpecialDayDateRange(f);
    if (this.dateRangeError()) {
      await this.ui.alert(this.dateRangeError()!, 'שגיאה');
      return;
    }

    if (!f.reason?.trim()) {
      await this.ui.alert('חובה למלא סיבה.', 'חסר שדה');
      return;
    }

    if (!f.start_date || !f.end_date) {
      await this.ui.alert('חובה למלא "מתאריך" ו-"עד תאריך".', 'חסר שדה');
      return;
    }

    if (!f.all_day) {
      if (!f.start_time || !f.end_time) {
        await this.ui.alert('כשזה לא "כל היום" חובה למלא שעות התחלה/סיום.', 'חסר שדה');
        return;
      }
      if (f.end_time <= f.start_time) {
        await this.ui.alert('שעת סיום חייבת להיות אחרי שעת התחלה.', 'שגיאה');
        return;
      }
      if (!f.all_day && f.start_date && f.end_date && f.start_date === f.end_date) {
  const dow = this.isoDow(f.start_date);

  if (dow === 6) { // יום 7
    if (f.start_time && f.start_time < this.DAY7_START) {
      await this.ui.alert('ביום 7 אי אפשר להתחיל לפני 19:00.', 'שגיאה');
      return;
    }
  }

  if (dow === 5) { // יום 6
    if (f.end_time && f.end_time > this.DAY6_CUTOFF) {
      await this.ui.alert('ביום 6 חייבים לסיים עד 16:00.', 'שגיאה');
      return;
    }
  }
}

    }

    const isHebrew = (f.calendar_kind ?? 'GREGORIAN') === 'HEBREW';

    if (isHebrew) {
      if (!f.hebrew_day || !f.hebrew_month) {
        await this.ui.alert('חובה לבחור תאריך עברי (חודש + יום).', 'חסר שדה');
        return;
      }
      this.syncHebrewToGregorianDates();
    }

    const payload: any = {
      reason: f.reason.trim(),
      is_active: true,

      recurrence: f.recurrence ?? 'ONCE',

      notify_parents_before: !!f.notify_parents_before,
      notify_days_before: f.notify_parents_before ? (f.notify_days_before ?? 1) : null,

      day_type: f.all_day ? 'FULL_DAY' : 'PARTIAL_DAY',
      start_time: f.all_day ? null : this.timeToDb(f.start_time),
      end_time: f.all_day ? null : this.timeToDb(f.end_time),

      start_date: this.specialDayForm().start_date,
      end_date: this.specialDayForm().end_date,

      calendar_kind: isHebrew ? 'HEBREW' : 'GREGORIAN',
      hebrew_day: isHebrew ? (this.specialDayForm().hebrew_day ?? null) : null,
      hebrew_month: isHebrew ? (this.specialDayForm().hebrew_month ?? null) : null,
      hebrew_end_day: isHebrew ? (this.specialDayForm().hebrew_end_day ?? this.specialDayForm().hebrew_day ?? null) : null,
      hebrew_end_month: isHebrew ? (this.specialDayForm().hebrew_end_month ?? this.specialDayForm().hebrew_month ?? null) : null,
    };

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase.from('farm_days_off').insert(payload);

      if (error) {
        console.error('saveSpecialDay error', error);
        await this.ui.alert('שמירת יום מיוחד נכשלה.', 'שגיאה');
        this.error.set('שמירת יום מיוחד נכשלה.');
        return;
      }

      this.success.set('יום מיוחד נשמר בהצלחה.');
      await this.ui.alert('יום מיוחד נשמר בהצלחה.', 'הצלחה');

      await this.loadFarmDaysOff();
      this.closeSpecialDaysModal();
    } finally {
      this.saving.set(false);
    }
  }

  async deactivateDayOff(day: FarmDayOff): Promise<void> {
    if (!day.id) return;

    const ok = await this.ui.confirm({
      title: 'ביטול יום מיוחד',
      message: 'לבטל (להפוך ללא פעיל) את היום המיוחד הזה?',
      okText: 'כן, לבטל',
      cancelText: 'ביטול',
      showCancel: true,
    });
    if (!ok) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase
        .from('farm_days_off')
        .update({ is_active: false })
        .eq('id', day.id);

      if (error) {
        console.error('deactivateDayOff error', error);
        await this.ui.alert('ביטול יום מיוחד נכשל.', 'שגיאה');
        this.error.set('ביטול יום מיוחד נכשל.');
        return;
      }

      await this.loadFarmDaysOff();
      await this.ui.alert('יום מיוחד בוטל.', 'הצלחה');
      this.success.set('יום מיוחד בוטל.');
    } finally {
      this.saving.set(false);
    }
  }

  // =============================
  // Farm Settings
  // =============================
  private async loadSettings(): Promise<void> {
    const { data, error } = await this.supabase
      .from('farm_settings')
      .select('*')
      .eq('id', this.SETTINGS_SINGLETON_ID)
      .maybeSingle();

    if (error) {
      console.error('load farm_settings error', error);
      this.error.set('לא ניתן לטעון את הגדרות החווה.');
      return;
    }

    if (data) {
      const s: FarmSettings = {
        ...data,

        operating_hours_start: this.t5(data.operating_hours_start) ?? '08:00',
        operating_hours_end: this.t5(data.operating_hours_end) ?? '20:00',

        office_hours_start: this.t5(data.office_hours_start) ?? '08:30',
        office_hours_end: this.t5(data.office_hours_end) ?? '16:00',

        min_time_between_cancellations: data.min_time_between_cancellations
          ? String(data.min_time_between_cancellations).slice(0, 5)
          : '00:00',

        quiet_hours_start: data.quiet_hours_start ? String(data.quiet_hours_start).slice(0, 5) : null,
        quiet_hours_end: data.quiet_hours_end ? String(data.quiet_hours_end).slice(0, 5) : null,

        working_days: (data.working_days ?? null) as any,
        timezone: data.timezone ?? 'Asia/Jerusalem',

        late_payment_grace_days: data.late_payment_grace_days ?? 0,
        notify_before_farm_closure: data.notify_before_farm_closure ?? false,
        notify_before_farm_closure_hours: data.notify_before_farm_closure_hours ?? 24,
        suggest_makeup_on_cancel: data.suggest_makeup_on_cancel ?? true,
        reminder_require_confirmation: data.reminder_require_confirmation ?? false,
        reminder_allow_cancel_link: data.reminder_allow_cancel_link ?? false,
      };

      this.settings.set(s);
      return;
    }

    this.settings.set({
      operating_hours_start: '08:00',
      operating_hours_end: '20:00',

      office_hours_start: '08:30',
      office_hours_end: '16:00',

      default_lessons_per_series: 12,
      lesson_duration_minutes: 60,
      default_lesson_price: 150,

      makeup_allowed_days_back: 30,
      makeup_allowed_days_ahead: 30,
      max_makeups_in_period: 8,
      makeups_period_days: 30,
      displayed_makeup_lessons_count: 3,
      min_time_between_cancellations: '12:00',

      cancel_before_hours: 24,
      late_cancel_policy: 'CHARGE_FULL',
      late_cancel_fee_amount: null,
      late_cancel_fee_percent: null,

      attendance_default: 'REQUIRE_MARKING',

      monthly_billing_day: 10,

      working_days: [1, 2, 3, 4, 5],
      timezone: 'Asia/Jerusalem',

      send_lesson_reminder: true,
      reminder_hours_before: 24,
      reminder_channel: 'APP',
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',

      enable_discounts: false,
      late_payment_fee: null,
      interest_percent_monthly: null,

      late_payment_grace_days: 7,

      notify_before_farm_closure: true,
      notify_before_farm_closure_hours: 24,

      suggest_makeup_on_cancel: true,
      reminder_require_confirmation: false,
      reminder_allow_cancel_link: true,

      registration_fee: null,
      student_insurance_premiums: null,

      max_group_size: 6,
      max_lessons_per_week_per_child: 2,
      allow_online_booking: true,
    });
  }

  async saveSettings(): Promise<void> {
    const current = this.settings();
    if (!current) return;

    if (!this.validateOfficeHours()) {
      await this.ui.alert('יש שגיאה בשעות פעילות המשרד.', 'שגיאה');
      this.error.set('לא ניתן לשמור: יש שגיאה בשעות פעילות המשרד.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);

    const payload: any = {
      ...current,
      updated_at: new Date().toISOString(),
      id: current.id ?? this.SETTINGS_SINGLETON_ID,
    };

    payload.operating_hours_start = this.timeToDb(payload.operating_hours_start);
    payload.operating_hours_end = this.timeToDb(payload.operating_hours_end);
    payload.office_hours_start = this.timeToDb(payload.office_hours_start);
    payload.office_hours_end = this.timeToDb(payload.office_hours_end);
    payload.min_time_between_cancellations = this.timeToDb(payload.min_time_between_cancellations);
    payload.quiet_hours_start = this.timeToDb(payload.quiet_hours_start);
    payload.quiet_hours_end = this.timeToDb(payload.quiet_hours_end);

    const { data, error } = await this.supabase
      .from('farm_settings')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('save farm_settings error', error);
      await this.ui.alert('שמירת ההגדרות נכשלה. נסה/י שוב.', 'שגיאה');
      this.error.set('שמירת ההגדרות נכשלה. נסה/י שוב.');
      this.saving.set(false);
      return;
    }

    const s: FarmSettings = {
      ...data,
      operating_hours_start: this.t5(data.operating_hours_start),
      operating_hours_end: this.t5(data.operating_hours_end),
      office_hours_start: this.t5(data.office_hours_start),
      office_hours_end: this.t5(data.office_hours_end),
      min_time_between_cancellations: data.min_time_between_cancellations ? String(data.min_time_between_cancellations).slice(0, 5) : null,
      quiet_hours_start: data.quiet_hours_start ? String(data.quiet_hours_start).slice(0, 5) : null,
      quiet_hours_end: data.quiet_hours_end ? String(data.quiet_hours_end).slice(0, 5) : null,
    };

    this.settings.set(s);
    this.success.set('ההגדרות נשמרו בהצלחה.');
    await this.ui.alert('ההגדרות נשמרו בהצלחה.', 'הצלחה');

    this.saving.set(false);
  }

  private validateOfficeHours(): boolean {
    const s = this.settings();
    if (!s) return true;

    const start = s.office_hours_start;
    const end = s.office_hours_end;

    if (!start || !end) return true;
    return end > start;
  }

  // =============================
  // Funding Sources
  // =============================
  private async loadFundingSources(): Promise<void> {
    const { data, error } = await this.supabase
      .from('funding_sources')
      .select('*')
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      console.error('load funding_sources error', error);
      this.error.set('לא ניתן לטעון את גורמי המימון.');
      return;
    }

    this.fundingSources.set((data || []) as FundingSource[]);
  }

  toggleNewFundingForm(): void {
    this.showNewFundingForm.set(!this.showNewFundingForm());
  }

  startEditFunding(fs: FundingSource): void {
    if (fs.is_system) return;
    this.editingFundingId.set(fs.id);
  }

  cancelEditFunding(): void {
    this.editingFundingId.set(null);
    this.loadFundingSources();
  }

  async addFundingSource(): Promise<void> {
    const name = this.newFundingSourceName().trim();
    if (!name) return;

    const { data, error } = await this.supabase
      .from('funding_sources')
      .insert({ name })
      .select()
      .single();

    if (error) {
      console.error('add funding_source error', error);
      this.error.set('לא ניתן להוסיף גורם מימון חדש.');
      return;
    }

    this.fundingSources.set([...this.fundingSources(), data as FundingSource]);
    this.newFundingSourceName.set('');
    this.showNewFundingForm.set(false);
  }

  async updateFundingSource(fs: FundingSource): Promise<void> {
    if (fs.is_system) return;

    const { data, error } = await this.supabase
      .from('funding_sources')
      .update({ name: fs.name, is_active: fs.is_active })
      .eq('id', fs.id)
      .select()
      .single();

    if (error) {
      console.error('update funding_source error', error);
      this.error.set('עדכון גורם מימון נכשל.');
      return;
    }

    this.fundingSources.set(this.fundingSources().map(f => (f.id === fs.id ? (data as FundingSource) : f)));
    this.editingFundingId.set(null);
  }

  async deleteFundingSource(fs: FundingSource): Promise<void> {
    if (fs.is_system) {
      await this.ui.alert('אי אפשר למחוק גורם מימון מערכת.', 'שגיאה');
      return;
    }

    const confirmed = await this.ui.confirm({
      title: 'מחיקת גורם מימון',
      message: `למחוק את גורם המימון "${fs.name}"?`,
      okText: 'כן, למחוק',
      cancelText: 'ביטול',
      showCancel: true,
    });
    if (!confirmed) return;

    const { error } = await this.supabase.from('funding_sources').delete().eq('id', fs.id);

    if (error) {
      console.error('delete funding_source error', error);
      this.error.set('מחיקת גורם המימון נכשלה.');
      await this.ui.alert('מחיקת גורם המימון נכשלה.', 'שגיאה');
      return;
    }

    this.fundingSources.set(this.fundingSources().filter(f => f.id !== fs.id));
    await this.ui.alert('גורם המימון נמחק.', 'הצלחה');
  }

  // =============================
  // Payment Plans
  // =============================
  private async loadPaymentPlans(): Promise<void> {
    const { data, error } = await this.supabase
      .from('payment_plans')
      .select(`
        *,
        payment_plan_prices (
          id,
          valid_from,
          lesson_price,
          subsidy_amount,
          customer_amount
        )
      `)
      .order('name', { ascending: true });

    if (error) {
      console.error('load payment_plans error', error);
      this.error.set('לא ניתן לטעון מסלולי תשלום.');
      return;
    }

    const plans: PaymentPlan[] = (data || []).map((p: any) => ({
      ...p,
      required_docs: p.required_docs || [],
      require_docs_at_booking: p.require_docs_at_booking ?? true,
      versions: (p.payment_plan_prices || []) as PaymentPlanPriceVersion[],
    }));

    this.paymentPlans.set(plans);
  }

  toggleNewPlanForm(): void {
    this.showNewPlanForm.set(!this.showNewPlanForm());
  }

  startEditPlan(plan: PaymentPlan): void {
    if (!plan.id) return;
    this.editingPlanId.set(plan.id);
  }

  cancelEditPlan(): void {
    this.editingPlanId.set(null);
    this.loadPaymentPlans();
  }

  onDocsTextChange(plan: PaymentPlan, value: string): void {
    plan.required_docs = value.split('\n').map(v => v.trim()).filter(Boolean);
  }

  onNewPlanDocsChange(value: string): void {
    this.newPlan.required_docs = value.split('\n').map(v => v.trim()).filter(Boolean);
  }

  private normalizePlanForSave(plan: PaymentPlan): any {
    return {
      name: plan.name,
      lesson_price: plan.lesson_price ?? 0,
      subsidy_amount: plan.subsidy_amount ?? 0,
      funding_source_id: plan.funding_source_id,
      required_docs: plan.required_docs || [],
      require_docs_at_booking: plan.require_docs_at_booking ?? true,
      is_active: plan.is_active ?? true,
    };
  }

  async addPaymentPlan(): Promise<void> {
    const p = this.newPlan;
    if (!p.name || p.lesson_price == null) {
      await this.ui.alert('חובה למלא שם מסלול ומחיר לשיעור.', 'חסר שדה');
      return;
    }

    const payload = this.normalizePlanForSave(p);

    const { error } = await this.supabase.from('payment_plans').insert(payload);

    if (error) {
      console.error('add payment_plan error', error);
      this.error.set('לא ניתן להוסיף מסלול תשלום.');
      await this.ui.alert('לא ניתן להוסיף מסלול תשלום.', 'שגיאה');
      return;
    }

    await this.loadPaymentPlans();
    this.newPlan = {
      name: '',
      lesson_price: null,
      subsidy_amount: 0,
      funding_source_id: null,
      required_docs: [],
      require_docs_at_booking: true,
      is_active: true,
    };
    this.showNewPlanForm.set(false);

    await this.ui.alert('מסלול התשלום נוסף.', 'הצלחה');
  }

  async updatePaymentPlan(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const payload = this.normalizePlanForSave(plan);

    const { error } = await this.supabase
      .from('payment_plans')
      .update(payload)
      .eq('id', plan.id);

    if (error) {
      console.error('update payment_plan error', error);
      this.error.set('עדכון מסלול תשלום נכשל.');
      await this.ui.alert('עדכון מסלול תשלום נכשל.', 'שגיאה');
      return;
    }

    this.editingPlanId.set(null);
    await this.loadPaymentPlans();
    await this.ui.alert('מסלול התשלום עודכן.', 'הצלחה');
  }

  async deletePaymentPlan(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const confirmed = await this.ui.confirm({
      title: 'מחיקת מסלול תשלום',
      message: `למחוק את מסלול התשלום "${plan.name}"?`,
      okText: 'כן, למחוק',
      cancelText: 'ביטול',
      showCancel: true,
    });
    if (!confirmed) return;

    const { error } = await this.supabase.from('payment_plans').delete().eq('id', plan.id);

    if (error) {
      console.error('delete payment_plan error', error);
      this.error.set('מחיקת מסלול התשלום נכשלה.');
      await this.ui.alert('מחיקת מסלול התשלום נכשלה.', 'שגיאה');
      return;
    }

    await this.loadPaymentPlans();
    await this.ui.alert('מסלול התשלום נמחק.', 'הצלחה');
  }

  getCustomerAmount(plan: PaymentPlan): number {
    const lp = plan.lesson_price ?? 0;
    const sub = plan.subsidy_amount ?? 0;
    return Math.max(0, lp - sub);
  }

  getFundingName(id: UUID | null): string {
    if (!id) return 'ללא גורם מימון';
    const fs = this.fundingSources().find(f => f.id === id);
    return fs ? fs.name : 'ללא גורם מימון';
  }

  getDocsText(plan: PaymentPlan): string {
    return (plan.required_docs || []).join('\n');
  }

  async savePlanPriceVersion(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const date = plan.newVersionDate;
    const price = plan.newVersionPrice;
    const subsidy = plan.newVersionSubsidy ?? 0;

    if (!date) {
      await this.ui.alert('חובה לבחור תאריך תחולה לשינוי המחיר.', 'חסר שדה');
      return;
    }
    if (price == null) {
      await this.ui.alert('חובה למלא מחיר חדש לשיעור.', 'חסר שדה');
      return;
    }

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase.rpc('create_payment_plan_price_version', {
        p_plan_id: plan.id,
        p_valid_from: date,
        p_lesson_price: price,
        p_subsidy_amount: subsidy,
      });

      if (error) {
        console.error('savePlanPriceVersion error', error);
        this.error.set('שמירת שינוי המחיר נכשלה. נסה/י שוב.');
        await this.ui.alert('שמירת שינוי המחיר נכשלה. נסה/י שוב.', 'שגיאה');
        return;
      }

      this.success.set('שינוי המחיר נשמר ונוספה היסטוריה חדשה.');
      await this.ui.alert('שינוי המחיר נשמר ונוספה היסטוריה חדשה.', 'הצלחה');

      await this.loadPaymentPlans();
      this.editingPlanId.set(null);
    } finally {
      this.saving.set(false);
    }
  }

  // =============================
  // Unlimited toggles
  // =============================
  isUnlimitedLessonsPerWeek(): boolean {
    const s = this.settings();
    return !s || s.max_lessons_per_week_per_child == null;
  }

  setUnlimitedLessonsPerWeek(checked: boolean): void {
    const s = this.settings();
    if (!s) return;

    this.settings.set({
      ...s,
      max_lessons_per_week_per_child: checked ? null : (s.max_lessons_per_week_per_child ?? 2),
    });
  }

  isUnlimitedDefaultLessonsPerSeries(): boolean {
    const s = this.settings();
    return !s || s.default_lessons_per_series == null;
  }

  setUnlimitedDefaultLessonsPerSeries(checked: boolean): void {
    const s = this.settings();
    if (!s) return;

    this.settings.set({
      ...s,
      default_lessons_per_series: checked ? null : (s.default_lessons_per_series ?? 12),
    });
  }

// =============================
// Structured Notes (list_notes)
// =============================
async loadListNotes(): Promise<void> {
  try {
    const { data, error } = await this.supabase
      .schema('moacha_atarim_app')
      .from('list_notes')
      .select('id, note')
      .order('id', { ascending: true });

    if (error) {
      console.error('loadListNotes error', error);
      this.error.set('לא ניתן לטעון הערות מובנות.');
      return;
    }

    this.listNotes.set((data ?? []) as ListNote[]);
  } catch (e) {
    console.error('loadListNotes exception', e);
    this.error.set('לא ניתן לטעון הערות מובנות.');
  }
}

toggleNewListNoteForm(): void {
  const next = !this.showNewListNoteForm();
  this.showNewListNoteForm.set(next);
  if (!next) this.newListNoteText.set('');
}

startEditListNote(n: ListNote): void {
  this.editingListNoteId.set(n.id);
}

cancelEditListNote(): void {
  this.editingListNoteId.set(null);
  this.loadListNotes();
}

async addListNote(): Promise<void> {
  const note = this.newListNoteText().trim();
  if (!note) {
    await this.ui.alert('חובה לכתוב הודעה.', 'חסר שדה');
    return;
  }
  if (note.length > 250) {
    await this.ui.alert('אורך ההודעה מוגבל ל־250 תווים.', 'שגיאה');
    return;
  }

  try {
    const { data, error } = await this.supabase
      .schema('moacha_atarim_app')
      .from('list_notes')
      .insert({ note })
      .select('id, note')
      .single();

    if (error) {
      console.error('addListNote error', error);
      await this.ui.alert('הוספת הודעה נכשלה.', 'שגיאה');
      return;
    }

    this.listNotes.set([...this.listNotes(), data as ListNote]);
    this.newListNoteText.set('');
    this.showNewListNoteForm.set(false);
  } catch (e) {
    console.error('addListNote exception', e);
    await this.ui.alert('הוספת הודעה נכשלה.', 'שגיאה');
  }
}

async updateListNote(n: ListNote): Promise<void> {
  const note = (n.note ?? '').trim();
  if (!note) {
    await this.ui.alert('הודעה לא יכולה להיות ריקה.', 'שגיאה');
    return;
  }
  if (note.length > 250) {
    await this.ui.alert('אורך ההודעה מוגבל ל־250 תווים.', 'שגיאה');
    return;
  }

  try {
    const { data, error } = await this.supabase
      .schema('moacha_atarim_app')
      .from('list_notes')
      .update({ note })
      .eq('id', n.id)
      .select('id, note')
      .single();

    if (error) {
      console.error('updateListNote error', error);
      await this.ui.alert('עדכון הודעה נכשל.', 'שגיאה');
      return;
    }

    this.listNotes.set(this.listNotes().map(x => (x.id === n.id ? (data as ListNote) : x)));
    this.editingListNoteId.set(null);
    await this.ui.alert('ההודעה עודכנה.', 'הצלחה');
  } catch (e) {
    console.error('updateListNote exception', e);
    await this.ui.alert('עדכון הודעה נכשל.', 'שגיאה');
  }
}

async deleteListNote(n: ListNote): Promise<void> {
  const ok = await this.ui.confirm({
    title: 'מחיקת הודעה מובנית',
    message: `למחוק את ההודעה הזו?\n\n"${n.note}"`,
    okText: 'כן, למחוק',
    cancelText: 'ביטול',
    showCancel: true,
  });
  if (!ok) return;

  try {
    const { error } = await this.supabase
      .schema('moacha_atarim_app')
      .from('list_notes')
      .delete()
      .eq('id', n.id);

    if (error) {
      console.error('deleteListNote error', error);
      await this.ui.alert('מחיקת הודעה נכשלה.', 'שגיאה');
      return;
    }

    this.listNotes.set(this.listNotes().filter(x => x.id !== n.id));

    // אם מחקת את ההודעה שאת עורכת כרגע — תצאי ממצב עריכה
    if (this.editingListNoteId() === n.id) {
      this.editingListNoteId.set(null);
    }

    await this.ui.alert('ההודעה נמחקה.', 'הצלחה');
  } catch (e) {
    console.error('deleteListNote exception', e);
    await this.ui.alert('מחיקת הודעה נכשלה.', 'שגיאה');
  }
}

paymentPlansExpanded = signal(true);
fundingSourcesExpanded = signal(true);

togglePaymentPlansExpanded() {
  this.paymentPlansExpanded.update(v => !v);
  if (!this.paymentPlansExpanded()) this.showNewPlanForm.set(false);
}

toggleFundingSourcesExpanded() {
  this.fundingSourcesExpanded.update(v => !v);
  if (!this.fundingSourcesExpanded()) this.showNewFundingForm.set(false);
}

}


// src/app/pages/farm-settings/farm-settings.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { HDate } from '@hebcal/core';


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
  time_slot_minutes: number | null;
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

  // לועזי
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

  // NEW: סוג לוח + שדות עבריים
  calendar_kind?: CalendarKind;

  hebrew_day?: number | null;        // 1..30
  hebrew_month?: number | null;      // 1..13 (לפי Hebcal)
  hebrew_end_day?: number | null;
  hebrew_end_month?: number | null;

  notify_parents_before?: boolean;
  notify_days_before?: number | null;
}


interface FarmWorkingHours {
  id?: UUID;
  day_of_week: number; // 1..7
  is_open: boolean;

  farm_start: string | null;   // "HH:MM"
  farm_end: string | null;

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
  private supabase = dbTenant();

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

private toIsoDate(d: Date): string {
  // yyyy-mm-dd
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

  // ניסיון לשנה העברית הנוכחית:
  let g = new HDate(heDay, heMonth, hy).greg();
  // אם כבר עבר - נזוז לשנה הבאה
  if (g < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    hy += 1;
    g = new HDate(heDay, heMonth, hy).greg();
  }
  return this.toIsoDate(g);
}

/** כשעוברים למצב עברי / משנים יום-חודש עברי -> מסנכרנים start_date/end_date לתצוגה + שמירה */
syncHebrewToGregorianDates(): void {
  const f = this.specialDayForm();
  if (f.calendar_kind !== 'HEBREW') return;

  const sd = f.hebrew_day ?? null;
  const sm = f.hebrew_month ?? null;
  const ed = f.hebrew_end_day ?? sd;
  const em = f.hebrew_end_month ?? sm;

  if (!sd || !sm) return;

  const start = this.nextGregorianFromHebrew(sd, sm);
  const end = (ed && em) ? this.nextGregorianFromHebrew(ed, em) : start;

  this.specialDayForm.set({
    ...f,
    start_date: start,
    end_date: end,
    hebrew_end_day: ed,
    hebrew_end_month: em,
  });

  this.validateSpecialDayDateRange(this.specialDayForm());
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

  // kind === 'HEBREW'
  const todayIso = new Date().toISOString().slice(0, 10);
  this.specialDayForm.set({
    ...f,
    calendar_kind: 'HEBREW',
    recurrence: f.recurrence ?? 'YEARLY', // טבעי לעברי
    start_date: f.start_date || todayIso,
    end_date: f.end_date || todayIso,
    hebrew_day: f.hebrew_day ?? 10,
    hebrew_month: f.hebrew_month ?? 7, // ברירת מחדל תשרי
    hebrew_end_day: f.hebrew_end_day ?? f.hebrew_day ?? 10,
    hebrew_end_month: f.hebrew_end_month ?? f.hebrew_month ?? 7,
  });

  this.syncHebrewToGregorianDates();
}


  // ====== ימים מיוחדים (לועזי בלבד) ======
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
  });

  dateRangeError = signal<string | null>(null);

  // ====== שעות לפי יום ======
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
      ]);

      // אם אין שום רשומות – נבנה 7 ימים כדי שהמסך לא ייראה "ריק"
      if (!this.workingHours().length) {
        this.workingHours.set(this.buildEmptyWorkingHours());
      }

      this.onWorkingHoursChanged();
    } catch (e) {
      console.error(e);
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
      // לא נכשיל את כל העמוד
      return;
    }

    const list: FarmWorkingHours[] = (data || []).map((r: any) => ({
      id: r.id,
      day_of_week: r.day_of_week,
      is_open: r.is_open ?? true,
      farm_start: this.t5(r.farm_start),
      farm_end: this.t5(r.farm_end),
      office_start: this.t5(r.office_start),
      office_end: this.t5(r.office_end),
    }));

    this.workingHours.set(list);
  }

  private buildEmptyWorkingHours(): FarmWorkingHours[] {
    const s = this.settings();
    const defFarmStart = s?.operating_hours_start ?? '08:00';
    const defFarmEnd = s?.operating_hours_end ?? '20:00';

    // משרד: נעדיף ריק כדי לא לחייב
    const defOfficeStart = s?.office_hours_start ?? null;
    const defOfficeEnd = s?.office_hours_end ?? null;

    const arr: FarmWorkingHours[] = [];
    for (let d = 1; d <= 7; d++) {
      arr.push({
        day_of_week: d,
        is_open: true,
        farm_start: defFarmStart,
        farm_end: defFarmEnd,
        office_start: defOfficeStart,
        office_end: defOfficeEnd,
      });
    }
    return arr;
  }

  onWorkingHoursChanged(): void {
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

  private validateWorkingHoursRow(r: FarmWorkingHours): string | null {
    if (!r.is_open) return null;

    const day = this.getHebDayLabel(r.day_of_week);

    // חווה: חייבים שניהם
    if (!r.farm_start || !r.farm_end) {
      return `חסר טווח שעות חווה ליום ${day}.`;
    }
    if (r.farm_end <= r.farm_start) {
      return `בשעות חווה: שעת סיום חייבת להיות אחרי שעת התחלה ביום ${day}.`;
    }

    // משרד: אם אחד מלא -> שניהם חובה
    const hasOfficeAny = !!r.office_start || !!r.office_end;
    if (hasOfficeAny && (!r.office_start || !r.office_end)) {
      return `בשעות משרד: אם מילאת התחלה/סיום – חייבים למלא את שניהם ביום ${day}.`;
    }

    // משרד: התחלה לפני סיום
    if (r.office_start && r.office_end && r.office_end <= r.office_start) {
      return `בשעות משרד: שעת סיום חייבת להיות אחרי שעת התחלה ביום ${day}.`;
    }

    // משרד בתוך חווה
    if (r.office_start && r.office_end) {
      if (r.office_start < r.farm_start || r.office_end > r.farm_end) {
        return `בשעות משרד: טווח המשרד חייב להיות בתוך טווח החווה ביום ${day}.`;
      }
    }

    return null;
  }

  async saveWorkingHours(): Promise<void> {
    const rows = this.workingHours().length ? this.workingHours() : this.buildEmptyWorkingHours();

    // ולידציה
    const err = this.validateAllWorkingHours();
    this.workingHoursError.set(err);
    if (err) {
      this.error.set(err);
      return;
    }

    const payload = rows.map(r => ({
      id: r.id,
      day_of_week: r.day_of_week,
      is_open: !!r.is_open,
      farm_start: this.timeToDb(r.farm_start),
      farm_end: this.timeToDb(r.farm_end),
      office_start: this.timeToDb(r.office_start),
      office_end: this.timeToDb(r.office_end),
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
        this.error.set('שמירת שעות לפי יום נכשלה.');
        return;
      }

      this.success.set('שעות לפי יום נשמרו בהצלחה.');
      await this.loadWorkingHours();
      this.onWorkingHoursChanged();

      // אופציונלי: סנכרון working_days לפי is_open
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
  // Special Days (days off) - לועזי בלבד
  // =============================
  private validateSpecialDayDateRange(form: FarmDayOff): void {
    this.dateRangeError.set(null);
    if (!form.start_date || !form.end_date) return;

    // YYYY-MM-DD => השוואה כמחרוזת
    if (form.end_date < form.start_date) {
      this.dateRangeError.set('״עד תאריך״ לא יכול להיות קטן מ־״מתאריך״.');
    }
  }

  patchSpecialDayForm(patch: Partial<FarmDayOff>): void {
    const next = { ...this.specialDayForm(), ...patch };
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
    if (value) {
      this.specialDayForm.set({ ...cur, all_day: true, start_time: null, end_time: null });
    } else {
      const s = this.settings();
      this.specialDayForm.set({
        ...cur,
        all_day: false,
        start_time: cur.start_time ?? (s?.operating_hours_start ?? '08:00'),
        end_time: cur.end_time ?? (s?.operating_hours_end ?? '20:00'),
      });
    }
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
    }));

    this.daysOff.set(list);
  }

  async saveSpecialDay(): Promise<void> {
    const f = this.specialDayForm();
    this.validateSpecialDayDateRange(f);
    if (this.dateRangeError()) return;

    if (!f.reason?.trim()) {
      alert('חובה למלא סיבה.');
      return;
    }

    if (!f.start_date || !f.end_date) {
      alert('חובה למלא "מתאריך" ו-"עד תאריך".');
      return;
    }

    if (!f.all_day) {
      if (!f.start_time || !f.end_time) {
        alert('כשזה לא "כל היום" חובה למלא שעות התחלה/סיום.');
        return;
      }
      if (f.end_time <= f.start_time) {
        alert('שעת סיום חייבת להיות אחרי שעת התחלה.');
        return;
      }
    }

    const isHebrew = (f.calendar_kind ?? 'GREGORIAN') === 'HEBREW';

// אם עברי – ודאי שיש יום+חודש והמרה ללועזי קיימת
if (isHebrew) {
  if (!f.hebrew_day || !f.hebrew_month) {
    alert('חובה לבחור תאריך עברי (חודש + יום).');
    return;
  }
  // מסנכרנים שוב ליתר ביטחון
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

      start_date: f.start_date,
      end_date: f.end_date,

      calendar_kind: isHebrew ? 'HEBREW' : 'GREGORIAN',

hebrew_day: isHebrew ? (f.hebrew_day ?? null) : null,
hebrew_month: isHebrew ? (f.hebrew_month ?? null) : null,
hebrew_end_day: isHebrew ? (f.hebrew_end_day ?? f.hebrew_day ?? null) : null,
hebrew_end_month: isHebrew ? (f.hebrew_end_month ?? f.hebrew_month ?? null) : null,

    };

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase.from('farm_days_off').insert(payload);

      if (error) {
        console.error('saveSpecialDay error', error);
        this.error.set('שמירת יום מיוחד נכשלה.');
        return;
      }

      this.success.set('יום מיוחד נשמר בהצלחה.');
      await this.loadFarmDaysOff();
      this.closeSpecialDaysModal();
    } finally {
      this.saving.set(false);
    }
  }

  async deactivateDayOff(day: FarmDayOff): Promise<void> {
    if (!day.id) return;

    const ok = confirm('לבטל (להפוך ללא פעיל) את היום המיוחד הזה?');
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
        this.error.set('ביטול יום מיוחד נכשל.');
        return;
      }

      await this.loadFarmDaysOff();
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
        time_slot_minutes: data.time_slot_minutes ?? 15,

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

    // Defaults when no row exists
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
      time_slot_minutes: 15,
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

    // ולידציה בסיסית: שעות משרד הגיוניות (אם יש)
    if (!this.validateOfficeHours()) {
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

    // normalize time fields to HH:MM:SS
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
      this.error.set('שמירת ההגדרות נכשלה. נסי שוב.');
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
      alert('אי אפשר למחוק גורם מימון מערכת.');
      return;
    }

    const confirmed = confirm(`למחוק את גורם המימון "${fs.name}"?`);
    if (!confirmed) return;

    const { error } = await this.supabase.from('funding_sources').delete().eq('id', fs.id);

    if (error) {
      console.error('delete funding_source error', error);
      this.error.set('מחיקת גורם המימון נכשלה.');
      return;
    }

    this.fundingSources.set(this.fundingSources().filter(f => f.id !== fs.id));
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
      alert('חובה למלא שם מסלול ומחיר לשיעור.');
      return;
    }

    const payload = this.normalizePlanForSave(p);

    const { data, error } = await this.supabase
      .from('payment_plans')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('add payment_plan error', error);
      this.error.set('לא ניתן להוסיף מסלול תשלום.');
      return;
    }

    await this.loadPaymentPlans(); // כדי לקבל גם versions נכונים
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
      return;
    }

    this.editingPlanId.set(null);
    await this.loadPaymentPlans();
  }

  async deletePaymentPlan(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const confirmed = confirm(`למחוק את מסלול התשלום "${plan.name}"?`);
    if (!confirmed) return;

    const { error } = await this.supabase.from('payment_plans').delete().eq('id', plan.id);

    if (error) {
      console.error('delete payment_plan error', error);
      this.error.set('מחיקת מסלול התשלום נכשלה.');
      return;
    }

    await this.loadPaymentPlans();
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
      alert('חובה לבחור תאריך תחולה לשינוי המחיר.');
      return;
    }
    if (price == null) {
      alert('חובה למלא מחיר חדש לשיעור.');
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
        this.error.set('שמירת שינוי המחיר נכשלה. נסי שוב.');
        return;
      }

      this.success.set('שינוי המחיר נשמר ונוספה היסטוריה חדשה.');
      await this.loadPaymentPlans();

      // סוגרים עריכה
      this.editingPlanId.set(null);
    } finally {
      this.saving.set(false);
    }
  }

  // =============================
  // Unlimited lessons per week
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

    // =============================
  // Unlimited default lessons per series
  // =============================
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
}

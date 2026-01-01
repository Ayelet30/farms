// src/app/pages/farm-settings/farm-settings.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';

type UUID = string;

interface FarmSettings {
  id?: UUID;

  operating_hours_start: string | null;
  operating_hours_end: string | null;

  lessons_count: number | null;
  lesson_duration_minutes: number | null;
  default_lesson_price: number | null;

  makeup_allowed_days_back: number | null;
  max_makeups_in_period: number | null;
  makeups_period_days: number | null;
  displayed_makeup_lessons_count: number | null;
  min_time_between_cancellations: string | null;

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

  newVersionDate?: string | null;
  newVersionPrice?: number | null;
  newVersionSubsidy?: number | null;

  versions?: PaymentPlanPriceVersion[];
}

interface PaymentPlanPriceVersion {
  id: UUID;
  valid_from: string;
  lesson_price: number;
  subsidy_amount: number;
  customer_amount: number;
}

type DayType = 'FULL_DAY' | 'PARTIAL_DAY';

interface FarmDayOff {
  id?: UUID;
  start_date: string;
  end_date: string;
  all_day: boolean;          // UI
  start_time: string | null; // HH:MM
  end_time: string | null;   // HH:MM
  reason: string;
  is_active: boolean;
  created_at?: string;
  day_type?: DayType;        // DB
}

@Component({
  selector: 'app-farm-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './farm-settings.component.html',
  styleUrls: ['./farm-settings.component.scss'],
})
export class FarmSettingsComponent implements OnInit {
  private supabase = dbTenant();

  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  settings = signal<FarmSettings | null>(null);

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
  };

  // ====== ימים מיוחדים / ימי חופש ======
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
  });
  // === ולידציות לימים מיוחדים (UI) ===
dateRangeError = signal<string | null>(null);
specialDaysTouched = signal(false);

private validateSpecialDayDateRange(form: FarmDayOff): void {
  // איפוס
  this.dateRangeError.set(null);

  if (!form.start_date || !form.end_date) return;

  // YYYY-MM-DD => אפשר להשוות מחרוזות (אותו פורמט)
  if (form.end_date < form.start_date) {
    this.dateRangeError.set('״עד תאריך״ לא יכול להיות קטן מ־״מתאריך״.');
  }
}

// עדכון הפונקציה הקיימת שלך:
patchSpecialDayForm(patch: Partial<FarmDayOff>): void {
  const next = { ...this.specialDayForm(), ...patch };
  this.specialDayForm.set(next);

  // ברגע שמשנים תאריכים - נחשב ולידציה
  this.validateSpecialDayDateRange(next);
}

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
      ]);
    } catch (e) {
      console.error(e);
      this.error.set('שגיאה בטעינת הנתונים.');
    } finally {
      this.loading.set(false);
    }
  }

  // ================= ימים מיוחדים =================

openSpecialDays(): void {
  const today = new Date().toISOString().slice(0, 10);

  this.specialDaysTouched.set(false);
  this.dateRangeError.set(null);

  this.specialDayForm.set({
    start_date: today,
    end_date: today,
    all_day: true,
    start_time: null,
    end_time: null,
    reason: '',
    is_active: true,
  });

  this.showSpecialDaysModal.set(true);
}


  closeSpecialDaysModal(): void {
    this.showSpecialDaysModal.set(false);
  }


  onToggleAllDay(value: boolean): void {
    const cur = this.specialDayForm();
    if (value) {
      this.specialDayForm.set({
        ...cur,
        all_day: true,
        start_time: null,
        end_time: null,
      });
    } else {
      this.specialDayForm.set({
        ...cur,
        all_day: false,
        start_time: cur.start_time ?? (this.settings()?.operating_hours_start ?? '08:00'),
        end_time: cur.end_time ?? (this.settings()?.operating_hours_end ?? '20:00'),
      });
    }
  }

  private async loadFarmDaysOff(): Promise<void> {
    const { data, error } = await this.supabase
      .from('farm_days_off')
      .select('*')
      .eq('is_active', true)
      .order('start_date', { ascending: false });

    if (error) {
      console.error('loadFarmDaysOff error', error);
      this.error.set('לא ניתן לטעון ימי חופש');
      return;
    }

    const list: FarmDayOff[] = (data || []).map((r: any) => ({
      id: r.id,
      start_date: r.start_date,
      end_date: r.end_date,
      all_day: r.day_type === 'FULL_DAY',
      start_time: r.start_time ? r.start_time.slice(0, 5) : null,
      end_time: r.end_time ? r.end_time.slice(0, 5) : null,
      reason: r.reason ?? '',
      is_active: r.is_active ?? true,
      day_type: r.day_type as DayType,
      created_at: r.created_at,
    }));

    this.daysOff.set(list);
  }

  async saveSpecialDay(): Promise<void> {
   const f = this.specialDayForm();

    this.specialDaysTouched.set(true);
    this.validateSpecialDayDateRange(f);

    if (this.dateRangeError()) {
    return;
   }

    

    if (!f.start_date || !f.end_date) {
      alert('חובה למלא "מתאריך" ו-"עד תאריך".');
      return;
    }
    if (!f.reason?.trim()) {
      alert('חובה למלא סיבה.');
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

    const payload: any = {
      start_date: f.start_date,
      end_date: f.end_date,
      day_type: f.all_day ? 'FULL_DAY' : 'PARTIAL_DAY',
      start_time: f.all_day ? null : (f.start_time?.length === 5 ? f.start_time + ':00' : f.start_time),
      end_time: f.all_day ? null : (f.end_time?.length === 5 ? f.end_time + ':00' : f.end_time),
      reason: f.reason.trim(),
      is_active: true,
    };

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);

      const { error } = await this.supabase.from('farm_days_off9').insert(payload);

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
        .from('farm_days_off9')
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

  // ================= הגדרות חווה =================

  private async loadSettings(): Promise<void> {
    const { data, error } = await this.supabase
      .from('farm_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('load farm_settings error', error);
      this.error.set('לא ניתן לטעון את הגדרות החווה.');
      return;
    }

    if (data) {
      const s: FarmSettings = {
        ...data,
        operating_hours_start: data.operating_hours_start?.slice(0, 5) ?? '08:00',
        operating_hours_end: data.operating_hours_end?.slice(0, 5) ?? '20:00',
        min_time_between_cancellations: data.min_time_between_cancellations
          ? data.min_time_between_cancellations.slice(0, 5)
          : '00:00',
      };
      this.settings.set(s);
    } else {
      this.settings.set({
        operating_hours_start: '08:00',
        operating_hours_end: '20:00',
        lessons_count: 12,
        lesson_duration_minutes: 60,
        default_lesson_price: 150,
        makeup_allowed_days_back: 30,
        max_makeups_in_period: 8,
        makeups_period_days: 30,
        displayed_makeup_lessons_count: 3,
        min_time_between_cancellations: '12:00',
        registration_fee: null,
        student_insurance_premiums: null,
        max_group_size: 6,
        max_lessons_per_week_per_child: 2,
        allow_online_booking: true,
      });
    }
  }

  async saveSettings(): Promise<void> {
    const current = this.settings();
    if (!current) return;

    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);

    const payload: any = {
      ...current,
      updated_at: new Date().toISOString(),
    };

    if (payload.operating_hours_start?.length === 5) payload.operating_hours_start += ':00';
    if (payload.operating_hours_end?.length === 5) payload.operating_hours_end += ':00';
    if (payload.min_time_between_cancellations?.length === 5) payload.min_time_between_cancellations += ':00';
    if (!payload.id) delete payload.id;

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
      operating_hours_start: data.operating_hours_start?.slice(0, 5) ?? null,
      operating_hours_end: data.operating_hours_end?.slice(0, 5) ?? null,
      min_time_between_cancellations: data.min_time_between_cancellations
        ? data.min_time_between_cancellations.slice(0, 5)
        : null,
    };

    this.settings.set(s);
    this.success.set('ההגדרות נשמרו בהצלחה.');
    this.saving.set(false);
  }

  // ================= גורמי מימון =================

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
      alert('אי אפשר למחוק גורם מימון מערכת (כללית/מכבי/מאוחדת).');
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

  // ================= מסלולי תשלום =================

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

    const { data, error } = await this.supabase.from('payment_plans').insert(payload).select().single();

    if (error) {
      console.error('add payment_plan error', error);
      this.error.set('לא ניתן להוסיף מסלול תשלום.');
      return;
    }

    this.paymentPlans.set([...this.paymentPlans(), data as PaymentPlan]);

    this.newPlan = {
      name: '',
      lesson_price: null,
      subsidy_amount: 0,
      funding_source_id: null,
      required_docs: [],
      require_docs_at_booking: true,
    };
    this.showNewPlanForm.set(false);
  }

  async updatePaymentPlan(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const payload = this.normalizePlanForSave(plan);

    const { data, error } = await this.supabase
      .from('payment_plans')
      .update(payload)
      .eq('id', plan.id)
      .select()
      .single();

    if (error) {
      console.error('update payment_plan error', error);
      this.error.set('עדכון מסלול תשלום נכשל.');
      return;
    }

    this.paymentPlans.set(this.paymentPlans().map(p => (p.id === plan.id ? (data as PaymentPlan) : p)));
    this.editingPlanId.set(null);
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

    this.paymentPlans.set(this.paymentPlans().filter(p => p.id !== plan.id));
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

      const { data, error } = await this.supabase.rpc('create_payment_plan_price_version', {
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

      plan.lesson_price = data.lesson_price;
      plan.subsidy_amount = data.subsidy_amount;
      plan.newVersionDate = null;
      plan.newVersionPrice = null;
      plan.newVersionSubsidy = null;

      this.success.set('שינוי המחיר נשמר ונוספה היסטוריה חדשה.');
      await this.loadPaymentPlans();
    } finally {
      this.saving.set(false);
    }
  }
}

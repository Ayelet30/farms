// src/app/pages/farm-settings/farm-settings.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';

type UUID = string;

interface FarmSettings {
  id?: UUID;

  // שעות פעילות
  operating_hours_start: string | null; // time (HH:MM)
  operating_hours_end: string | null;   // time (HH:MM)

  // שיעורים
  lessons_count: number | null;             // כמות שיעורים בסדרה
  lesson_duration_minutes: number | null;   // אורך שיעור בדקות
  default_lesson_price: number | null;      // מחיר שיעור רגיל

  // השלמות וביטולים
  makeup_allowed_days_back: number | null;      // כמה ימים אחורה אפשר להירשם להשלמה
  max_makeups_in_period: number | null;         // מקס' השלמות בתקופה
  makeups_period_days: number | null;           // גודל תקופה (ימים)
  displayed_makeup_lessons_count: number | null;// כמות שיעורי השלמה להצגה
  min_time_between_cancellations: string | null;// interval – HH:MM

  // תשלומים
  registration_fee: number | null;             // דמי רישום
  student_insurance_premiums: number | null;   // ביטוח תלמידים

  // הגדרות נוספות
  max_group_size?: number | null;               // מקס' רוכבים בקבוצה
  max_lessons_per_week_per_child?: number | null;
  allow_online_booking?: boolean | null;        // האם לאפשר זימון עצמי להורים

  updated_at?: string | null;
}

// גורם מימון
interface FundingSource {
  id: UUID;
  name: string;
  is_system: boolean;
  is_active: boolean;
}

// מסלול תשלום
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

  // שדות עזר בצד לקוח בלבד – לא קיימים ב־DB
  newVersionDate?: string | null;       // 'YYYY-MM-DD'
  newVersionPrice?: number | null;
  newVersionSubsidy?: number | null;

  versions?: PaymentPlanPriceVersion[];
}

interface PaymentPlanPriceVersion {
  id: UUID;
  valid_from: string;        // 'YYYY-MM-DD'
  lesson_price: number;
  subsidy_amount: number;
  customer_amount: number;
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

  // מצב כללי
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  // הגדרות חווה קיימות
  settings = signal<FarmSettings | null>(null);

  // ==== UI חדש למסלולים / גורמי מימון ====
  showNewFundingForm = signal(false);
  showNewPlanForm = signal(false);
  editingFundingId = signal<UUID | null>(null);
  editingPlanId = signal<UUID | null>(null);

  // גורמי מימון
  fundingSources = signal<FundingSource[]>([]);
  newFundingSourceName = signal<string>('');

  // מסלולי תשלום
  paymentPlans = signal<PaymentPlan[]>([]);
  newPlan: PaymentPlan = {
    name: '',
    lesson_price: null,
    subsidy_amount: 0,
    funding_source_id: null,
    required_docs: [],
    require_docs_at_booking: true,
  };

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      await Promise.all([
        this.loadSettings(),
        this.loadFundingSources(),
        this.loadPaymentPlans(),
      ]);
    } catch (e) {
      console.error(e);
      this.error.set('שגיאה בטעינת הנתונים.');
    } finally {
      this.loading.set(false);
    }
  }

  // ========== הגדרות חווה קיימות ==========

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
      // ברירת מחדל כשאין רשומה
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

    // time + interval כ-HH:MM:SS
    if (payload.operating_hours_start?.length === 5) {
      payload.operating_hours_start = payload.operating_hours_start + ':00';
    }
    if (payload.operating_hours_end?.length === 5) {
      payload.operating_hours_end = payload.operating_hours_end + ':00';
    }
    if (payload.min_time_between_cancellations?.length === 5) {
      payload.min_time_between_cancellations =
        payload.min_time_between_cancellations + ':00';
    }

    if (!payload.id) {
      delete payload.id;
    }

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

  // ========== גורמי מימון ==========
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
    if (fs.is_system) return; // לא נערוך גורם מערכת
    this.editingFundingId.set(fs.id);
  }

  cancelEditFunding(): void {
    this.editingFundingId.set(null);
    // כדי לנקות שינויים שלא נשמרו
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
    if (fs.is_system) {
      return;
    }

    const { data, error } = await this.supabase
      .from('funding_sources')
      .update({
        name: fs.name,
        is_active: fs.is_active,
      })
      .eq('id', fs.id)
      .select()
      .single();

    if (error) {
      console.error('update funding_source error', error);
      this.error.set('עדכון גורם מימון נכשל.');
      return;
    }

    const list = this.fundingSources().map(f =>
      f.id === fs.id ? (data as FundingSource) : f
    );
    this.fundingSources.set(list);
    this.editingFundingId.set(null);
  }

  async deleteFundingSource(fs: FundingSource): Promise<void> {
    if (fs.is_system) {
      alert('אי אפשר למחוק גורם מימון מערכת (כללית/מכבי/מאוחדת).');
      return;
    }

    const confirmed = confirm(`למחוק את גורם המימון "${fs.name}"?`);
    if (!confirmed) return;

    const { error } = await this.supabase
      .from('funding_sources')
      .delete()
      .eq('id', fs.id);

    if (error) {
      console.error('delete funding_source error', error);
      this.error.set('מחיקת גורם המימון נכשלה.');
      return;
    }

    this.fundingSources.set(this.fundingSources().filter(f => f.id !== fs.id));
  }

  // ========= מסלולי תשלום =========

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

  // טקסט -> מערך קבצים למסלול קיים
  onDocsTextChange(plan: PaymentPlan, value: string): void {
    plan.required_docs = value
      .split('\n')
      .map(v => v.trim())
      .filter(v => !!v);
  }

  // טקסט -> מערך קבצים למסלול חדש
  onNewPlanDocsChange(value: string): void {
    this.newPlan.required_docs = value
      .split('\n')
      .map(v => v.trim())
      .filter(v => !!v);
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

    const list = this.paymentPlans().map(p =>
      p.id === plan.id ? (data as PaymentPlan) : p
    );
    this.paymentPlans.set(list);
    this.editingPlanId.set(null);
  }

  async deletePaymentPlan(plan: PaymentPlan): Promise<void> {
    if (!plan.id) return;

    const confirmed = confirm(`למחוק את מסלול התשלום "${plan.name}"?`);
    if (!confirmed) return;

    const { error } = await this.supabase
      .from('payment_plans')
      .delete()
      .eq('id', plan.id);

    if (error) {
      console.error('delete payment_plan error', error);
      this.error.set('מחיקת מסלול התשלום נכשלה.');
      return;
    }

    this.paymentPlans.set(this.paymentPlans().filter(p => p.id !== plan.id));
  }

  // חישוב תשלום לקוח בצד לקוח (לתצוגה בלבד)
  getCustomerAmount(plan: PaymentPlan): number {
    const lp = plan.lesson_price ?? 0;
    const sub = plan.subsidy_amount ?? 0;
    const val = lp - sub;
    return val < 0 ? 0 : val;
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

    const { data, error } = await this.supabase.rpc(
      'create_payment_plan_price_version',
      {
        p_plan_id: plan.id,
        p_valid_from: date,
        p_lesson_price: price,
        p_subsidy_amount: subsidy,
      }
    );

    if (error) {
      console.error('savePlanPriceVersion error', error);
      this.error.set('שמירת שינוי המחיר נכשלה. נסי שוב.');
      return;
    }

    // מעדכנת את אובייקט המסלול בצד לקוח על בסיס מה שחזר מה־DB
    plan.lesson_price = data.lesson_price;
    plan.subsidy_amount = data.subsidy_amount;

    // איפוס שדות העזר
    plan.newVersionDate = null;
    plan.newVersionPrice = null;
    plan.newVersionSubsidy = null;

    this.success.set('שינוי המחיר נשמר ונוספה היסטוריה חדשה.');
  } finally {
    this.saving.set(false);
  }
}

}


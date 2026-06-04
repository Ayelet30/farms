import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { EnumOptionsService, DbOption } from '../../services/enum-options';

type Rider = {
  uid: string;
  first_name: string;
  last_name: string;
};

type Horse = {
  id: string;
  name: string;
};

type ServiceType = {
  id: string;
  name: string;
  category: string;
  default_price_agorot: number;
};

@Component({
  selector: 'app-secretary-rider-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-rider-services.html',
  styleUrls: ['./secretary-rider-services.css'],
})
export class SecretaryRiderServicesComponent implements OnInit {
  private enumOptions = inject(EnumOptionsService);
  permanentServiceWarning = '';
  loading = true;
  saving = false;
  error = '';
  success = '';

  riders: Rider[] = [];
  horses: Horse[] = [];
  serviceTypes: ServiceType[] = [];

  serviceModeOptions: DbOption[] = [];
  recurrenceUnitOptions: DbOption[] = [];

  selectedRiderUid = '';

  form = {
    horse_uid: '',
    service_type_id: '',
    service_mode: 'once',
    start_date: '',
    end_date: '',
    recurrence_unit: 'month',
    recurrence_interval: 1,
    price_agorot: 0,
    notes: '',
  };

  async ngOnInit() {
    try {
      await Promise.all([
        this.loadRiders(),
        this.loadServiceTypes(),
        this.loadEnumOptions(),
      ]);
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בטעינת הנתונים';
    } finally {
      this.loading = false;
    }
  }

  private async loadEnumOptions() {
    const [modes, recurrenceUnits] = await Promise.all([
      this.enumOptions.getServiceModes(),
      this.enumOptions.getRecurrenceUnits(),
    ]);

    this.serviceModeOptions = modes;
    this.recurrenceUnitOptions = recurrenceUnits;
  }

  private async loadRiders() {
    const db = dbTenant();

    const { data, error } = await db
      .from('independent_riders')
      .select('uid, first_name, last_name')
      .order('first_name', { ascending: true });

    if (error) throw error;

    this.riders = data ?? [];
  }

  private async loadServiceTypes() {
    const db = dbTenant();

    const { data, error } = await db
      .from('rider_service_types')
      .select('id, name, category, default_price_agorot')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    this.serviceTypes = data ?? [];
  }

  async onRiderChanged() {
    this.error = '';
    this.success = '';
    this.horses = [];

    this.form.horse_uid = '';
    this.form.service_type_id = '';

    if (!this.selectedRiderUid) return;

    const db = dbTenant();

    const { data, error } = await db
      .from('horses')
      .select('id, name')
      .eq('owner_rider_uid', this.selectedRiderUid)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      this.error = error.message;
      return;
    }

    this.horses = data ?? [];
    await this.checkPermanentServiceExists();
  }
  async onHorseChanged() {
    this.error = '';
    this.success = '';

    await this.checkPermanentServiceExists();
  }
  async onServiceChanged() {
    this.error = '';
    this.success = '';

    const service = this.selectedService;

    if (service) {
      this.form.price_agorot = service.default_price_agorot;
    }
    await this.checkPermanentServiceExists();
  }

  get selectedService(): ServiceType | null {
    return this.serviceTypes.find(x => x.id === this.form.service_type_id) ?? null;
  }

  get isOnceMode(): boolean {
    return this.form.service_mode === 'once';
  }

  get isRecurringRangeMode(): boolean {
    return this.form.service_mode === 'recurring_range';
  }

  get isPermanentMode(): boolean {
    return this.form.service_mode === 'permanent';
  }

  validate(): boolean {
    this.error = '';
    this.success = '';

    if (!this.selectedRiderUid) {
      this.error = 'יש לבחור רוכב עצמאי';
      return false;
    }

    if (!this.form.horse_uid) {
      this.error = 'יש לבחור סוס';
      return false;
    }

    if (!this.selectedService) {
      this.error = 'יש לבחור סוג שירות';
      return false;
    }

    if (!this.form.start_date) {
      this.error = 'יש לבחור תאריך התחלה';
      return false;
    }

    if (this.isRecurringRangeMode && !this.form.end_date) {
      this.error = 'בשירות מחזורי יש לבחור תאריך סיום';
      return false;
    }

    if (this.isRecurringRangeMode && this.form.end_date < this.form.start_date) {
      this.error = 'תאריך סיום לא יכול להיות לפני תאריך התחלה';
      return false;
    }

    if (!this.isOnceMode && (!this.form.recurrence_unit || !this.form.recurrence_interval)) {
      this.error = 'יש לבחור תדירות לשירות מחזורי או קבוע';
      return false;
    }

    if (this.form.price_agorot < 0) {
      this.error = 'מחיר לא יכול להיות שלילי';
      return false;
    }

    return true;
  }

  async submit() {
    if (this.saving) return;
    if (!this.validate()) return;

    const service = this.selectedService;
    if (!service) return;

    this.saving = true;

    try {
      const db = dbTenant();

      const { error } = await db
        .from('rider_services')
        .insert({
          rider_uid: this.selectedRiderUid,
          horse_uid: this.form.horse_uid,
          service_type_id: service.id,
          service_name: service.name,

          start_date: this.form.start_date,
          end_date: this.isRecurringRangeMode ? this.form.end_date : null,

          status: 'active',
          price_agorot: this.form.price_agorot,

          service_mode: this.form.service_mode,
          recurrence_unit: this.isOnceMode ? null : this.form.recurrence_unit,
          recurrence_interval: this.isOnceMode ? null : this.form.recurrence_interval,

          next_billing_date: this.isOnceMode ? null : this.form.start_date,
          notes: this.form.notes?.trim() || null,
        });

      if (error) throw error;

      this.success = 'השירות נוסף לרוכב בהצלחה ✅';

      this.form = {
        horse_uid: '',
        service_type_id: '',
        service_mode: 'once',
        start_date: '',
        end_date: '',
        recurrence_unit: 'month',
        recurrence_interval: 1,
        price_agorot: 0,
        notes: '',
      };

    } catch (e: any) {
      this.error = e?.message || 'שגיאה בהוספת השירות';
    } finally {
      this.saving = false;
    }
  }

  priceShekelChanged(value: string) {
    const shekel = Number(value || 0);
    this.form.price_agorot = Math.round(shekel * 100);
  }

  priceShekel(): number {
    return (this.form.price_agorot ?? 0) / 100;
  }
  private async checkPermanentServiceExists() {
    this.permanentServiceWarning = '';

    if (
      !this.selectedRiderUid ||
      !this.form.horse_uid ||
      !this.form.service_type_id
    ) {
      return;
    }

    const db = dbTenant();

    const { data, error } = await db
      .from('rider_services')
      .select('id, start_date')
      .eq('rider_uid', this.selectedRiderUid)
      .eq('horse_uid', this.form.horse_uid)
      .eq('service_type_id', this.form.service_type_id)
      .eq('service_mode', 'permanent')
      .eq('status', 'active')
      .limit(1);

    console.log('CHECK PERMANENT SERVICE', {
      rider_uid: this.selectedRiderUid,
      horse_uid: this.form.horse_uid,
      service_type_id: this.form.service_type_id,
      data,
      error,
    });

    if (error) {
      console.error('שגיאה בבדיקת שירות קבוע:', error);
      return;
    }

    if (data?.length) {
      this.permanentServiceWarning =
        `קיים כבר שירות קבוע פעיל החל מ־${this.formatDateIl(data[0].start_date)}. ניתן להוסיף בכל זאת במידת הצורך.`;
    }
  }
  private formatDateIl(date: string): string {
    if (!date) return '';

    return new Date(date).toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
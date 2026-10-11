import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { getCurrentUserData } from '../../services/legacy-compat';
import { dbTenant } from '../../services/supabaseClient.service';
import { EnumOptionsService, DbOption } from '../../services/enum-options';
import { FormsModule } from '@angular/forms';

type RiderService = {
  id: string;
  service_name: string;
  start_date: string;
  end_date: string | null;
  status: string;
  price_agorot: number;
  next_billing_date: string | null;
  last_billed_date: string | null;
  notes: string | null;
  service_mode: string;
  recurrence_unit: string | null;
  recurrence_interval: number | null;
  horses?: {
    name: string;
  } | null;
};
type ServiceTypeOption = {
  id: string;
  name: string;
};

type HorseOption = {
  id: string;
  name: string;
};
@Component({
  selector: 'app-independent-my-services',
  standalone: true,
  imports: [CommonModule, FormsModule], templateUrl: './independent-my-services.html',
  styleUrls: ['./independent-my-services.css'],
})
export class IndependentMyServicesComponent implements OnInit {
  private enumOptions = inject(EnumOptionsService);
  serviceTypes: ServiceTypeOption[] = [];
  horses: HorseOption[] = [];
  selectedStatus = '';
  selectedHorseUid = '';
  selectedServiceTypeId = '';
  loading = true;
  error = '';

  services: RiderService[] = [];

  serviceModeOptions: DbOption[] = [];
  statusOptions: DbOption[] = [];
  recurrenceUnitOptions: DbOption[] = [];

  async ngOnInit() {
    try {
      const user = await getCurrentUserData();

      if (!user?.uid) {
        this.error = 'משתמש לא מחובר';
        return;
      }

      await Promise.all([
        this.loadEnumOptions(),
        this.loadFilterOptions(user.uid),
        this.loadServices(user.uid),
      ]);

    } catch (e: any) {
      this.error = e?.message || 'שגיאה בטעינת השירותים';
    } finally {
      this.loading = false;
    }
  }

  private async loadEnumOptions() {
    const [
      modes,
      statuses,
      recurrenceUnits,
    ] = await Promise.all([
      this.enumOptions.getServiceModes(),
      this.enumOptions.getRiderServiceStatuses(),
      this.enumOptions.getRecurrenceUnits(),
    ]);

    this.serviceModeOptions = modes;
    this.statusOptions = statuses;
    this.recurrenceUnitOptions = recurrenceUnits;
  }
  private async loadServices(riderUid: string) {
    const db = dbTenant();

    let query = db
      .from('rider_services')
      .select(`
      id,
      service_name,
      start_date,
      end_date,
      status,
      price_agorot,
      next_billing_date,
      last_billed_date,
      notes,
      service_mode,
      recurrence_unit,
      recurrence_interval,
      horse_uid,
      service_type_id,
      horses:horse_uid (
        name
      )
    `)
      .eq('rider_uid', riderUid);

    if (this.selectedHorseUid) {
      query = query.eq('horse_uid', this.selectedHorseUid);
    }

    if (this.selectedServiceTypeId) {
      query = query.eq('service_type_id', this.selectedServiceTypeId);
    }
    if (this.selectedStatus) {
      query = query.eq('status', this.selectedStatus);
    }
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    this.services = data ?? [];
  }
  async onFiltersChanged() {
    const user = await getCurrentUserData();

    if (!user?.uid) {
      this.error = 'משתמש לא מחובר';
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      await this.loadServices(user.uid);
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בסינון השירותים';
    } finally {
      this.loading = false;
    }
  }

  clearFilters() {
    this.selectedHorseUid = '';
    this.selectedServiceTypeId = '';
    this.onFiltersChanged();
    this.selectedStatus = '';

  }

  optionLabel(options: DbOption[], value: string | null | undefined): string {
    if (!value) return '—';
    return options.find(x => x.value === value)?.label ?? value;
  }

  statusLabel(status: string): string {
    return this.optionLabel(this.statusOptions, status);
  }

  modeLabel(mode: string): string {
    return this.optionLabel(this.serviceModeOptions, mode);
  }

  recurrenceUnitLabel(unit: string | null): string {
    return this.optionLabel(this.recurrenceUnitOptions, unit);
  }

  recurrenceText(service: RiderService): string {
    if (service.service_mode === 'once') return 'ללא חזרתיות';

    if (!service.recurrence_unit || !service.recurrence_interval) {
      return 'לא הוגדרה חזרתיות';
    }

    return `כל ${service.recurrence_interval} ${this.recurrenceUnitLabel(service.recurrence_unit)}`;
  }

  statusClass(status: string): string {
    return status;
  }

  priceText(agorot: number | null | undefined): string {
    const value = (agorot ?? 0) / 100;
    return `${value.toLocaleString('he-IL')} ₪`;
  }
  private async loadFilterOptions(riderUid: string) {
    const db = dbTenant();

    const [horsesRes, serviceTypesRes] = await Promise.all([
      db
        .from('horses')
        .select('id, name')
        .eq('owner_rider_uid', riderUid)
        .eq('is_active', true)
        .order('name', { ascending: true }),

      db
        .from('rider_service_types')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

    if (horsesRes.error) throw horsesRes.error;
    if (serviceTypesRes.error) throw serviceTypesRes.error;

    this.horses = horsesRes.data ?? [];
    this.serviceTypes = serviceTypesRes.data ?? [];
  }
}
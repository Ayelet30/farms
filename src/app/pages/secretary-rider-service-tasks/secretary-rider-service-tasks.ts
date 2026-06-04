import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { dbTenant } from '../../services/supabaseClient.service';
import { EnumOptionsService, DbOption } from '../../services/enum-options';
import { getCurrentUserData } from '../../services/legacy-compat';

type ServiceTask = {
  id: string;
  rider_service_id: string;
  rider_uid: string;
  horse_uid: string;
  service_type_id: string;
  service_name: string;
  due_date: string;
  status: string;
  completed_at: string | null;
  completed_by_uid: string | null;
  notes: string | null;

  horses?: {
    name: string;
  } | null;

  independent_riders?: {
    first_name: string;
    last_name: string;
    phone?: string | null;
  } | null;
  rider_services?: {
    service_mode: string;
    recurrence_unit: string | null;
    recurrence_interval: number | null;
    price_agorot: number;
    end_date: string | null;
  } | null;
};

@Component({
  selector: 'app-secretary-rider-service-tasks',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './secretary-rider-service-tasks.html',
  styleUrls: ['./secretary-rider-service-tasks.css'],
})
export class SecretaryRiderServiceTasksComponent implements OnInit {
  private enumOptions = inject(EnumOptionsService);

  loading = true;
  refreshing = false;
  actionLoadingId = '';

  error = '';
  success = '';

  tasks: ServiceTask[] = [];

  taskStatusOptions: DbOption[] = [];
  serviceModeOptions: DbOption[] = [];
  recurrenceUnitOptions: DbOption[] = [];

  async ngOnInit() {
    await this.initPage();
  }

  private async initPage() {
    this.loading = true;
    this.error = '';

    try {
      await Promise.all([
        this.loadEnumOptions(),
        this.loadTasks(),
      ]);
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בטעינת המשימות';
    } finally {
      this.loading = false;
    }
  }

  private async loadEnumOptions() {
    const [
      taskStatuses,
      serviceModes,
      recurrenceUnits,
    ] = await Promise.all([
      this.enumOptions.getRiderServiceTaskStatuses(),
      this.enumOptions.getServiceModes(),
      this.enumOptions.getRecurrenceUnits(),
    ]);

    this.taskStatusOptions = taskStatuses;
    this.serviceModeOptions = serviceModes;
    this.recurrenceUnitOptions = recurrenceUnits;
  }

  async loadTasks() {
    this.error = '';
    this.success = '';

    const db = dbTenant();

    const { data, error } = await db
      .from('rider_service_tasks')
      .select(`
        id,
        rider_service_id,
        rider_uid,
        horse_uid,
        service_type_id,
        service_name,
        due_date,
        status,
        completed_at,
        completed_by_uid,
        notes,
        horses:horse_uid (
          name
        ),
        independent_riders:rider_uid (
          first_name,
          last_name,
          phone
        ),
        rider_services:rider_service_id (
          service_mode,
          recurrence_unit,
          recurrence_interval,
          price_agorot,
          end_date
        )
      `)
      .eq('status', 'open')
      .order('due_date', { ascending: true });

    if (error) throw error;

    this.tasks = data ?? [];
  }

  async refreshTasks() {
    if (this.refreshing) return;

    this.refreshing = true;
    this.error = '';
    this.success = '';

    try {
      const db = dbTenant();

      const untilDate = this.addDaysYmd(90);

      const { error } = await db.rpc('generate_rider_service_tasks', {
        p_until_date: untilDate,
      });

      if (error) throw error;

      await this.loadTasks();

      this.success = 'המשימות רועננו בהצלחה ✅';

    } catch (e: any) {
      this.error = e?.message || 'שגיאה ברענון המשימות';
    } finally {
      this.refreshing = false;
    }
  }

  async markAsDone(task: ServiceTask) {
    if (this.actionLoadingId) return;

    const ok = confirm(`לסמן את המשימה "${task.service_name}" כבוצעה?`);
    if (!ok) return;

    this.actionLoadingId = task.id;
    this.error = '';
    this.success = '';

    try {
      const user = await getCurrentUserData();
      const db = dbTenant();

      const { error } = await db
        .from('rider_service_tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by_uid: user?.uid ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      if (error) throw error;

      this.tasks = this.tasks.filter(x => x.id !== task.id);
      this.success = 'המשימה סומנה כבוצעה בהצלחה ✅';

    } catch (e: any) {
      this.error = e?.message || 'שגיאה בסימון המשימה כבוצעה';
    } finally {
      this.actionLoadingId = '';
    }
  }

  optionLabel(options: DbOption[], value: string | null | undefined): string {
    if (!value) return '—';
    return options.find(x => x.value === value)?.label ?? value;
  }

  statusLabel(status: string): string {
    return this.optionLabel(this.taskStatusOptions, status);
  }

  serviceModeLabel(mode: string | null | undefined): string {
    return this.optionLabel(this.serviceModeOptions, mode);
  }

  recurrenceUnitLabel(unit: string | null | undefined): string {
    return this.optionLabel(this.recurrenceUnitOptions, unit);
  }

  recurrenceText(task: ServiceTask): string {
    const service = task.rider_services;

    if (!service) return '—';

    if (!service.recurrence_unit || !service.recurrence_interval) {
      return this.serviceModeLabel(service.service_mode);
    }

    return `כל ${service.recurrence_interval} ${this.recurrenceUnitLabel(service.recurrence_unit)}`;
  }

  priceText(agorot: number | null | undefined): string {
    const value = (agorot ?? 0) / 100;
    return `${value.toLocaleString('he-IL')} ₪`;
  }

  private addDaysYmd(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
  }
}
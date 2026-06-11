import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { dbTenant } from '../../services/supabaseClient.service';
import { EnumOptionsService, DbOption } from '../../services/enum-options';
import { getCurrentUserData } from '../../services/legacy-compat';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { CancelServiceTaskDialogComponent } from './cancel-service-task-dialog.component';
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
    start_date: string;
    end_date: string | null;
    service_mode: string;
    recurrence_unit: string | null;
    recurrence_interval: number | null;
    price_agorot: number;
  } | null;
};
type RiderOption = {
  uid: string;
  first_name: string;
  last_name: string;
};

type HorseOption = {
  id: string;
  name: string;
};
type TaskGroup = {
  rider_service_id: string;
  service_name: string;
  riderName: string;
  horseName: string;
  nearestTask: ServiceTask;
  tasks: ServiceTask[];
};

@Component({
  selector: 'app-secretary-rider-service-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-rider-service-tasks.html',
  styleUrls: ['./secretary-rider-service-tasks.css'],
})
export class SecretaryRiderServiceTasksComponent implements OnInit {
  private enumOptions = inject(EnumOptionsService);
  private dialog = inject(MatDialog);
  taskGroups: TaskGroup[] = [];
  expandedServiceIds = new Set<string>();
  serviceTypes: { id: string; name: string }[] = [];
  riders: RiderOption[] = [];
  horses: HorseOption[] = [];

  selectedRiderUid = '';
  selectedHorseUid = '';
  selectedServiceTypeId = '';
  selectedDateFrom = '';
  selectedDateTo = '';

  loading = true;
  refreshing = false;
  actionLoadingId = '';

  error = '';
  success = '';

  tasks: ServiceTask[] = [];

  taskStatusOptions: DbOption[] = [];
  serviceModeOptions: DbOption[] = [];
  recurrenceUnitOptions: DbOption[] = [];
  hasOpenTasks = false;
  async ngOnInit() {
    await this.initPage();
  }
  private async initPage() {
    this.loading = true;
    this.error = '';
    this.success = '';

    try {
      await this.loadEnumOptions();
      await Promise.all([
        this.loadServiceTypes(),
        this.loadRiders(),
        this.loadHorses(),
        this.loadHasOpenTasks(),
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

    let query = db
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
  start_date,
  end_date,
  service_mode,
  recurrence_unit,
  recurrence_interval,
  price_agorot
)
      `).eq('status', 'open');

    if (this.selectedServiceTypeId) {
      query = query.eq('service_type_id', this.selectedServiceTypeId);
    }

    if (this.selectedRiderUid) {
      query = query.eq('rider_uid', this.selectedRiderUid);
    }

    if (this.selectedHorseUid) {
      query = query.eq('horse_uid', this.selectedHorseUid);
    }

    if (this.selectedDateFrom) {
      query = query.gte('due_date', this.selectedDateFrom);
    }

    if (this.selectedDateTo) {
      query = query.lte('due_date', this.selectedDateTo);
    }

    const { data, error } = await query.order('due_date', { ascending: true });
    this.tasks = data ?? [];
    this.buildTaskGroups();
  }
  private buildTaskGroups() {
    const map = new Map<string, ServiceTask[]>();

    for (const task of this.tasks) {
      const key = task.rider_service_id;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(task);
    }

    this.taskGroups = Array.from(map.entries()).map(([serviceId, tasks]) => {
      const sorted = tasks.sort((a, b) =>
        a.due_date.localeCompare(b.due_date)
      );

      const first = sorted[0];

      return {
        rider_service_id: serviceId,
        service_name: first.service_name,
        riderName: `${first.independent_riders?.first_name || ''} ${first.independent_riders?.last_name || ''}`.trim(),
        horseName: first.horses?.name || 'סוס לא ידוע',
        nearestTask: first,
        tasks: sorted,
      };
    });
  }
  async refreshTasks() {
    if (this.refreshing) return;

    this.refreshing = true;
    this.error = '';
    this.success = '';

    try {
      const db = dbTenant();

      const { error } = await db.rpc('generate_next_rider_service_tasks');

      if (error) throw error;

      await this.loadTasks();
      await this.loadHasOpenTasks();

      this.success = 'המשימות רועננו בהצלחה';

    } catch (e: any) {
      this.error = e?.message || 'שגיאה ברענון המשימות';
    } finally {
      this.refreshing = false;
    }
  }
  today = this.getToday();

  private getToday(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
  }
  async markAsDone(task: ServiceTask) {
    if (this.actionLoadingId) return;


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

      await this.loadTasks();
      await this.loadHasOpenTasks(); this.success = 'המשימה סומנה כבוצעה בהצלחה ✅';

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

  toggleExpanded(serviceId: string) {
    if (this.expandedServiceIds.has(serviceId)) {
      this.expandedServiceIds.delete(serviceId);
    } else {
      this.expandedServiceIds.add(serviceId);
    }
  }

  clearFilters() {
    this.selectedServiceTypeId = '';
    this.selectedDateFrom = '';
    this.selectedDateTo = '';
    this.loadTasks();
  }
  private async loadServiceTypes() {
    const db = dbTenant();

    const { data, error } = await db
      .from('rider_service_types')
      .select('id, name')
      .eq('requires_task', true)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    this.serviceTypes = data ?? [];
  }
  isOverdue(task: ServiceTask): boolean {
    return task.status === 'open' && task.due_date < this.todayYmd();
  }

  displayStatus(task: ServiceTask): string {
    if (this.isOverdue(task)) return 'באיחור';
    return this.statusLabel(task.status);
  }

  private todayYmd(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  async cancelTask(task: ServiceTask, note: string | null) {
    this.actionLoadingId = task.id;

    try {
      const user = await getCurrentUserData();
      const db = dbTenant();
      const now = new Date().toISOString();

      const { error } = await db
        .from('rider_service_tasks')
        .update({
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by_uid: user?.uid ?? null,
          cancellation_note: note,
          updated_at: now,
        })
        .eq('id', task.id);

      if (error) throw error;

      if (task.rider_services?.service_mode === 'once') {
        const { error: serviceError } = await db
          .from('rider_services')
          .update({
            status: 'cancelled',
            cancelled_at: now,
            cancelled_by_uid: user?.uid ?? null,
            cancellation_note: note,
            updated_at: now,
          })
          .eq('id', task.rider_service_id);

        if (serviceError) throw serviceError;
      }

      await this.loadTasks();

      this.success = task.rider_services?.service_mode === 'once'
        ? 'המשימה והשירות החד־פעמי בוטלו בהצלחה'
        : 'המשימה בוטלה בהצלחה';

    } catch (e: any) {
      this.error = e?.message || 'שגיאה בביטול המשימה';
    } finally {
      this.actionLoadingId = '';
    }
  }
  async cancelWholeService(group: TaskGroup, note: string | null) {
    this.actionLoadingId = group.rider_service_id;

    try {
      const user = await getCurrentUserData();
      const db = dbTenant();
      const now = new Date().toISOString();

      const { error: serviceError } = await db
        .from('rider_services')
        .update({
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by_uid: user?.uid ?? null,
          cancellation_note: note,
          updated_at: now,
        })
        .eq('id', group.rider_service_id);

      if (serviceError) throw serviceError;

      const { error: tasksError } = await db
        .from('rider_service_tasks')
        .update({
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by_uid: user?.uid ?? null,
          cancellation_note: note,
          updated_at: now,
        })
        .eq('rider_service_id', group.rider_service_id)
        .eq('status', 'open');

      if (tasksError) throw tasksError;

      await this.loadTasks();
      this.success = 'השירות וכל המשימות הפתוחות שלו בוטלו בהצלחה';

    } catch (e: any) {
      this.error = e?.message || 'שגיאה בביטול השירות';
    } finally {
      this.actionLoadingId = '';
    }
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

  private async loadHorses() {
    const db = dbTenant();

    const { data, error } = await db
      .from('horses')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    this.horses = data ?? [];
  }
  openCancelDialog(group: TaskGroup) {
    const ref = this.dialog.open(CancelServiceTaskDialogComponent, {
      width: '520px',
      data: {
        message: `מה תרצי לבטל עבור השירות "${group.service_name}"?`,
        allowServiceCancel: true,
      },
    });

    ref.afterClosed().subscribe(async result => {
      if (!result) return;

      if (result.scope === 'task') {
        await this.cancelTask(group.nearestTask, result.note);
      } else {
        await this.cancelWholeService(group, result.note);
        await this.loadHasOpenTasks();
      }
    });
  }
  openCancelTaskDialog(task: ServiceTask) {
    const ref = this.dialog.open(CancelServiceTaskDialogComponent, {
      width: '520px',
      data: {
        message: `לבטל את המשימה "${task.service_name}" לתאריך ${task.due_date}?`,
        allowServiceCancel: false,
      },
    });

    ref.afterClosed().subscribe(async result => {
      if (!result) return;
      await this.cancelTask(task, result.note);
      await this.loadHasOpenTasks();
    });
  }
  private async loadHasOpenTasks() {
    const db = dbTenant();

    const { count, error } = await db
      .from('rider_service_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');

    if (error) throw error;

    this.hasOpenTasks = (count ?? 0) > 0;
  }
  isDueTomorrow(task: ServiceTask): boolean {
    if (task.status !== 'open') return false;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');

    return task.due_date === `${y}-${m}-${d}`;
  }
  isDueToday(task: ServiceTask): boolean {
    return task.status === 'open' &&
      task.due_date === this.todayYmd();
  }
  isUrgent(task: ServiceTask): boolean {
    return this.isDueToday(task) || this.isDueTomorrow(task);
  }
}
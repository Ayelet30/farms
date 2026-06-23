import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { getCurrentUserData } from '../../services/legacy-compat';
import { ServiceTaskActionDialogComponent } from '../secretary-rider-service-tasks/service-task-action-dialog.component';
type HorseGender = 'male' | 'female' | 'gelding' | null;
type HorseSize = 'pony_small' | 'pony_large' | 'horse' | null;
interface RiderService {
  id: string;
  rider_uid: string;
  horse_uid: string;
  service_type_id: string;
  service_name: string;
  start_date: string | null;
  end_date: string | null;
  status: 'active' | 'cancelled' | string;
  service_mode: 'once' | 'recurring_range' | 'permanent' | string;
  price_agorot: number | null;
  notes: string | null;
  cancellation_note: string | null;

  rider_service_types?: {
    name: string | null;
    category: string | null;
  } | null;
  cancelled_at: string | null;
  cancelled_by_uid: string | null;
  cancelled_by_name?: string | null;
}
interface Horse {
  id?: string;
  name: string;
  age?: number | null;
  color?: string | null;

  gender?: HorseGender;
  horse_size?: HorseSize;
  shoeing_notes: string | null;
  max_continuous_minutes: number;
  max_daily_minutes: number;
  min_break_minutes: number;
  is_active: boolean;

  notes?: string | null;
  is_farm_horse: boolean;
  // תוספות
  food_supplements?: string | null;
  horse_equipment?: string | null;

  owner_rider_uid?: string | null;
  owner_rider_name?: string | null;
}
interface Rider {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  status?: 'active' | 'inactive' | string | null;
  is_farm_responsible?: boolean;
}
interface HorseServiceTask {
  id: string;
  rider_service_id: string;
  rider_uid: string;
  horse_uid: string;
  service_type_id: string;
  service_name: string;
  due_date: string;
  status: 'open' | 'completed' | 'cancelled' | string;
  completed_at: string | null;
  completed_by_uid: string | null;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by_uid: string | null;
  cancellation_note: string | null;
  completed_by_name?: string | null;
  cancelled_by_name?: string | null;
  execution_note?: string | null;
}
type PerformerOption = {
  uid: string;
  name: string;
  role: string;
};


@Component({
  selector: 'app-secretary-horses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-horses.component.html',
  styleUrls: ['./secretary-horses.component.scss'],
})
export class SecretaryHorsesComponent implements OnInit {
  private ui = inject(UiDialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  riders: Rider[] = [];
  returnRiderUid: string | null = null;
  tasksByHorse: Record<string, HorseServiceTask[]> = {};
  activeTab: 'active' | 'inactive' = 'active';
  horses: Horse[] = [];
  editing: Horse | null = null;
  servicesByHorse: Record<string, RiderService[]> = {};
  loading = false;
  horseOwnershipFilter: 'all' | 'farm' | 'private' = 'all';
  privateOwnerFilterUid = '';
  horseNameFilter = '';
  editingServiceId: string | null = null;
  editingTaskId: string | null = null;
  performers: PerformerOption[] = [];
  selectedHistoryHorse: Horse | null = null;
  showHorseHistoryModal = false;
  historyTab: 'services' | 'tasks' = 'tasks';
  historyServiceTypeId = '';
  serviceTypes: { id: string; name: string }[] = [];
  openServiceEdit(id: string): void {
    this.editingServiceId = id;
  }
  private dialog = inject(MatDialog);
  currentUser: any = null;

  closeServiceEdit(): void {
    this.editingServiceId = null;
  }

  openTaskEdit(id: string): void {
    this.editingTaskId = id;
  }

  closeTaskEdit(): void {
    this.editingTaskId = null;
  }
  async ngOnInit(): Promise<void> {
    const horseId = this.route.snapshot.queryParamMap.get('horseId');
    this.returnRiderUid = this.route.snapshot.queryParamMap.get('returnRiderUid');
    this.currentUser = await getCurrentUserData();
    await this.loadRiders();
    await this.loadPerformers();
    await this.loadServiceTypes();
    await this.loadHorses();
    await this.loadHorseTasks();

    if (horseId) {
      const horse = this.horses.find(h => h.id === horseId);

      if (horse) {
        this.activeTab = horse.is_active ? 'active' : 'inactive';
        this.editHorse(horse);
      }
    }
  } async loadRiders(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('independent_riders')
      .select('uid, first_name, last_name, full_name, status, is_farm_responsible').order('first_name', { ascending: true })
      .order('last_name', { ascending: true });

    if (error) {
      console.error(error);
      this.riders = [];
      return;
    }

    this.riders = data ?? [];
  }

  riderLabel(rider: Rider): string {
    const name =
      `${rider.first_name || ''} ${rider.last_name || ''}`.trim()
      || rider.full_name
      || rider.uid;

    return name;
  }

  ownerName(uid: string | null | undefined): string {
    if (!uid) return '';

    const rider = this.riders.find(r => r.uid === uid);
    return rider ? this.riderLabel(rider) : '';
  }
  backToRider(): void {

    if (!this.returnRiderUid) {
      this.router.navigate(['/secretary/independent-riders']);
      return;
    }

    this.router.navigate(['/secretary/independent-riders'], {
      queryParams: {
        riderUid: this.returnRiderUid,
      },
    });
  }
  async loadHorses(): Promise<void> {
    this.loading = true;

    try {
      const { data, error } = await dbTenant()
        .from('horses')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      this.horses = (data ?? []) as Horse[];
      await this.loadHorseTasks();
      await this.loadHorseServices();
    } catch (e: any) {
      console.error('Failed to load horses', e);
      this.horses = [];
      await this.ui.alert('אירעה שגיאה בטעינת הסוסים.', 'שגיאה');
    } finally {
      this.loading = false;
    }
  }

  newHorse(): void {
    this.editing = {
      name: '',
      age: null,
      color: null,
      gender: null,
      horse_size: null,
      owner_rider_uid: null,

      max_continuous_minutes: 60,
      max_daily_minutes: 240,
      min_break_minutes: 15,
      is_active: true,
      notes: null,

      shoeing_notes: null,
      is_farm_horse: true,

      food_supplements: null,
      horse_equipment: null,

    };
  }

  editHorse(horse: Horse): void {
    this.editing = { ...horse };
  }

  cancelEdit(): void {
    this.editing = null;
  }

  async saveHorse(): Promise<void> {
    if (!this.editing) return;

    if (!this.editing.name || !this.editing.name.trim()) {
      await this.ui.alert('שם הסוס הוא שדה חובה.', 'חסר שדה');
      return;
    }

    const payload: Horse = {
      ...this.editing,
      name: this.editing.name.trim(),
    };

    if (payload.age === undefined) payload.age = null;
    if (payload.color === undefined) payload.color = null;
    if (payload.gender === undefined) payload.gender = null;
    if (payload.horse_size === undefined) payload.horse_size = null;
    if (payload.notes === undefined) payload.notes = null;

    if (payload.shoeing_notes === undefined) payload.shoeing_notes = null;
    if (payload.food_supplements === undefined) payload.food_supplements = null;
    if (payload.horse_equipment === undefined) payload.horse_equipment = null;

    if (!payload.max_continuous_minutes) payload.max_continuous_minutes = 60;
    if (!payload.max_daily_minutes) payload.max_daily_minutes = 240;
    if (!payload.min_break_minutes) payload.min_break_minutes = 15;

    try {
      const dto = {
        name: payload.name,
        age: payload.age,
        color: payload.color,
        gender: payload.gender,
        horse_size: payload.horse_size,
        owner_rider_uid: payload.owner_rider_uid || null,
        max_continuous_minutes: payload.max_continuous_minutes,
        max_daily_minutes: payload.max_daily_minutes,
        min_break_minutes: payload.min_break_minutes,
        is_active: payload.is_active,
        notes: payload.notes,
        is_farm_horse: payload.is_farm_horse,
        food_supplements: payload.food_supplements,
        horse_equipment: payload.horse_equipment,

      };

      if (payload.id) {
        const { error } = await dbTenant()
          .from('horses')
          .update(dto)
          .eq('id', payload.id);

        if (error) throw error;
      } else {
        const { error } = await dbTenant()
          .from('horses')
          .insert(dto);

        if (error) throw error;
      }
      const originalHorse = payload.id
        ? this.horses.find(h => h.id === payload.id)
        : null;

      const horseWasDeactivated =
        originalHorse?.is_active === true && payload.is_active === false;

      if (payload.id && !horseWasDeactivated) {
        await this.saveEditingHorseTasks(payload.id);
      }
      this.editing = null;
      await this.loadHorses();
      await this.ui.alert('הסוס נשמר בהצלחה.', 'הצלחה');
    } catch (e: any) {
      console.error('saveHorse failed', e);
      await this.ui.alert('שמירת הסוס נכשלה: ' + (e?.message ?? 'שגיאה'), 'שגיאה');
    }
  }


  genderLabel(gender?: HorseGender): string {
    switch (gender) {
      case 'male':
        return 'זכר';
      case 'female':
        return 'נקבה';
      case 'gelding':
        return 'מסורס';
      default:
        return '—';
    }
  }

  sizeLabel(size?: HorseSize): string {
    switch (size) {
      case 'pony_small':
        return 'פוני קטן';
      case 'pony_large':
        return 'פוני גדול';
      case 'horse':
        return 'סוס';
      default:
        return '—';
    }
  }


  async loadHorseTasks(): Promise<void> {
    const horseIds = this.horses
      .map(h => h.id)
      .filter(Boolean) as string[];

    if (!horseIds.length) {
      this.tasksByHorse = {};
      return;
    }

    const { data, error } = await dbTenant()
      .from('rider_service_tasks')
      .select('*')
      .in('horse_uid', horseIds)
      .order('due_date', { ascending: false });

    if (error) {
      console.error(error);
      await this.ui.alert('שגיאה בטעינת שירותי הסוסים.', 'שגיאה');
      return;
    }

    this.tasksByHorse = {};

    for (const task of (data ?? []) as HorseServiceTask[]) {
      if (!this.tasksByHorse[task.horse_uid]) {
        this.tasksByHorse[task.horse_uid] = [];
      }

      this.tasksByHorse[task.horse_uid].push(task);
    }
  }
  async saveTask(task: HorseServiceTask): Promise<void> {
    const { error } = await dbTenant()
      .from('rider_service_tasks')
      .update({
        status: task.status,
        due_date: task.due_date,
        notes: task.notes,
        completed_at: task.status === 'completed'
          ? (task.completed_at ?? new Date().toISOString())
          : null,
        completed_by_uid: task.status === 'completed' ? task.completed_by_uid : null,
        completed_by_name: task.status === 'completed' ? task.completed_by_name : null,
        execution_note: task.status === 'completed' ? task.execution_note : null,
        cancelled_at: task.status === 'cancelled'
          ? (task.cancelled_at ?? new Date().toISOString())
          : null,
        cancelled_by_uid: task.status === 'cancelled' ? task.cancelled_by_uid : null,
        cancelled_by_name: task.status === 'cancelled' ? task.cancelled_by_name : null,
        cancellation_note: task.status === 'cancelled' ? task.cancellation_note : null,
      })
      .eq('id', task.id);

    if (error) {
      console.error(error);
      await this.ui.alert('שמירת המשימה נכשלה.', 'שגיאה');
      return;
    }

    await this.ui.alert('המשימה נשמרה בהצלחה.', 'הצלחה');
    this.closeTaskEdit();
  }
  get visibleTasksByHorse(): Record<string, HorseServiceTask[]> {
    const result: Record<string, HorseServiceTask[]> = {};

    for (const horseId of Object.keys(this.tasksByHorse)) {
      result[horseId] = this.tasksByHorse[horseId]
        .filter(t => t.status === 'open' || t.status === 'in_progress');
    }

    return result;
  }
  isTaskOverdue(task: HorseServiceTask): boolean {
    if (
      task.status !== 'open' &&
      task.status !== 'in_progress'
    ) {
      return false;
    } if (!task.due_date) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = new Date(task.due_date);
    due.setHours(0, 0, 0, 0);

    return due.getTime() < today.getTime();
  }

  taskStatusLabel(task: HorseServiceTask): string {
    if (this.isTaskOverdue(task)) return 'באיחור';

    switch (task.status) {
      case 'open': return 'פתוח';
      case 'completed': return 'בוצע';
      case 'cancelled': return 'בוטל';
      case 'in_progress': return 'בטיפול';
      default: return task.status;
    }
  }
  private async saveEditingHorseTasks(horseId: string): Promise<void> {
    const tasks = this.tasksByHorse[horseId] ?? [];

    if (!tasks.length) return;

    const updates = tasks.map(t =>
      dbTenant()
        .from('rider_service_tasks')
        .update({
          due_date: t.due_date,
          status: t.status,
          notes: t.notes,
          completed_at: t.status === 'completed'
            ? (t.completed_at ?? new Date().toISOString())
            : null,
          cancelled_at: t.status === 'cancelled'
            ? (t.cancelled_at ?? new Date().toISOString())
            : null,
          cancellation_note: t.status === 'cancelled' ? t.cancellation_note : null,
        })
        .eq('id', t.id)
    );

    const results = await Promise.all(updates);

    const failed = results.find(r => r.error);
    if (failed?.error) throw failed.error;
  }
  toggleHorseActiveStatus(): void {
    if (!this.editing) return;

    this.editing.is_active = !this.editing.is_active;
  }
  get isDeactivatingHorse(): boolean {
    if (!this.editing?.id) return false;

    const originalHorse = this.horses.find(
      h => h.id === this.editing?.id
    );

    return (
      originalHorse?.is_active === true &&
      this.editing.is_active === false
    );
  }
  get filteredHorses(): Horse[] {
    const name = this.horseNameFilter.trim().toLowerCase();

    return this.horses.filter(h => {
      const matchesTab =
        this.activeTab === 'active'
          ? h.is_active
          : !h.is_active;

      const matchesOwnership =
        this.horseOwnershipFilter === 'all'
          ? true
          : this.horseOwnershipFilter === 'farm'
            ? h.is_farm_horse
            : !h.is_farm_horse;

      const matchesOwner =
        this.horseOwnershipFilter === 'private' && this.privateOwnerFilterUid
          ? h.owner_rider_uid === this.privateOwnerFilterUid
          : true;

      const matchesName =
        this.horseNameFilter
          ? h.name === this.horseNameFilter
          : true;

      return matchesTab && matchesOwnership && matchesOwner && matchesName;
    });
  }

  get activeHorsesCount(): number {
    return this.horses.filter(h => h.is_active).length;
  }

  get inactiveHorsesCount(): number {
    return this.horses.filter(h => !h.is_active).length;
  }
  taskStatusClass(task: HorseServiceTask): string {
    if (this.isTaskOverdue(task)) return 'overdue-status';

    switch (task.status) {
      case 'open': return 'open-status';
      case 'completed': return 'completed-status';
      case 'cancelled': return 'cancelled-status';
      default: return '';
    }
  }
  async loadHorseServices(): Promise<void> {
    const horseIds = this.horses.map(h => h.id).filter(Boolean) as string[];

    if (!horseIds.length) {
      this.servicesByHorse = {};
      return;
    }

    const { data, error } = await dbTenant()
      .from('rider_services')
      .select(`
      *,
      rider_service_types (
        name,
        category
      )
    `)
      .in('horse_uid', horseIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      await this.ui.alert('שגיאה בטעינת שירותי הסוסים.', 'שגיאה');
      return;
    }

    this.servicesByHorse = {};

    for (const service of (data ?? []) as RiderService[]) {
      if (!this.servicesByHorse[service.horse_uid]) {
        this.servicesByHorse[service.horse_uid] = [];
      }

      this.servicesByHorse[service.horse_uid].push(service);
    }
  }
  serviceModeLabel(mode: string | null | undefined): string {
    switch (mode) {
      case 'once':
        return 'חד פעמי';

      case 'recurring_range':
        return 'מחזורי';

      case 'permanent':
        return 'קבוע';

      default:
        return mode ?? '—';
    }
  }
  async saveService(service: RiderService): Promise<void> {
    const { error } = await dbTenant()
      .from('rider_services')
      .update({
        start_date: service.start_date,
        end_date: service.end_date,
        status: service.status,
        price_agorot: service.price_agorot,
        notes: service.notes,
        cancellation_note: service.status === 'cancelled' ? service.cancellation_note : null,
        cancelled_at: service.status === 'cancelled'
          ? (service.cancelled_at ?? new Date().toISOString())
          : null,
        cancelled_by_uid: service.status === 'cancelled' ? service.cancelled_by_uid : null,
        cancelled_by_name: service.status === 'cancelled' ? service.cancelled_by_name : null,
      })
      .eq('id', service.id);

    if (error) {
      console.error(error);
      await this.ui.alert('שמירת השירות נכשלה.', 'שגיאה');
      return;
    }

    await this.loadHorseServices();
    await this.loadHorseTasks();
    await this.ui.alert('השירות נשמר בהצלחה.', 'הצלחה');
    this.closeServiceEdit();
  }
  get regularActiveRiders(): Rider[] {
    return this.riders.filter(r =>
      r.status === 'active' && !r.is_farm_responsible
    );
  }
  onHorseOwnershipFilterChanged(): void {
    this.horseNameFilter = '';
    this.privateOwnerFilterUid = '';
  }
  get horsesForNameFilter(): Horse[] {
    return this.horses.filter(h => {
      const matchesTab =
        this.activeTab === 'active'
          ? h.is_active
          : !h.is_active;

      const matchesOwnership =
        this.horseOwnershipFilter === 'all'
          ? true
          : this.horseOwnershipFilter === 'farm'
            ? h.is_farm_horse
            : !h.is_farm_horse;

      return matchesTab && matchesOwnership;
    });
  }
  get farmResponsibles(): Rider[] {
    return this.riders.filter(r =>
      r.status === 'active' && r.is_farm_responsible
    );
  }
  ownerTypeLabel(uid: string | null | undefined): string {
    if (!uid) return '';

    const rider = this.riders.find(r => r.uid === uid);
    if (!rider) return '';

    return rider.is_farm_responsible ? 'אחראי חווה' : 'רוכב עצמאי';
  }
  async loadPerformers(): Promise<void> {
    const db = dbTenant();
    const performers: PerformerOption[] = [];

    const { data: secretaries, error: secError } = await db
      .from('secretaries')
      .select('uid, first_name, last_name')
      .order('first_name', { ascending: true });

    if (secError) throw secError;

    for (const s of secretaries ?? []) {
      performers.push({
        uid: s.uid,
        name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.uid,
        role: 'מזכירות',
      });
    }

    const { data: riders, error: riderError } = await db
      .from('independent_riders')
      .select('uid, full_name, first_name, last_name')
      .eq('status', 'active')
      .eq('is_farm_responsible', true)
      .order('full_name', { ascending: true });

    if (riderError) throw riderError;

    for (const r of riders ?? []) {
      performers.push({
        uid: r.uid,
        name: r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.uid,
        role: 'מטעם החווה',
      });
    }

    this.performers = performers;
  }

  async loadServiceTypes(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('rider_service_types')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    this.serviceTypes = data ?? [];
  }
  cancelServiceFromHorse(service: RiderService): void {
    const ref = this.dialog.open(ServiceTaskActionDialogComponent, {
      width: '580px',
      data: {
        title: 'סיום שירות',
        message: `סיום השירות "${service.service_name}" הוא פעולה בלתי הפיכה. כל המשימות העתידיות של השירות יבוטלו והשירות יהפוך ללא פעיל. להמשיך?`,
        confirmText: 'כן, סיים שירות',
        performers: this.performers,
        defaultPerformerUid: this.currentUser?.uid || '',
        noteLabel: 'סיבת סיום שירות',
        notePlaceholder: 'אפשר לציין למה השירות הסתיים...',
      },
    });

    ref.afterClosed().subscribe(async result => {
      if (!result) return;

      service.status = 'cancelled';
      service.cancelled_at = new Date().toISOString();
      service.cancelled_by_uid = result.performerUid;
      service.cancelled_by_name = result.performerName;
      service.cancellation_note = result.note;

      await this.saveService(service);
    });
  }
  openHorseHistory(horse: Horse): void {
    this.selectedHistoryHorse = horse;
    this.historyTab = 'tasks';
    this.historyServiceTypeId = '';
    this.showHorseHistoryModal = true;
  }

  closeHorseHistory(): void {
    this.selectedHistoryHorse = null;
    this.showHorseHistoryModal = false;
  }

  historyTasks(): HorseServiceTask[] {
    if (!this.selectedHistoryHorse?.id) return [];

    let tasks = this.tasksByHorse[this.selectedHistoryHorse.id] ?? [];

    if (this.historyServiceTypeId) {
      tasks = tasks.filter(t => t.service_type_id === this.historyServiceTypeId);
    }

    return tasks;
  }

  historyServices(): RiderService[] {
    if (!this.selectedHistoryHorse?.id) return [];

    let services = this.servicesByHorse[this.selectedHistoryHorse.id] ?? [];

    if (this.historyServiceTypeId) {
      services = services.filter(s => s.service_type_id === this.historyServiceTypeId);
    }

    return services;
  }
}
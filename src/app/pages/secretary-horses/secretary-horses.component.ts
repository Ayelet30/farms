import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';
import { Router, ActivatedRoute } from '@angular/router';
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
}


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
  async ngOnInit(): Promise<void> {
    const horseId = this.route.snapshot.queryParamMap.get('horseId');
    this.returnRiderUid = this.route.snapshot.queryParamMap.get('returnRiderUid');

    await this.loadRiders();
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
      })
      .eq('id', task.id);

    if (error) {
      console.error(error);
      await this.ui.alert('שמירת המשימה נכשלה.', 'שגיאה');
      return;
    }

    await this.ui.alert('המשימה נשמרה בהצלחה.', 'הצלחה');
  }
  get visibleTasksByHorse(): Record<string, HorseServiceTask[]> {
    return this.tasksByHorse;
  }
  isTaskOverdue(task: HorseServiceTask): boolean {
    if (task.status !== 'open') return false;
    if (!task.due_date) return false;

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
      .select('*')
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
}
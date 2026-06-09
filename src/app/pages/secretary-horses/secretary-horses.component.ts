import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';
import { Router, ActivatedRoute } from '@angular/router';
type HorseGender = 'male' | 'female' | 'gelding' | null;
type HorseSize = 'pony_small' | 'pony_large' | 'horse' | null;

interface Horse {
  id?: string;
  name: string;
  age?: number | null;
  color?: string | null;

  gender?: HorseGender;
  horse_size?: HorseSize;

  max_continuous_minutes: number;
  max_daily_minutes: number;
  min_break_minutes: number;
  is_active: boolean;

  notes?: string | null;

  // פירזול
  last_shoeing_date?: string | null;
  next_shoeing_date?: string | null;
  shoeing_notes?: string | null;

  // שיניים
  last_teeth_date?: string | null;
  next_teeth_date?: string | null;

  // תוספות
  food_supplements?: string | null;
  horse_equipment?: string | null;

  // חיסונים שהיו
  last_tetanus_date?: string | null;
  last_rabies_date?: string | null;
  last_flu_date?: string | null;
  last_herpes_date?: string | null;
  last_west_nile_date?: string | null;

  // חיסונים עתידיים
  next_tetanus_date?: string | null;
  next_rabies_date?: string | null;
  next_flu_date?: string | null;
  next_herpes_date?: string | null;
  next_west_nile_date?: string | null;
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

type AlertKind =
  | 'shoeing'
  | 'teeth'
  | 'tetanus'
  | 'rabies'
  | 'flu'
  | 'herpes'
  | 'west_nile';

interface HorseAlert {
  horseId: string;
  horseName: string;
  kind: AlertKind;
  dueDate: string; // ISO
  overdue: boolean;
  daysDiff: number; // חיובי = עתיד, שלילי = איחור
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

  returnRiderUid: string | null = null;
  tasksByHorse: Record<string, HorseServiceTask[]> = {};
  activeTab: 'active' | 'inactive' = 'active';
  horses: Horse[] = [];
  editing: Horse | null = null;

  alerts: HorseAlert[] = [];
  loading = false;

  readonly ALERT_HORIZON_DAYS = 30;
  async ngOnInit(): Promise<void> {
    const horseId = this.route.snapshot.queryParamMap.get('horseId');
    this.returnRiderUid = this.route.snapshot.queryParamMap.get('returnRiderUid');


    await this.loadHorses();
    await this.loadHorseTasks();

    if (horseId) {
      const horse = this.horses.find(h => h.id === horseId);

      if (horse) {
        this.activeTab = horse.is_active ? 'active' : 'inactive';
        this.editHorse(horse);
      }
    }
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
      this.buildAlerts();
      await this.loadHorseTasks();
    } catch (e: any) {
      console.error('Failed to load horses', e);
      this.horses = [];
      this.alerts = [];
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

      max_continuous_minutes: 60,
      max_daily_minutes: 240,
      min_break_minutes: 15,
      is_active: true,
      notes: null,

      last_shoeing_date: null,
      next_shoeing_date: null,
      shoeing_notes: null,

      last_teeth_date: null,
      next_teeth_date: null,

      food_supplements: null,
      horse_equipment: null,

      last_tetanus_date: null,
      last_rabies_date: null,
      last_flu_date: null,
      last_herpes_date: null,
      last_west_nile_date: null,

      next_tetanus_date: null,
      next_rabies_date: null,
      next_flu_date: null,
      next_herpes_date: null,
      next_west_nile_date: null,
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

        max_continuous_minutes: payload.max_continuous_minutes,
        max_daily_minutes: payload.max_daily_minutes,
        min_break_minutes: payload.min_break_minutes,
        is_active: payload.is_active,
        notes: payload.notes,

        last_shoeing_date: payload.last_shoeing_date,
        next_shoeing_date: payload.next_shoeing_date,
        shoeing_notes: payload.shoeing_notes,

        last_teeth_date: payload.last_teeth_date,
        next_teeth_date: payload.next_teeth_date,

        food_supplements: payload.food_supplements,
        horse_equipment: payload.horse_equipment,

        last_tetanus_date: payload.last_tetanus_date,
        last_rabies_date: payload.last_rabies_date,
        last_flu_date: payload.last_flu_date,
        last_herpes_date: payload.last_herpes_date,
        last_west_nile_date: payload.last_west_nile_date,

        next_tetanus_date: payload.next_tetanus_date,
        next_rabies_date: payload.next_rabies_date,
        next_flu_date: payload.next_flu_date,
        next_herpes_date: payload.next_herpes_date,
        next_west_nile_date: payload.next_west_nile_date,
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

  kindLabel(kind: AlertKind): string {
    switch (kind) {
      case 'shoeing':
        return 'פרזול';
      case 'teeth':
        return 'שיניים';
      case 'tetanus':
        return 'טטנוס';
      case 'rabies':
        return 'כלבת';
      case 'flu':
        return 'שפעת';
      case 'herpes':
        return 'הרפס';
      case 'west_nile':
        return 'קדחת הנילוס';
      default:
        return kind;
    }
  }

  private parseDate(d: string | null | undefined): Date | null {
    if (!d) return null;
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  private daysBetween(a: Date, b: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    const diff = a.getTime() - b.getTime();
    return Math.round(diff / msPerDay);
  }

  private addAlertIfRelevant(
    alerts: HorseAlert[],
    horse: Horse,
    kind: AlertKind,
    dateStr?: string | null
  ): void {
    if (!horse.id) return;

    const due = this.parseDate(dateStr ?? null);
    if (!due) return;

    const today = new Date();
    const daysDiff = this.daysBetween(due, today);

    if (daysDiff > this.ALERT_HORIZON_DAYS) return;

    alerts.push({
      horseId: horse.id,
      horseName: horse.name,
      kind,
      dueDate: due.toISOString(),
      overdue: daysDiff < 0,
      daysDiff,
    });
  }

  private buildAlerts(): void {
    const alerts: HorseAlert[] = [];

    for (const h of this.horses.filter(h => h.is_active)) {
      this.addAlertIfRelevant(alerts, h, 'shoeing', h.next_shoeing_date);
      this.addAlertIfRelevant(alerts, h, 'teeth', h.next_teeth_date);

      this.addAlertIfRelevant(alerts, h, 'tetanus', h.next_tetanus_date);
      this.addAlertIfRelevant(alerts, h, 'rabies', h.next_rabies_date);
      this.addAlertIfRelevant(alerts, h, 'flu', h.next_flu_date);
      this.addAlertIfRelevant(alerts, h, 'herpes', h.next_herpes_date);
      this.addAlertIfRelevant(alerts, h, 'west_nile', h.next_west_nile_date);
    }

    this.alerts = alerts.sort((a, b) => {
      const aTime = new Date(a.dueDate).getTime();
      const bTime = new Date(b.dueDate).getTime();
      return aTime - bTime;
    });
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
    return this.horses.filter(h =>
      this.activeTab === 'active'
        ? h.is_active
        : !h.is_active
    );
  }

  get activeHorsesCount(): number {
    return this.horses.filter(h => h.is_active).length;
  }

  get inactiveHorsesCount(): number {
    return this.horses.filter(h => !h.is_active).length;
  }
}
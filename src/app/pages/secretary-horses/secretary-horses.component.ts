import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';

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

  horses: Horse[] = [];
  editing: Horse | null = null;

  alerts: HorseAlert[] = [];
  loading = false;

  readonly ALERT_HORIZON_DAYS = 30;

  async ngOnInit(): Promise<void> {
    await this.loadHorses();
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

      this.editing = null;
      await this.loadHorses();
      await this.ui.alert('הסוס נשמר בהצלחה.', 'הצלחה');
    } catch (e: any) {
      console.error('saveHorse failed', e);
      await this.ui.alert('שמירת הסוס נכשלה: ' + (e?.message ?? 'שגיאה'), 'שגיאה');
    }
  }

  async confirmDelete(horse: Horse): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'מחיקת סוס',
      message: `למחוק את הסוס "${horse.name}"?`,
      okText: 'כן, למחוק',
      cancelText: 'ביטול',
      showCancel: true,
    });

    if (!ok) return;

    if (!horse.id) {
      await this.ui.alert('לא נמצא מזהה לסוס (id).', 'שגיאה');
      return;
    }

    try {
      const { error } = await dbTenant()
        .from('horses')
        .delete()
        .eq('id', horse.id);

      if (error) throw error;

      await this.loadHorses();
      await this.ui.alert('הסוס נמחק בהצלחה.', 'הצלחה');
    } catch (e: any) {
      console.error('delete horse failed', e);
      await this.ui.alert('מחיקת הסוס נכשלה: ' + (e?.message ?? 'שגיאה'), 'שגיאה');
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

    for (const h of this.horses) {
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
}
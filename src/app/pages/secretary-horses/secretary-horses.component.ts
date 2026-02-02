import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { UiDialogService } from '../../services/ui-dialog.service';

interface Horse {
  id?: string;
  name: string;
  age?: number | null;
  color?: string | null;
  max_continuous_minutes: number;
  max_daily_minutes: number;
  min_break_minutes: number;
  is_active: boolean;
  notes?: string | null;

  last_shoeing_date?: string | null;
  next_shoeing_date?: string | null;

  last_vaccination_date?: string | null;
  next_vaccination_date?: string | null;

  last_teeth_date?: string | null;
  next_teeth_date?: string | null;
}

type AlertKind = 'shoeing' | 'vaccination' | 'teeth';

interface HorseAlert {
  horseId: string;
  horseName: string;
  kind: AlertKind;
  dueDate: string; // ISO
  overdue: boolean;
  daysDiff: number; // חיובי=עתיד, שלילי=איחור
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
      max_continuous_minutes: 60,
      max_daily_minutes: 240,
      min_break_minutes: 15,
      is_active: true,
      notes: null,

      last_shoeing_date: null,
      next_shoeing_date: null,
      last_vaccination_date: null,
      next_vaccination_date: null,
      last_teeth_date: null,
      next_teeth_date: null,
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
    if (payload.notes === undefined) payload.notes = null;

    if (!payload.max_continuous_minutes) payload.max_continuous_minutes = 60;
    if (!payload.max_daily_minutes) payload.max_daily_minutes = 240;
    if (!payload.min_break_minutes) payload.min_break_minutes = 15;

    try {
      if (payload.id) {
        const { error } = await dbTenant()
          .from('horses')
          .update({
            name: payload.name,
            age: payload.age,
            color: payload.color,
            max_continuous_minutes: payload.max_continuous_minutes,
            max_daily_minutes: payload.max_daily_minutes,
            min_break_minutes: payload.min_break_minutes,
            is_active: payload.is_active,
            notes: payload.notes,

            last_shoeing_date: payload.last_shoeing_date,
            next_shoeing_date: payload.next_shoeing_date,
            last_vaccination_date: payload.last_vaccination_date,
            next_vaccination_date: payload.next_vaccination_date,
            last_teeth_date: payload.last_teeth_date,
            next_teeth_date: payload.next_teeth_date,
          })
          .eq('id', payload.id);

        if (error) throw error;
      } else {
        const { error } = await dbTenant()
          .from('horses')
          .insert({
            name: payload.name,
            age: payload.age,
            color: payload.color,
            max_continuous_minutes: payload.max_continuous_minutes,
            max_daily_minutes: payload.max_daily_minutes,
            min_break_minutes: payload.min_break_minutes,
            is_active: payload.is_active,
            notes: payload.notes,

            last_shoeing_date: payload.last_shoeing_date,
            next_shoeing_date: payload.next_shoeing_date,
            last_vaccination_date: payload.last_vaccination_date,
            next_vaccination_date: payload.next_vaccination_date,
            last_teeth_date: payload.last_teeth_date,
            next_teeth_date: payload.next_teeth_date,
          });

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
      const { error } = await dbTenant().from('horses').delete().eq('id', horse.id);
      if (error) throw error;

      await this.loadHorses();
      await this.ui.alert('הסוס נמחק בהצלחה.', 'הצלחה');
    } catch (e: any) {
      console.error('delete horse failed', e);
      await this.ui.alert('מחיקת הסוס נכשלה: ' + (e?.message ?? 'שגיאה'), 'שגיאה');
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

  private buildAlerts(): void {
    const alerts: HorseAlert[] = [];
    const today = new Date();

    for (const h of this.horses) {
      if (!h.id) continue;

      const addAlert = (kind: AlertKind, dateStr?: string | null) => {
        const due = this.parseDate(dateStr ?? null);
        if (!due) return;

        const daysDiff = this.daysBetween(due, today);
        if (daysDiff > this.ALERT_HORIZON_DAYS) return;

        alerts.push({
          horseId: h.id!,
          horseName: h.name,
          kind,
          dueDate: due.toISOString(),
          overdue: daysDiff < 0,
          daysDiff,
        });
      };

      addAlert('shoeing', h.next_shoeing_date);
      addAlert('vaccination', h.next_vaccination_date);
      addAlert('teeth', h.next_teeth_date);
    }

    this.alerts = alerts.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }

  kindLabel(kind: AlertKind): string {
    switch (kind) {
      case 'shoeing':
        return 'פרזול';
      case 'vaccination':
        return 'חיסון';
      case 'teeth':
        return 'שיניים';
      default:
        return '';
    }
  }
}

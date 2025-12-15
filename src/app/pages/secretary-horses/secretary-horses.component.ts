import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';

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
  dueDate: string;    // ISO date string
  overdue: boolean;
  daysDiff: number;   // חיובי = ימים לעתיד, שלילי = איחור
}

@Component({
  selector: 'app-secretary-horses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-horses.component.html',
  styleUrls: ['./secretary-horses.component.scss'],
})
export class SecretaryHorsesComponent implements OnInit {
  horses: Horse[] = [];
  editing: Horse | null = null;
  horseToDelete: Horse | null = null;

  alerts: HorseAlert[] = [];

  loading = false;
  error: string | null = null;

  // 👈 כמה ימים קדימה נציג התראות
  readonly ALERT_HORIZON_DAYS = 30;

  async ngOnInit(): Promise<void> {
    await this.loadHorses();
  }

  // טעינת כל הסוסים
  async loadHorses(): Promise<void> {
    this.loading = true;
    this.error = null;

    const { data, error } = await dbTenant()
      .from('horses')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to load horses', error);
      this.error = 'אירעה שגיאה בטעינת הסוסים.';
      this.horses = [];
    } else if (data) {
      this.horses = data as Horse[];
    } else {
      this.horses = [];
    }

    this.buildAlerts(); // אחרי הטעינה

    this.loading = false;
  }

  // התחלת יצירת סוס חדש
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

  // עריכה של סוס קיים
  editHorse(horse: Horse): void {
    this.editing = { ...horse };
  }

  // ביטול עריכה
  cancelEdit(): void {
    this.editing = null;
  }

  // שמירת סוס (חדש או קיים)
  async saveHorse(): Promise<void> {
    if (!this.editing) return;

    this.error = null;

    if (!this.editing.name || !this.editing.name.trim()) {
      this.error = 'שם הסוס הוא שדה חובה.';
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

      if (error) {
        console.error('Failed to update horse', error);
        this.error = 'אירעה שגיאה בעדכון הסוס.';
        return;
      }
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

      if (error) {
        console.error('Failed to insert horse', error);
        this.error = 'אירעה שגיאה ביצירת הסוס.';
        return;
      }
    }

    this.editing = null;
    await this.loadHorses();
  }

  // פתיחת דיאלוג מחיקה
  confirmDelete(horse: Horse): void {
    this.horseToDelete = horse;
  }

  // מחיקת סוס אחרי אישור
  async deleteHorseConfirmed(): Promise<void> {
    if (!this.horseToDelete || !this.horseToDelete.id) {
      this.horseToDelete = null;
      return;
    }

    const id = this.horseToDelete.id;

    const { error } = await dbTenant()
      .from('horses')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete horse', error);
      this.error = 'אירעה שגיאה במחיקת הסוס.';
    }

    this.horseToDelete = null;
    await this.loadHorses();
  }

  // ===== התראות טיפולים =====

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

        const daysDiff = this.daysBetween(due, today); // חיובי = עתיד, שלילי = עבר

        // לא מציגים דברים רחוקים מדי
        if (daysDiff > this.ALERT_HORIZON_DAYS) return;

        const alert: HorseAlert = {
          horseId: h.id!,
          horseName: h.name,
          kind,
          dueDate: due.toISOString(),
          overdue: daysDiff < 0,
          daysDiff,
        };
        alerts.push(alert);
      };

      addAlert('shoeing', h.next_shoeing_date);
      addAlert('vaccination', h.next_vaccination_date);
      addAlert('teeth', h.next_teeth_date);
    }

    // מיון: קודם באיחור, אח"כ לפי תאריך
    this.alerts = alerts.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }

  // להמרת סוג ההתראה לטקסט יפה
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

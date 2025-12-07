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

  loading = false;
  error: string | null = null;

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
    } else if (data) {
      this.horses = data as Horse[];
    }

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
}

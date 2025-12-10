import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';

interface Arena {
  id?: string;
  name: string;
  max_riders: number;
  is_active: boolean;
  notes?: string | null;
}

@Component({
  selector: 'app-secretary-arenas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-arenas.component.html',
  styleUrls: ['./secretary-arenas.component.scss'],
})
export class SecretaryArenasComponent implements OnInit {
  arenas: Arena[] = [];
  editing: Arena | null = null;
  arenaToDelete: Arena | null = null;

  loading = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadArenas();
  }

  // טעינת כל המגרשים
  async loadArenas(): Promise<void> {
    this.loading = true;
    this.error = null;

    const { data, error } = await dbTenant()
      .from('arenas')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to load arenas', error);
      this.error = 'אירעה שגיאה בטעינת המגרשים.';
    } else if (data) {
      this.arenas = data as Arena[];
    }

    this.loading = false;
  }

  // התחלת יצירת מגרש חדש
  newArena(): void {
    this.editing = {
      name: '',
      max_riders: 1,
      is_active: true,
      notes: null,
    };
  }

  // עריכת מגרש קיים
  editArena(arena: Arena): void {
    this.editing = { ...arena };
  }

  // ביטול עריכה
  cancelEdit(): void {
    this.editing = null;
  }

  // שמירת מגרש (חדש או קיים)
  async saveArena(): Promise<void> {
    if (!this.editing) return;

    this.error = null;

    if (!this.editing.name || !this.editing.name.trim()) {
      this.error = 'שם המגרש הוא שדה חובה.';
      return;
    }

    if (!this.editing.max_riders || this.editing.max_riders < 1) {
      this.editing.max_riders = 1;
    }

    const payload: Arena = {
      ...this.editing,
      name: this.editing.name.trim(),
    };

    if (payload.notes === undefined) payload.notes = null;

    if (payload.id) {
      const { error } = await dbTenant()
        .from('arenas')
        .update({
          name: payload.name,
          max_riders: payload.max_riders,
          is_active: payload.is_active,
          notes: payload.notes,
        })
        .eq('id', payload.id);

      if (error) {
        console.error('Failed to update arena', error);
        this.error = 'אירעה שגיאה בעדכון המגרש.';
        return;
      }
    } else {
      const { error } = await dbTenant()
        .from('arenas')
        .insert({
          name: payload.name,
          max_riders: payload.max_riders,
          is_active: payload.is_active,
          notes: payload.notes,
        });

      if (error) {
        console.error('Failed to insert arena', error);
        this.error = 'אירעה שגיאה ביצירת המגרש.';
        return;
      }
    }

    this.editing = null;
    await this.loadArenas();
  }

  // פתיחת דיאלוג מחיקה
  confirmDelete(arena: Arena): void {
    this.arenaToDelete = arena;
  }

  // מחיקת מגרש אחרי אישור
  async deleteArenaConfirmed(): Promise<void> {
    if (!this.arenaToDelete || !this.arenaToDelete.id) {
      this.arenaToDelete = null;
      return;
    }

    const id = this.arenaToDelete.id;

    const { error } = await dbTenant()
      .from('arenas')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete arena', error);
      this.error = 'אירעה שגיאה במחיקת המגרש.';
    }

    this.arenaToDelete = null;
    await this.loadArenas();
  }
}

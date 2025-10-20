import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { dbTenant, getSupabaseClient } from '../../services/supabaseClient';

@Component({
  selector: 'app-note',
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatListModule,
    MatChipsModule
  ]
})
export class NoteComponent implements OnInit, AfterViewInit, OnChanges {
  @Input() child: any;
  @Output() close = new EventEmitter<void>();
  @ViewChild('scrollable') scrollable!: ElementRef;

  notes: any[] = [];
  newNote = '';
  selectedCategory = 'כללי';
  categories = ['כללי', 'רפואי', 'התנהגותי'];
  readyNotes: any[] = [];

  ngOnInit() {
    this.loadReadyNotes();
  }

  ngAfterViewInit() {
    this.resetScroll();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['child']?.currentValue) {
      this.loadNotes();
    }
  }

  onClose(): void {
    this.close.emit();
  }

  resetScroll() {
    if (this.scrollable?.nativeElement) {
      this.scrollable.nativeElement.scrollTop = 0;
    }
  }

  async loadNotes() {
    const dbc = dbTenant();
    const supabase = getSupabaseClient();
    const childId = this.child?.child_uuid || this.child?.id;
    if (!childId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;
      if (!currentUserId) return;

      const { data: notesData, error } = await dbc
        .from('list_notes')
        .select('*')
        .eq('child_id', childId)
        .eq('instructor_uid', currentUserId)
        .order('date', { ascending: false });

      if (error) {
        console.error('Error loading notes:', error);
        this.notes = [];
        return;
      }

      this.notes = notesData ?? [];

      if (!this.notes.length) {
        this.notes = [{
          id: 'demo-note',
          content: 'אין הערות עדיין.',
          date: new Date().toISOString().slice(0, 10),
          child_id: childId,
          instructor_uid: currentUserId
        }];
      }

      this.resetScroll();
    } catch (err) {
      console.error('Unexpected error loading notes:', err);
    }
  }

  async loadReadyNotes() {
    const dbc = dbTenant();
    try {
      const { data, error } = await dbc
        .from('list_notes')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.error('Error loading ready notes:', error);
        this.readyNotes = [];
        return;
      }

      this.readyNotes = data ?? [];
    } catch (err) {
      console.error('Unexpected error loading ready notes:', err);
    }
  }

  addReadyNote(note: string) {
    this.newNote = note;
  }

  selectCategory(cat: string) {
    this.selectedCategory = cat;
  }

  filteredReadyNotes() {
    return this.readyNotes.filter(rn => rn.category === this.selectedCategory);
  }

  async addNote() {
    const dbc = dbTenant();
    const supabase = getSupabaseClient();
    const childId = this.child?.child_uuid || this.child?.id;
    if (!childId || !this.newNote.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;
      if (!currentUserId) return;

      const { error } = await dbc.from('list_notes').insert([{
        content: this.newNote,
        child_id: childId,
        date: new Date().toISOString().slice(0, 10),
        id: crypto.randomUUID(),
        instructor_uid: currentUserId
      }]);

      if (error) {
        console.error('Error adding note:', error);
        return;
      }

      this.newNote = '';
      await this.loadNotes();
      this.scrollToBottom();
    } catch (err) {
      console.error('Unexpected error adding note:', err);
    }
  }

  async editNotePrompt(note: any) {
    const newContent = prompt('ערוך את ההערה:', note.content);
    if (newContent?.trim()) {
      await this.editNote(note.id, newContent);
    }
  }

  async editNote(noteId: string, newContent: string) {
    const dbc = dbTenant();
    const supabase = getSupabaseClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;
      if (!currentUserId) return;

      const { error } = await dbc.from('list_notes')
        .update({ content: newContent })
        .eq('id', noteId)
        .eq('instructor_uid', currentUserId);

      if (error) {
        console.error('Error editing note:', error);
        return;
      }

      await this.loadNotes();
    } catch (err) {
      console.error('Unexpected error editing note:', err);
    }
  }

  async deleteNote(noteId: string) {
    const dbc = dbTenant();
    const supabase = getSupabaseClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;
      if (!currentUserId) return;

      const { error } = await dbc.from('list_notes')
        .delete()
        .eq('id', noteId)
        .eq('instructor_uid', currentUserId);

      if (error) {
        console.error('Error deleting note:', error);
        return;
      }

      await this.loadNotes();
    } catch (err) {
      console.error('Unexpected error deleting note:', err);
    }
  }

  trackByNote(index: number, note: any) {
    return note.id;
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  scrollToBottom() {
    const notesContainer = document.querySelector('.notes-scroll');
    if (notesContainer) {
      notesContainer.scrollTop = notesContainer.scrollHeight;
    }
  }
}

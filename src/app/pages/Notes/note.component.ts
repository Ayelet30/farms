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
import { CommonModule, NgIf, NgForOf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { db } from '../../services/supabaseClient';

@Component({
  selector: 'app-note',
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    NgIf,
    NgForOf,
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
  noteType = 'כללי';
  selectedFile: File | null = null;

  ngOnInit() {}

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
    const childId = this.child?.child_uuid || this.child?.id;
    if (!childId) return;

    try {
      const { data: notesData, error } = await db()
        .from('notes')
        .select('*')
        .eq('child_id', childId)
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
          instructor_uid: 'demo'
        }];
      }
      this.resetScroll();
    } catch (err) {
      console.error('Unexpected error loading notes:', err);
    }
  }

  async addNote() {
    const childId = this.child?.child_uuid || this.child?.id;
    if (!this.newNote.trim() || !childId) return;

    try {
      await db().from('notes').insert([{
        content: this.newNote,
        child_id: childId,
        date: new Date().toISOString().slice(0, 10),
        id: crypto.randomUUID()
      }]);
      this.newNote = '';
      this.selectedFile = null;
      this.noteType = 'כללי';
      await this.loadNotes();
    } catch (err) {
      console.error('Error adding note:', err);
    }
  }

  async deleteNote(noteId: string) {
    try {
      const { error } = await db().from('notes').delete().eq('id', noteId);
      if (!error) await this.loadNotes();
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  }

  async editNotePrompt(note: any) {
    const newContent = prompt('ערוך את ההערה:', note.content);
    if (newContent?.trim()) {
      await this.editNote(note.id, newContent);
    }
  }

  async editNote(noteId: string, newContent: string) {
    try {
      const { error } = await db()
        .from('notes')
        .update({ content: newContent })
        .eq('id', noteId);
      if (!error) await this.loadNotes();
    } catch (err) {
      console.error('Error editing note:', err);
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
}

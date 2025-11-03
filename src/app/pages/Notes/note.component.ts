import {
  Component, Input, Output, EventEmitter, OnInit,
  ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges
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
<<<<<<< HEAD
import { dbTenant, getSupabaseClient, getCurrentUserDetails } from '../../services/supabaseClient.service';

type UUID = string;
type Category = 'general' | 'medical' | 'behavioral';

interface NoteVM {
  id: string | number;
  display_text: string;
  created_at?: string | null;
  instructor_uid?: string | null;
  instructor_name?: string | null;
  category: Category;
  isEditing?: boolean;
}

interface ReadyNote {
  id: number | string;
  content: string;
}
=======
import { db } from '../../services/supabaseClient.service';
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452

@Component({
  selector: 'app-note',
  standalone: true,
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
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
[x: string]: any;
  @Input() child: any;
  @Input() occurrence: any;
  @Output() close = new EventEmitter<void>();
  @ViewChild('scrollable') scrollable!: ElementRef<HTMLDivElement>;

  private dbc = dbTenant();
  private sb = getSupabaseClient();

  notesGeneral: NoteVM[] = [];
  notesMedical: NoteVM[] = [];
  notesBehavioral: NoteVM[] = [];
  readyNotes: ReadyNote[] = [];

  newNote = '';
<<<<<<< HEAD
  selectedCategory: Category = 'general';
  categories: Category[] = ['general', 'medical', 'behavioral'];
=======
  noteType = 'כללי';
  selectedFile: File | null = null;
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452

  ngOnInit() {}

  ngAfterViewInit() {
    if (this.scrollable?.nativeElement)
      this.scrollable.nativeElement.scrollTop = 0;
  }

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['child']?.currentValue) await this.loadNotes();
  }

  onClose() { this.close.emit(); }
  onBackdropClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.onClose();
  }

  trackByNote(_: number, n: NoteVM) { return n.id; }
  trackByReady(_: number, r: ReadyNote) { return r.id; }

  getCategoryLabel(cat: Category): string {
    switch (cat) {
      case 'medical': return 'רפואי';
      case 'behavioral': return 'התנהגותי';
      default: return 'כללי';
    }
  }

  /** טעינת הערות מהשרת */
  async loadNotes() {
<<<<<<< HEAD
    try {
      const childId = this.child?.child_uuid;
      if (!childId) return;
      this.loadingNotes = true;

      const { data, error } = await this.dbc
        .from('notes')
        .select('id, content, instructor_uid, instructor_name, date, category')
=======
    const childId = this.child?.child_uuid || this.child?.id;
    if (!childId) return;

    try {
      const { data: notesData, error } = await db()
        .from('notes')
        .select('*')
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
        .eq('child_id', childId)
        .order('date', { ascending: false });

      if (error) {
        console.error('Error loading notes:', error);
        this.notes = [];
        return;
      }

<<<<<<< HEAD
      const notes = (data ?? []).map((n: any) => ({
        id: n.id,
        display_text: n.content,
        created_at: n.date ?? null,
        instructor_uid: n.instructor_uid ?? null,
        instructor_name: n.instructor_name ?? '—',
        category: (n.category ?? 'general') as Category,
        isEditing: false
      })) as NoteVM[];

      this.notesGeneral = notes.filter(n => n.category === 'general');
      this.notesMedical = notes.filter(n => n.category === 'medical');
      this.notesBehavioral = notes.filter(n => n.category === 'behavioral');
=======
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
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
    } catch (err) {
      console.error('💥 Error loading notes:', err);
      this.notesGeneral = this.notesMedical = this.notesBehavioral = [];
    } finally {
      this.loadingNotes = false;
    }
  }

  /** הוספת הערה חדשה עם תאריך עדכני */
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

<<<<<<< HEAD
  filteredReadyNotes() {
    return this.readyNotes;
  }

  addReadyNote(content: string) {
    this.newNote = content;
  }

  /** הוספת הערה חדשה */
  async addNote() {
    const childId = this.child?.child_uuid;
    const content = this.newNote.trim();
    if (!childId || !content) return;

    try {
      const instructor = await getCurrentUserDetails('uid, full_name, id_number');
      if (!instructor?.uid) {
        console.warn('⚠️ No instructor session found');
        return;
      }

      const now = new Date().toISOString();
      const newNoteObj: NoteVM = {
        id: crypto.randomUUID(),
        display_text: content,
        created_at: now,
        instructor_uid: instructor.uid,
        instructor_name: instructor.full_name ?? '—',
        category: this.selectedCategory
      };

      const { error } = await this.dbc
        .from('notes')
        .insert([{
          id: newNoteObj.id,
          child_id: childId,
          content,
          date: now,
          instructor_uid: newNoteObj.instructor_uid,
          instructor_name: newNoteObj.instructor_name,
          category: this.selectedCategory
        }]);

      if (error) throw error;

      if (this.selectedCategory === 'general')
        this.notesGeneral.unshift(newNoteObj);
      else if (this.selectedCategory === 'medical')
        this.notesMedical.unshift(newNoteObj);
      else
        this.notesBehavioral.unshift(newNoteObj);

      this.newNote = '';
=======
  async deleteNote(noteId: string) {
    try {
      const { error } = await db().from('notes').delete().eq('id', noteId);
      if (!error) await this.loadNotes();
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  }

  startEdit(note: NoteVM) { note.isEditing = true; }

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

<<<<<<< HEAD
  async deleteNote(noteId: string | number) {
    try {
      const { error } = await this.dbc
        .from('notes')
        .delete()
        .eq('id', noteId);
      if (error) throw error;

      this.notesGeneral = this.notesGeneral.filter(n => n.id !== noteId);
      this.notesMedical = this.notesMedical.filter(n => n.id !== noteId);
      this.notesBehavioral = this.notesBehavioral.filter(n => n.id !== noteId);
    } catch (err) {
      console.error('💥 Failed to delete note:', err);
=======
  trackByNote(index: number, note: any) {
    return note.id;
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
>>>>>>> dd12ecf4abe02ff5a0c704f495a047bc80f0f452
    }
  }
}

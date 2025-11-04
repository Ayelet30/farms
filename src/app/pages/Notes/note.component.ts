import {
  Component, Input, Output, EventEmitter, OnInit,
  ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges
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
import { dbTenant, getSupabaseClient } from '../../services/legacy-compat';

type NoteVM = {
  id: string | number;
  display_text: string;
  created_at?: string | null;
  instructor_uid?: string | null;
  category: 'general' | 'medical' | 'behavioral';
  isEditing?: boolean;
};

type ReadyNote = { id: number | string; content: string };

@Component({
  selector: 'app-note',
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatListModule, MatChipsModule
  ]
})
export class NoteComponent implements OnInit, AfterViewInit, OnChanges {
  @Input() child: any;
  @Input() occurrence: any;
  @Output() close = new EventEmitter<void>();
  @ViewChild('scrollable') scrollable!: ElementRef<HTMLDivElement>;

  private dbc = dbTenant();
  private sb = getSupabaseClient();

  // רשימות נפרדות
  notesGeneral: NoteVM[] = [];
  notesMedical: NoteVM[] = [];
  notesBehavioral: NoteVM[] = [];

  readyNotes: ReadyNote[] = [];
  newNote = '';
  selectedCategory: 'general' = 'general';

  loadingNotes = false;
  loadingReady = false;

  async ngOnInit() {
    await this.loadReadyNotes();
    await this.loadNotes();
  }

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

  /** טעינת הערות מהשרת */
  async loadNotes() {
    try {
      const childId = this.child?.child_uuid;
      if (!childId) return;

      this.loadingNotes = true;
      const { data, error } = await this.dbc
        .from('notes')
        .select('id, content, instructor_uid, date, category')
        .eq('child_id', childId)
        .order('date', { ascending: false });

      if (error) throw error;

      const notes = (data ?? []).map((n: any) => ({
        id: n.id,
        display_text: n.content,
        created_at: n.date ?? null,
        instructor_uid: n.instructor_uid ?? null,
        category: n.category ?? 'general',
        isEditing: false
      })) as NoteVM[];

      this.notesGeneral = notes.filter(n => n.category === 'general');
      this.notesMedical = notes.filter(n => n.category === 'medical');
      this.notesBehavioral = notes.filter(n => n.category === 'behavioral');
    } catch (err) {
      console.error('💥 Error loading notes:', err);
      this.notesGeneral = this.notesMedical = this.notesBehavioral = [];
    } finally {
      this.loadingNotes = false;
    }
  }

  /** טעינת הערות מוכנות */
  async loadReadyNotes() {
    this.loadingReady = true;
    try {
      const { data, error } = await this.dbc
        .from('list_notes')
        .select('id, note');
      if (error) throw error;
      this.readyNotes = (data ?? []).map((r: any) => ({
        id: r.id,
        content: r.note ?? ''
      }));
    } catch (err) {
      console.error('💥 Error loading ready notes:', err);
    } finally {
      this.loadingReady = false;
    }
  }

  filteredReadyNotes() {
    return this.readyNotes;
  }

  addReadyNote(content: string) {
    this.newNote = content;
  }

  /** הוספת הערה חדשה עם תאריך עדכני */
  async addNote() {
    const childId = this.child?.child_uuid;
    const content = this.newNote.trim();
    if (!childId || !content) return;

    const now = new Date().toISOString();
    const newNoteObj: NoteVM = {
      id: crypto.randomUUID(),
      display_text: content,
      created_at: now,
      instructor_uid: (await this.sb.auth.getSession()).data?.session?.user?.id ?? null,
      category: 'general'
    };

    try {
      const { error } = await this.dbc
        .from('notes')
        .insert([{
          id: newNoteObj.id,
          child_id: childId,
          content,
          date: now,
          instructor_uid: newNoteObj.instructor_uid,
          category: 'general'
        }]);

      if (error) throw error;

      // מוסיף מקומית את ההערה עם התאריך המעודכן בלי לרענן הכול
      this.notesGeneral.unshift(newNoteObj);
      this.newNote = '';
    } catch (err) {
      console.error('💥 Failed to save note:', err);
    }
  }

  startEdit(note: NoteVM) {
    note.isEditing = true;
  }

  async saveEdit(note: NoteVM) {
    try {
      const { error } = await this.dbc
        .from('notes')
        .update({ content: note.display_text })
        .eq('id', note.id);
      if (error) throw error;
      note.isEditing = false;
    } catch (err) {
      console.error('💥 Failed to edit note:', err);
    }
  }

  async deleteNote(noteId: string | number) {
    try {
      const { error } = await this.dbc
        .from('notes')
        .delete()
        .eq('id', noteId);
      if (error) throw error;
      this.notesGeneral = this.notesGeneral.filter(n => n.id !== noteId);
    } catch (err) {
      console.error('💥 Failed to delete note:', err);
    }
  }
}

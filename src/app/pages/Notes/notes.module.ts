import {
  Component, Input, Output, EventEmitter, OnInit,
  ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges, inject
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
import { dbTenant, getSupabaseClient } from '../../services/supabaseClient.service';
 
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
  @Output() close = new EventEmitter<void>();
  @ViewChild('scrollable') scrollable!: ElementRef<HTMLDivElement>;
 
  private dbc = dbTenant();
  private sb  = getSupabaseClient();
 
  notes: Array<{ id: string; content: string; date: string; child_id: string; instructor_uid: string }> = [];
  readyNotes: Array<{ id: string; content: string; category: string }> = [];
 
  newNote = '';
  selectedCategory = 'כללי';
  categories = ['כללי', 'רפואי', 'התנהגותי'];
 
  ngOnInit() {
    this.loadReadyNotes();
  }
 
  ngAfterViewInit() {
    this.resetScrollTop();
  }
 
  ngOnChanges(changes: SimpleChanges) {
    if (changes['child']?.currentValue) {
      this.loadNotes();
    }
  }
 
  onClose() { this.close.emit(); }
 
  private resetScrollTop() {
    this.scrollable?.nativeElement && (this.scrollable.nativeElement.scrollTop = 0);
  }
 
  private async currentUserId() {
    const { data: { user } } = await this.sb.auth.getUser();
    return user?.id ?? null;
  }
 
  async loadNotes() {
    const childId = this.child?.child_uuid || this.child?.uid;
    if (!childId) { this.notes = []; return; }
 
    try {
      const me = await this.currentUserId();
      if (!me) { this.notes = []; return; }
 
      const { data, error } = await this.dbc
        .from('list_notes')
        .select('id, content, date, child_id, instructor_uid')
        .eq('child_id', childId)
        .eq('instructor_uid', me)
        .order('date', { ascending: false });
 
      if (error) throw error;
 
      this.notes = (data ?? []) as any[];
 
      if (!this.notes.length) {
        // הודעת דיפולט ידידותית (לא נשמרת ב־DB)
        this.notes = [{
          id: 'placeholder',
          content: 'אין הערות עדיין.',
          date: new Date().toISOString().slice(0, 10),
          child_id: childId,
          instructor_uid: me
        }];
      }
 
      this.resetScrollTop();
    } catch (e) {
      console.error('Error loading notes', e);
      this.notes = [];
    }
  }
 
  async loadReadyNotes() {
    try {
      // אם יש טבלת ready_notes – נעדיף אותה; אחרת fallback ל-list_notes (קטגוריות חייבות להיות קיימות)
      let data: any[] | null = null;
 
      const tryReady = await this.dbc.from('ready_notes').select('id, content, category').order('id', { ascending: true });
      if (!tryReady.error) {
        data = tryReady.data ?? [];
      } else {
        const fallback = await this.dbc.from('list_notes').select('id, content, category').order('id', { ascending: true });
        if (!fallback.error) data = fallback.data ?? [];
      }
 
      this.readyNotes = data ?? [];
    } catch (e) {
      console.error('Error loading ready notes', e);
      this.readyNotes = [];
    }
  }
 
  selectCategory(cat: string) { this.selectedCategory = cat; }
  filteredReadyNotes() { return this.readyNotes.filter(r => r.category === this.selectedCategory); }
  addReadyNote(content: string) { this.newNote = content; }
 
  async addNote() {
    const childId = this.child?.child_uuid || this.child?.id;
    if (!childId) return;
 
    const content = this.newNote.trim();
    if (!content) return;
 
    try {
      const me = await this.currentUserId();
      if (!me) return;
 
      const { error } = await this.dbc.from('list_notes').insert([{
        id: crypto.randomUUID(),
        content,
        child_id: childId,
        date: new Date().toISOString().slice(0, 10),
        instructor_uid: me
      }]);
 
      if (error) throw error;
 
      this.newNote = '';
      await this.loadNotes();
      this.scrollToBottom();
    } catch (e) {
      console.error('Error adding note', e);
    }
  }
 
  async editNotePrompt(note: any) {
    const val = prompt('ערוך את ההערה:', note.content);
    if (val && val.trim()) await this.editNote(note.id, val.trim());
  }
 
  private async editNote(id: string, content: string) {
    try {
      const me = await this.currentUserId();
      if (!me) return;
 
      const { error } = await this.dbc
        .from('list_notes')
        .update({ content })
        .eq('id', id)
        .eq('instructor_uid', me);
 
      if (error) throw error;
 
      await this.loadNotes();
    } catch (e) {
      console.error('Error editing note', e);
    }
  }
 
  async deleteNote(id: string) {
    try {
      const me = await this.currentUserId();
      if (!me) return;
 
      const { error } = await this.dbc
        .from('list_notes')
        .delete()
        .eq('id', id)
        .eq('instructor_uid', me);
 
      if (error) throw error;
 
      await this.loadNotes();
    } catch (e) {
      console.error('Error deleting note', e);
    }
  }
 
  trackByNote = (_: number, n: any) => n.id;
 
  onBackdropClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.onClose();
  }
 
  private scrollToBottom() {
    const el = document.querySelector('.notes-scroll') as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
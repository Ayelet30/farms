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
  SimpleChanges,
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

import {
  dbTenant,
  getSupabaseClient,
  getCurrentUserDetails,
} from '../../services/legacy-compat';

type Category = 'general' | 'medical' | 'behavioral';
type AttendanceStatus = 'present' | 'absent' | null;
type RoleInTenant =
  | 'parent'
  | 'instructor'
  | 'secretary'
  | 'manager'
  | 'admin'
  | 'coordinator';

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

@Component({
  selector: 'app-note',
  standalone: true,
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
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
    MatChipsModule,
  ],
})
export class NoteComponent implements OnInit, AfterViewInit, OnChanges {
  @Input() child: any;
  @Input() occurrence: any;

  @Input() attendanceStatus: AttendanceStatus = null;

  @Input() role: RoleInTenant | null = null;

  @Input() enforceNoteForPresence = true;

  @Output() attendanceChange = new EventEmitter<AttendanceStatus>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('scrollable') scrollable!: ElementRef<HTMLDivElement>;

  private dbc = dbTenant();
  private sb = getSupabaseClient();

  notesGeneral: NoteVM[] = [];
  notesMedical: NoteVM[] = [];
  notesBehavioral: NoteVM[] = [];

  readyNotes: ReadyNote[] = [];

  newNote = '';
  selectedCategory: Category = 'general';

  mustChooseAttendance = false;
  mustFillNoteForPresent = false;

  get canEditNotes(): boolean {
    if (!this.role) return true;
    return this.role === 'instructor' || this.role === 'secretary';
  }

  // ----------------------------------------------------------
  // INIT + DEBUG
  // ----------------------------------------------------------
  async ngOnInit() {

    console.log('%c[INIT] START DEBUG OCCURRENCE', 'color: orange; font-size: 16px; font-weight: bold;');

    console.log('%c[INIT] occurrence object →', 'color: purple; font-weight:bold;', this.occurrence);

    if (this.occurrence) {
      console.log('%c[INIT] occurrence keys →', 'color: brown; font-weight:bold;', Object.keys(this.occurrence));

      console.log('%c[INIT] occurrence.lesson_id →', 'color: red; font-size:14px;', this.occurrence.lesson_id);
      console.log('%c[INIT] occurrence.id →', 'color: red;', this.occurrence.id);
      console.log('%c[INIT] occurrence.lesson?.id →', 'color: red;', this.occurrence?.lesson?.id);
      console.log('%c[INIT] occurrence.extendedProps →', 'color: blue;', this.occurrence.extendedProps);
      console.log('%c[INIT] extendedProps.lesson_id →', 'color: blue;', this.occurrence?.extendedProps?.lesson_id);
    }

    console.log('%c[INIT] END DEBUG OCCURRENCE', 'color: orange; font-size: 16px; font-weight: bold;');

    await this.loadReadyNotes();
    await this.loadNotes();
    await this.loadAttendance();
    this.recalcPresenceFlags();
  }

  ngAfterViewInit() {
    if (this.scrollable?.nativeElement) {
      this.scrollable.nativeElement.scrollTop = 0;
    }
  }

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['child']?.currentValue) {
      await this.loadNotes();
      await this.loadAttendance();
    }
    if (changes['attendanceStatus']) {
      this.recalcPresenceFlags();
    }
  }

  // ----------------------------------------------------------
  // CLOSE LOGIC
  // ----------------------------------------------------------
  onClose() {
    if (this.enforceNoteForPresence && !this.attendanceStatus) {
      this.mustChooseAttendance = true;
      this.mustFillNoteForPresent = false;
      return;
    }

    if (
      this.enforceNoteForPresence &&
      this.attendanceStatus === 'present' &&
      !this.hasAnyNote()
    ) {
      this.mustChooseAttendance = false;
      this.mustFillNoteForPresent = true;
      return;
    }

    this.mustChooseAttendance = false;
    this.mustFillNoteForPresent = false;
    this.close.emit();
  }

  onBackdropClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.onClose();
  }

  // ----------------------------------------------------------
  // ATTENDANCE CLICK + DEBUG
  // ----------------------------------------------------------
  async setAttendance(status: AttendanceStatus) {
    if (!this.canEditNotes) return;

    console.log('%c[CLICK] setAttendance called with:', 'color: green; font-weight:bold;', status);

    this.attendanceStatus = status;
    this.attendanceChange.emit(status);

    await this.saveAttendance(status);

    this.recalcPresenceFlags();
  }

  private recalcPresenceFlags() {
    if (!this.enforceNoteForPresence) {
      this.mustChooseAttendance = false;
      this.mustFillNoteForPresent = false;
      return;
    }

    this.mustChooseAttendance = !this.attendanceStatus;
    this.mustFillNoteForPresent = this.attendanceStatus === 'present' && !this.hasAnyNote();
  }

  private hasAnyNote(): boolean {
    return (
      this.notesGeneral.length > 0 ||
      this.notesMedical.length > 0 ||
      this.notesBehavioral.length > 0
    );
  }

  // ----------------------------------------------------------
  // SAVE ATTENDANCE + DEBUG
  // ----------------------------------------------------------
  async saveAttendance(status: AttendanceStatus) {
    if (!this.child || !this.occurrence) {
      console.log('%c[SAVE] Missing child or occurrence → abort', 'color:red;');
      return;
    }

    const present = status === 'present';

    console.log('%c[SAVE] status received =', 'color: blue;', status);
    console.log('%c[SAVE] converted present =', 'color: blue; font-weight:bold;', present);

    console.log('%c[SAVE] child_id =', 'color: blue;', this.child.child_uuid);
    console.log('%c[SAVE] occurrence.lesson_id =', 'color: blue;', this.occurrence.lesson_id);

    try {
      const { data: existing } = await this.dbc
        .from('attendance')
        .select('id')
        .eq('child_id', this.child.child_uuid)
        .eq('activity_id', this.occurrence.lesson_id)
        .maybeSingle();

      console.log('%c[SAVE] existing attendance row:', 'color: teal;', existing);

      if (existing) {
        console.log('%c[SAVE] Updating existing row', 'color: orange; font-weight:bold;');
        await this.dbc.from('attendance').update({ present }).eq('id', existing.id);
      } else {
        console.log('%c[SAVE] Creating new row', 'color: orange; font-weight:bold;');
        await this.dbc.from('attendance').insert([
          {
            id: crypto.randomUUID(),
            child_id: this.child.child_uuid,
            activity_id: this.occurrence.lesson_id,
            present,
          },
        ]);
      }

      console.log('%c[SAVE] DONE', 'color: green; font-weight:bold;');
    } catch (err) {
      console.error('[SAVE] Attendance update failed:', err);
    }
  }

  // ----------------------------------------------------------
  // LOAD ATTENDANCE + DEBUG
  // ----------------------------------------------------------
  async loadAttendance() {
    if (!this.child || !this.occurrence) return;

    console.log('%c[LOAD] loading attendance for:', 'color: brown;', this.child.child_uuid, this.occurrence.lesson_id);

    try {
      const { data } = await this.dbc
        .from('attendance')
        .select('present')
        .eq('child_id', this.child.child_uuid)
        .eq('activity_id', this.occurrence.lesson_id)
        .maybeSingle();

      console.log('%c[LOAD] attendance row =', 'color: brown;', data);

      if (data) {
        this.attendanceStatus = data.present ? 'present' : 'absent';
      }
    } catch (err) {
      console.error('[LOAD] Attendance load failed:', err);
    }
  }

  // ----------------------------------------------------------
  // NOTES LOADING ETC.
  // ----------------------------------------------------------
  async loadNotes() {
    try {
      const childId = this.child?.child_uuid;
      if (!childId) return;

      const { data, error } = await this.dbc
        .from('notes')
        .select('id, content, instructor_uid, instructor_name, date, category')
        .eq('child_id', childId)
        .order('date', { ascending: false });

      if (error) throw error;

      const notes = (data ?? []).map((n: any) => ({
        id: n.id,
        display_text: n.content,
        created_at: n.date,
        instructor_uid: n.instructor_uid,
        instructor_name: n.instructor_name ?? '—',
        category: (n.category ?? 'general') as Category,
        isEditing: false,
      }));

      this.notesGeneral = notes.filter((n: { category: string; }) => n.category === 'general');
      this.notesMedical = notes.filter((n: { category: string; }) => n.category === 'medical');
      this.notesBehavioral = notes.filter((n: { category: string; }) => n.category === 'behavioral');

      this.recalcPresenceFlags();
    } catch (err) {
      console.error('Error loading notes:', err);
    }
  }

  async loadReadyNotes() {
    try {
      const { data, error } = await this.dbc.from('list_notes').select('id, note');
      if (error) throw error;

      this.readyNotes = (data ?? []).map((r: any) => ({
        id: r.id,
        content: r.note,
      }));
    } catch (err) {
      console.error('Error loading ready notes:', err);
    }
  }

  filteredReadyNotes() {
    return this.readyNotes;
  }

  addReadyNote(content: string) {
    if (!this.canEditNotes) return;
    this.newNote = content;
  }

  async addNote() {
    if (!this.canEditNotes) return;

    const content = this.newNote.trim();
    const childId = this.child?.child_uuid;
    if (!content || !childId) return;

    try {
      const instructor = await getCurrentUserDetails('uid, first_name, last_name');
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      const newNote: NoteVM = {
        id,
        display_text: content,
        created_at: now,
        instructor_uid: instructor?.uid,
        instructor_name: `${instructor?.first_name ?? ''} ${instructor?.last_name ?? ''}`.trim(),
        category: this.selectedCategory,
      };

      const { error } = await this.dbc.from('notes').insert([
        {
          id,
          child_id: childId,
          content,
          date: now,
          instructor_uid: newNote.instructor_uid,
          instructor_name: newNote.instructor_name,
          category: this.selectedCategory,
        },
      ]);

      if (error) throw error;

      if (this.selectedCategory === 'general') this.notesGeneral.unshift(newNote);
      else if (this.selectedCategory === 'medical') this.notesMedical.unshift(newNote);
      else this.notesBehavioral.unshift(newNote);

      this.newNote = '';
      this.recalcPresenceFlags();
    } catch (err) {
      console.error('Create note failed:', err);
    }
  }

  startEdit(note: NoteVM) {
    if (!this.canEditNotes) return;
    note.isEditing = true;
  }

  async saveEdit(note: NoteVM) {
    if (!this.canEditNotes) return;

    try {
      const { error } = await this.dbc.from('notes').update({ content: note.display_text }).eq('id', note.id);
      if (error) throw error;

      note.isEditing = false;
    } catch (err) {
      console.error('Edit note failed:', err);
    }
  }

  async deleteNote(noteId: string | number) {
    if (!this.canEditNotes) return;

    try {
      const { error } = await this.dbc.from('notes').delete().eq('id', noteId);
      if (error) throw error;

      this.notesGeneral = this.notesGeneral.filter((n) => n.id !== noteId);
      this.notesMedical = this.notesMedical.filter((n) => n.id !== noteId);
      this.notesBehavioral = this.notesBehavioral.filter((n) => n.id !== noteId);

      this.recalcPresenceFlags();
    } catch (err) {
      console.error('Delete note failed:', err);
    }
  }

  // ----------------------------------------------------------
  // TRACK BY
  // ----------------------------------------------------------
  trackByReady(index: number, item: ReadyNote) {
    return item.id;
  }

  trackByNote(index: number, item: NoteVM) {
    return item.id;
  }
}

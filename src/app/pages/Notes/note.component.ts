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

interface LessonDetails {
  lesson_id: string;
  start_time?: string | null;
  end_time?: string | null;
  lesson_type?: string | null;
  status?: string | null;
  horse_id?: string | null;
  horse_name?: string | null;
  arena_id?: string | null;
  arena_name?: string | null;
}

interface HorseOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface ArenaOption {
  id: string;
  name: string;
  isActive: boolean;
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

  notesGeneral: NoteVM[] = [];
  notesMedical: NoteVM[] = [];
  notesBehavioral: NoteVM[] = [];
  readyNotes: ReadyNote[] = [];

  newNote = '';
  selectedCategory: Category = 'general';

  mustChooseAttendance = false;
  mustFillNoteForPresent = false;

  lessonDetails: LessonDetails | null = null;

  horses: HorseOption[] = [];
  arenas: ArenaOption[] = [];

  // ------------ PERMISSIONS ------------
  get canEditNotes(): boolean {
    return this.role === 'instructor' || this.role === 'secretary';
  }

  get canEditLessonResources(): boolean {
    return this.role === 'instructor' || this.role === 'secretary';
  }

  // ------------ HELPERS ------------
  getTimeString(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 5);
    return '';
  }

  private extractDate(raw: any): string | null {
    if (!raw) return null;

    if (typeof raw === 'string') {
      return raw.substring(0, 10);
    }

    if (raw instanceof Date) {
      return raw.toISOString().substring(0, 10);
    }

    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
    } catch {}

    return null;
  }

  private getOccurrenceDateForDb(): string | null {
    return this.extractDate(
      this.occurrence?.occur_date ||
        this.occurrence?.date ||
        this.occurrence?.start ||
        this.occurrence?.start_time
    );
  }

  // ------------ INIT ------------
  async ngOnInit() {
    await this.loadReadyNotes();
    await this.loadNotes();
    await this.loadHorses();
    await this.loadArenas();
    await this.loadLessonDetails();
    this.recalcPresenceFlags();
  }

  ngAfterViewInit() {
    if (this.scrollable?.nativeElement) {
      this.scrollable.nativeElement.scrollTop = 0;
    }
  }

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['occurrence'] && !changes['occurrence'].firstChange) {
      console.log('Occurrence changed → Reload lesson details');
      await this.loadLessonDetails();
    }

    if (changes['child'] && !changes['child'].firstChange) {
      await this.loadNotes();
    }

    if (changes['attendanceStatus'] && !changes['attendanceStatus'].firstChange) {
      this.recalcPresenceFlags();
    }
  }

  // ------------ LOAD LESSON DETAILS ------------
  async loadLessonDetails() {
    console.log('[OCCURRENCE RECEIVED]', this.occurrence);

    this.lessonDetails = null;

    const lessonId = this.occurrence?.lesson_id;
    const occurDate = this.getOccurrenceDateForDb();

    console.log('[OCCURRENCE DATE]', occurDate);

    if (!lessonId || !occurDate) return;

    try {
      const { data: rows } = await this.dbc
        .from('lessons_with_children')
        .select('lesson_id, start_time, end_time, lesson_type, status')
        .eq('lesson_id', lessonId)
        .limit(1);

      const base = rows?.[0] ?? null;
      if (!base) return;

      const { data: res } = await this.dbc
        .from('lesson_resources')
        .select('horse_id, arena_id')
        .eq('lesson_id', lessonId)
        .eq('occur_date', occurDate)
        .limit(1);

      const horseId = res?.[0]?.horse_id ?? null;
      const arenaId = res?.[0]?.arena_id ?? null;

      let horseName: string | null = null;
      let arenaName: string | null = null;

      if (horseId) {
        const { data } = await this.dbc
          .from('horses')
          .select('name')
          .eq('id', horseId)
          .limit(1);

        horseName = data?.[0]?.name ?? null;
      }

      if (arenaId) {
        const { data } = await this.dbc
          .from('arenas')
          .select('name')
          .eq('id', arenaId)
          .limit(1);

        arenaName = data?.[0]?.name ?? null;
      }

      this.lessonDetails = {
        lesson_id: lessonId,
        start_time: base.start_time ?? null,
        end_time: base.end_time ?? null,
        lesson_type: base.lesson_type ?? null,
        status: base.status ?? null,
        horse_id: horseId,
        horse_name: horseName,
        arena_id: arenaId,
        arena_name: arenaName,
      };

      console.log('[LESSON DETAILS LOADED]', this.lessonDetails);
    } catch (err) {
      console.error('loadLessonDetails failed:', err);
    }
  }

  // ------------ HORSES + ARENAS ------------
  async loadHorses() {
    const { data } = await this.dbc.from('horses').select('id, name, is_active');

    this.horses = (data ?? []).map((h: { id: any; name: any; is_active: any; }) => ({
      id: h.id,
      name: h.name,
      isActive: h.is_active,
    }));
  }

  async loadArenas() {
    const { data } = await this.dbc.from('arenas').select('id, name, is_active');

    this.arenas = (data ?? []).map((a: { id: any; name: any; is_active: any; }) => ({
      id: a.id,
      name: a.name,
      isActive: a.is_active,
    }));
  }

  // ------------ UPDATE HORSE ------------
  async onHorseChange(newHorseId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const lessonId = this.lessonDetails.lesson_id;
    const occurDate = this.getOccurrenceDateForDb();
    if (!lessonId || !occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: lessonId,
        occur_date: occurDate,
        horse_id: newHorseId,
        arena_id: this.lessonDetails.arena_id ?? null,
      },
      { onConflict: 'lesson_id,occur_date' }
    );

    const horse = this.horses.find(h => h.id === newHorseId);

    this.lessonDetails.horse_id = newHorseId;
    this.lessonDetails.horse_name = horse?.name ?? null;
  }

  // ------------ UPDATE ARENA ------------
  async onArenaChange(newArenaId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const lessonId = this.lessonDetails.lesson_id;
    const occurDate = this.getOccurrenceDateForDb();
    if (!lessonId || !occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: lessonId,
        occur_date: occurDate,
        horse_id: this.lessonDetails.horse_id ?? null,
        arena_id: newArenaId,
      },
      { onConflict: 'lesson_id,occur_date' }
    );

    const arena = this.arenas.find(a => a.id === newArenaId);

    this.lessonDetails.arena_id = newArenaId;
    this.lessonDetails.arena_name = arena?.name ?? null;
  }

  // ------------ ATTENDANCE HELPERS ------------
  private hasAnyNote(): boolean {
    return (
      this.notesGeneral.length +
        this.notesMedical.length +
        this.notesBehavioral.length >
      0
    );
  }

  async setAttendance(status: AttendanceStatus) {
    if (!this.canEditNotes) return;

    this.attendanceStatus = status;
    this.attendanceChange.emit(status);
    this.recalcPresenceFlags();
  }

  private recalcPresenceFlags() {
    this.mustChooseAttendance =
      this.enforceNoteForPresence && !this.attendanceStatus;

    this.mustFillNoteForPresent =
      this.enforceNoteForPresence &&
      this.attendanceStatus === 'present' &&
      !this.hasAnyNote();
  }

  // ------------ NOTES CRUD ------------
  async loadNotes() {
    const childId = this.child?.child_uuid;
    if (!childId) return;

    const { data } = await this.dbc
      .from('notes')
      .select('id, content, instructor_uid, instructor_name, date, category')
      .eq('child_id', childId)
      .order('date', { ascending: false });

    const notes = (data ?? []).map((n: { id: any; content: any; date: any; instructor_uid: any; instructor_name: any; category: any; }) => ({
      id: n.id,
      display_text: n.content,
      created_at: n.date,
      instructor_uid: n.instructor_uid,
      instructor_name: n.instructor_name ?? '—',
      category: n.category ?? 'general',
      isEditing: false,
    }));

    this.notesGeneral = notes.filter((n: { category: string; }) => n.category === 'general');
    this.notesMedical = notes.filter((n: { category: string; }) => n.category === 'medical');
    this.notesBehavioral = notes.filter((n: { category: string; }) => n.category === 'behavioral');

    this.recalcPresenceFlags();
  }

  async loadReadyNotes() {
    const { data } = await this.dbc.from('list_notes').select('id, note');

    this.readyNotes = (data ?? []).map((n: { id: any; note: any; }) => ({
      id: n.id,
      content: n.note,
    }));
  }

  addReadyNote(content: string) {
    if (this.canEditNotes) {
      this.newNote = content;
    }
  }

  async addNote() {
    if (!this.canEditNotes) return;

    const content = this.newNote.trim();
    if (!content) return;

    const childId = this.child?.child_uuid;
    if (!childId) return;

    const instructor = await getCurrentUserDetails(
      'uid, first_name, last_name'
    );

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await this.dbc.from('notes').insert([
      {
        id,
        child_id: childId,
        content,
        date: now,
        instructor_uid: instructor?.uid ?? null,
        instructor_name:
          `${instructor?.first_name ?? ''} ${instructor?.last_name ?? ''}`.trim(),
        category: this.selectedCategory,
      },
    ]);

    const note: NoteVM = {
      id,
      display_text: content,
      created_at: now,
      instructor_uid: instructor?.uid ?? null,
      instructor_name:
        `${instructor?.first_name ?? ''} ${instructor?.last_name ?? ''}`.trim(),
      category: this.selectedCategory,
    };

    if (note.category === 'general') this.notesGeneral.unshift(note);
    else if (note.category === 'medical') this.notesMedical.unshift(note);
    else this.notesBehavioral.unshift(note);

    this.newNote = '';
    this.recalcPresenceFlags();
  }

  startEdit(note: NoteVM) {
    if (this.canEditNotes) note.isEditing = true;
  }

  async saveEdit(note: NoteVM) {
    if (!this.canEditNotes) return;

    await this.dbc
      .from('notes')
      .update({ content: note.display_text })
      .eq('id', note.id);

    note.isEditing = false;
  }

  async deleteNote(id: string | number) {
    if (!this.canEditNotes) return;

    await this.dbc.from('notes').delete().eq('id', id);

    this.notesGeneral =
      this.notesGeneral.filter(n => n.id !== id);
    this.notesMedical =
      this.notesMedical.filter(n => n.id !== id);
    this.notesBehavioral =
      this.notesBehavioral.filter(n => n.id !== id);

    this.recalcPresenceFlags();
  }

  // ------------ TRACKBY ------------
  trackByReady(i: number, item: ReadyNote) {
    return item.id;
  }

  trackByNote(i: number, item: NoteVM) {
    return item.id;
  }

  trackByHorse(i: number, item: HorseOption) {
    return item.id;
  }

  trackByArena(i: number, item: ArenaOption) {
    return item.id;
  }

  // ===========================================
  // BACKDROP + CLOSE HANDLERS   <-- החלק שהיה חסר
  // ===========================================

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  onClose() {
    if (this.enforceNoteForPresence && !this.attendanceStatus) {
      this.mustChooseAttendance = true;
      return;
    }

    if (
      this.enforceNoteForPresence &&
      this.attendanceStatus === 'present' &&
      !this.hasAnyNote()
    ) {
      this.mustFillNoteForPresent = true;
      return;
    }

    this.close.emit();
  }
}

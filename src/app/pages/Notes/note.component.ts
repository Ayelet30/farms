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
  inject,
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

import { dbTenant, getCurrentUserDetails } from '../../services/legacy-compat';
import { CurrentUserService } from '../../core/auth/current-user.service';

/* ===================== TYPES ===================== */

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
  id: string;
  display_text: string;
  created_at?: string | null;
  instructor_uid?: string | null;
  instructor_name?: string | null;
  category: Category;
  isEditing?: boolean;
}

interface ReadyNote {
  id: string;
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

/* ===================== COMPONENT ===================== */

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
  /* ===================== INPUT / OUTPUT ===================== */

  @Input() child: any;
  @Input() occurrence: any;

  @Input() attendanceStatus: AttendanceStatus = null;
  @Input() enforceNoteForPresence = true;

  @Output() attendanceChange = new EventEmitter<AttendanceStatus>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('scrollable') scrollable!: ElementRef<HTMLDivElement>;

  /* ===================== STATE ===================== */

  private dbc = dbTenant();
  private cu = inject(CurrentUserService);

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

  role: RoleInTenant | null = null;

  /* ===================== PERMISSIONS ===================== */

  get canEditNotes(): boolean {
    return this.role === 'instructor' || this.role === 'secretary';
  }

  get canEditLessonResources(): boolean {
    return this.role === 'instructor' || this.role === 'secretary';
  }

  /* ===================== LIFECYCLE ===================== */

  async ngOnInit() {
    this.role = (this.cu.current?.role as RoleInTenant) ?? null;

    await Promise.all([
      this.loadReadyNotes(),
      this.loadNotes(),
      this.loadHorses(),
      this.loadArenas(),
      this.loadLessonDetails(),
    ]);

    this.recalcPresenceFlags();
  }

  ngAfterViewInit() {
    this.scrollable?.nativeElement.scrollTo({ top: 0 });
  }

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['occurrence'] && !changes['occurrence'].firstChange) {
      await this.loadLessonDetails();
    }

    if (changes['child'] && !changes['child'].firstChange) {
      await this.loadNotes();
    }

    if (changes['attendanceStatus']) {
      this.recalcPresenceFlags();
    }
  }

  /* ===================== HELPERS ===================== */

  getTimeString(v?: string | null): string {
    return v ? v.substring(0, 5) : '';
  }

  private getOccurDate(): string | null {
    const raw =
      this.occurrence?.occur_date ||
      this.occurrence?.date ||
      this.occurrence?.start;

    if (!raw) return null;

    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;

    return d.toISOString().substring(0, 10);
  }

  /** במקור: כשסומן "הגיע" חייבת להיות לפחות הערת שיעור (general) */
  private hasAnyLessonNote(): boolean {
    return this.notesGeneral.length > 0;
  }

  /* ===================== LESSON ===================== */

  async loadLessonDetails() {
    const lessonId = this.occurrence?.lesson_id;
    const occurDate = this.getOccurDate();

    if (!lessonId || !occurDate) {
      this.lessonDetails = null;
      return;
    }

    const { data: viewData } = await this.dbc
      .from('lessons_with_children')
      .select('*')
      .eq('lesson_id', lessonId)
      .eq('occur_date', occurDate)
      .maybeSingle();

    const { data: resData } = await this.dbc
      .from('lesson_resources')
      .select('horse_id, arena_id')
      .eq('lesson_id', lessonId)
      .eq('occur_date', occurDate)
      .maybeSingle();

    if (!viewData && !resData) {
      this.lessonDetails = null;
      return;
    }

    const horseId = resData?.horse_id ?? viewData?.horse_id ?? null;
    const arenaId = resData?.arena_id ?? viewData?.arena_id ?? null;

    const horseName =
      this.horses.find(h => h.id === horseId)?.name ??
      viewData?.horse_name ??
      null;

    const arenaName =
      this.arenas.find(a => a.id === arenaId)?.name ??
      viewData?.arena_name ??
      null;

    this.lessonDetails = {
      lesson_id: lessonId,
      start_time: viewData?.start_time ?? null,
      end_time: viewData?.end_time ?? null,
      lesson_type: viewData?.lesson_type ?? null,
      status: viewData?.status ?? null,
      horse_id: horseId,
      horse_name: horseName,
      arena_id: arenaId,
      arena_name: arenaName,
    };
  }

  /* ===================== HORSES / ARENAS ===================== */

  async loadHorses() {
    const { data } = await this.dbc.from('horses').select('id,name,is_active');
    this.horses =
      data?.map((h: any) => ({
        id: h.id,
        name: h.name,
        isActive: h.is_active,
      })) ?? [];
  }

  async loadArenas() {
    const { data } = await this.dbc.from('arenas').select('id,name,is_active');
    this.arenas =
      data?.map((a: any) => ({
        id: a.id,
        name: a.name,
        isActive: a.is_active,
      })) ?? [];
  }

  async onHorseChange(horseId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const occurDate = this.getOccurDate();
    if (!occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: this.lessonDetails.lesson_id,
        occur_date: occurDate,
        horse_id: horseId,
        arena_id: this.lessonDetails.arena_id ?? null,
      },
      { onConflict: 'lesson_id,occur_date' }
    );

    const h = this.horses.find(x => x.id === horseId);
    this.lessonDetails.horse_id = horseId;
    this.lessonDetails.horse_name = h?.name ?? null;
  }

  async onArenaChange(arenaId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const occurDate = this.getOccurDate();
    if (!occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: this.lessonDetails.lesson_id,
        occur_date: occurDate,
        horse_id: this.lessonDetails.horse_id ?? null,
        arena_id: arenaId,
      },
      { onConflict: 'lesson_id,occur_date' }
    );

    const a = this.arenas.find(x => x.id === arenaId);
    this.lessonDetails.arena_id = arenaId;
    this.lessonDetails.arena_name = a?.name ?? null;
  }

  /* ===================== ATTENDANCE ===================== */

  setAttendance(status: AttendanceStatus) {
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
      !this.hasAnyLessonNote();
  }

  /* ===================== NOTES ===================== */

  async loadNotes() {
    const childId = this.child?.child_uuid;
    if (!childId) return;

    const { data } = await this.dbc
      .from('notes')
      .select('*')
      .eq('child_id', childId)
      .order('date', { ascending: false });

    const notes: NoteVM[] =
      data?.map((n: any) => ({
        id: n.id,
        display_text: n.content,
        created_at: n.date,
        instructor_uid: n.instructor_uid,
        instructor_name: n.instructor_name ?? '—',
        category: (n.category ?? 'general') as Category,
        isEditing: false,
      })) ?? [];

    this.notesGeneral = notes.filter(n => n.category === 'general');
    this.notesMedical = notes.filter(n => n.category === 'medical');
    this.notesBehavioral = notes.filter(n => n.category === 'behavioral');

    this.recalcPresenceFlags();
  }

  async loadReadyNotes() {
    const { data } = await this.dbc.from('list_notes').select('id,note');
    this.readyNotes =
      data?.map((n: any) => ({
        id: String(n.id),
        content: n.note,
      })) ?? [];
  }

  addReadyNote(content: string) {
    if (!this.canEditNotes) return;
    this.newNote = content;
  }

  async addNote() {
    if (!this.canEditNotes) return;

    const content = this.newNote.trim();
    if (!content) return;

    const childId = this.child?.child_uuid;
    if (!childId) return;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // ✅ במקור: מזכירה -> "מזכירה" (וללא instructor_uid)
    const user =
      this.role === 'instructor'
        ? await getCurrentUserDetails('uid,first_name,last_name')
        : null;

    const instructor_uid = user?.uid ?? null;
    const instructor_name = user
      ? `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()
      : 'מזכירה';

    const note: NoteVM = {
      id,
      display_text: content,
      created_at: now,
      instructor_uid,
      instructor_name,
      category: this.selectedCategory,
      isEditing: false,
    };

    await this.dbc.from('notes').insert({
      id: note.id,
      child_id: childId,
      content: note.display_text,
      date: note.created_at,
      instructor_uid: note.instructor_uid,
      instructor_name: note.instructor_name,
      category: note.category,
    });

    if (note.category === 'general') this.notesGeneral.unshift(note);
    else if (note.category === 'medical') this.notesMedical.unshift(note);
    else this.notesBehavioral.unshift(note);

    this.newNote = '';
    this.recalcPresenceFlags();
  }

  startEdit(n: NoteVM) {
    if (!this.canEditNotes) return;
    n.isEditing = true;
  }

  async saveEdit(n: NoteVM) {
    if (!this.canEditNotes) return;

    await this.dbc.from('notes').update({ content: n.display_text }).eq('id', n.id);
    n.isEditing = false;
  }

  async deleteNote(id: string) {
    if (!this.canEditNotes) return;

    await this.dbc.from('notes').delete().eq('id', id);

    this.notesGeneral = this.notesGeneral.filter(n => n.id !== id);
    this.notesMedical = this.notesMedical.filter(n => n.id !== id);
    this.notesBehavioral = this.notesBehavioral.filter(n => n.id !== id);

    this.recalcPresenceFlags();
  }

  /* ===================== TRACK BY ===================== */

  trackByReady(_: number, i: ReadyNote) {
    return i.id;
  }

  trackByNote(_: number, i: NoteVM) {
    return i.id;
  }

  trackByHorse(_: number, i: HorseOption) {
    return i.id;
  }

  trackByArena(_: number, i: ArenaOption) {
    return i.id;
  }

  /* ===================== CLOSE ===================== */

  onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this.onClose();
  }

  onClose() {
    // ✅ כמו במקור: חייבים לבחור נוכחות
    if (this.enforceNoteForPresence && !this.attendanceStatus) {
      this.mustChooseAttendance = true;
      return;
    }

    // ✅ כמו במקור: אם "הגיע" חייבים לפחות הערת שיעור (general)
    if (
      this.enforceNoteForPresence &&
      this.attendanceStatus === 'present' &&
      !this.hasAnyLessonNote()
    ) {
      this.mustFillNoteForPresent = true;
      return;
    }

    this.close.emit();
  }
}

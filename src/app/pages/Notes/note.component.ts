import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
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

type AttendanceStatus = 'present' | 'absent' | null;

type RoleInTenant =
  | 'parent'
  | 'instructor'
  | 'secretary'
  | 'manager'
  | 'admin'
  | 'coordinator';

type Category = 'general' | 'medical' | 'behavioral';

interface NoteVM {
  id: string;
  display_text: string;
  created_at: string;
  instructor_uid: string | null;
  instructor_name: string | null;
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
interface ChildDetails {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
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
export class NoteComponent implements OnInit, OnChanges {
  /* ===================== INPUT / OUTPUT ===================== */

 @Input() child!: { child_uuid: string };

childDetails: ChildDetails | null = null;

  @Input() occurrence: any;

  /** אם מועבר מבחוץ (לא חובה) */
  @Input() role: RoleInTenant | null = null;

  /** אם true – אוכפים חובת נוכחות + חובת הערה לפי הכללים */
  @Input() enforceNoteForPresence = true;

  @Input() attendanceStatus: AttendanceStatus = null;

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

lessonDetails: LessonDetails = {
  lesson_id: '',
  start_time: null,
  end_time: null,
  lesson_type: null,
  status: null,
  horse_id: null,
  horse_name: null,
  arena_id: null,
  arena_name: null,
};


  horses: HorseOption[] = [];
  arenas: ArenaOption[] = [];

  /** UI flags */
  mustChooseAttendance = false;
  mustFillNoteForPresent = false;

  /**
   * ⚠️ דגל “נדרש להוסיף הערה חדשה בגלל שסומן הגיע”
   * - רק אם attendanceStatus === 'present'
   * - מתאפס אחרי addNote()
   */
  private mustAddNewNoteForPresent = false;
showCloseWarning: any;

  /* ===================== PERMISSIONS ===================== */

  private effectiveRole(): RoleInTenant | null {
    if (this.role) return this.role;
    const raw = this.cu.current?.role as string | undefined;
    const allowed: RoleInTenant[] = [
      'parent',
      'instructor',
      'secretary',
      'manager',
      'admin',
      'coordinator',
    ];
    return allowed.includes(raw as RoleInTenant) ? (raw as RoleInTenant) : null;
  }

  get canEditNotes(): boolean {
    const r = this.effectiveRole();
    return r === 'instructor' || r === 'secretary';
  }

  get canEditLessonResources(): boolean {
    const r = this.effectiveRole();
    return r === 'instructor' || r === 'secretary';
  }

  /* ===================== LIFECYCLE ===================== */

 async ngOnInit() {
  // 1️⃣ טעינת נתונים בסיסיים – חייבים לפני פרטי שיעור
  await this.loadChildDetails();
  await this.loadHorses();
  await this.loadArenas();
  await this.loadReadyNotes();

  // 2️⃣ עכשיו אפשר לטעון נתונים שתלויים בזה
  await this.loadLessonDetails();
  await this.loadNotes();

  // 3️⃣ איפוס התראות סגירה
  this.resetCloseWarnings();

  // 4️⃣ גלילה לראש הכרטיס (אחרי רינדור)
  queueMicrotask(() => {
    if (this.scrollable?.nativeElement) {
      this.scrollable.nativeElement.scrollTo({ top: 0 });
    }
  });
}


  async ngOnChanges(changes: SimpleChanges) {
    if (changes['occurrence'] && !changes['occurrence'].firstChange) {
      await this.loadLessonDetails();
    }
  if (changes['child']) {
  await this.loadChildDetails();
  await this.loadNotes();
}


    if (changes['attendanceStatus'] && !changes['attendanceStatus'].firstChange) {
      // שינוי מבחוץ – לא “מחייב” הערה חדשה אוטומטית
      this.resetCloseWarnings();
    }
  }

  /* ===================== HELPERS ===================== */
  get childName(): string {
  return (
    this.occurrence?.child_full_name ||
    `${this.childDetails?.first_name ?? ''} ${this.childDetails?.last_name ?? ''}`.trim() ||
    '—'
  );
}
getChildAge(birthDate: string | null): number | null {
  if (!birthDate) return null;

  const birth = new Date(birthDate);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();

  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

private hasAnyNote(): boolean {
  return (
    this.notesGeneral.length +
      this.notesMedical.length +
      this.notesBehavioral.length >
    0
  );
}

private recalcPresenceFlags() {
  // ❌ אם אי אפשר לסמן נוכחות בזמן הזה – לא מציגים שום אזהרה
  if (!this.canMarkAttendanceNow()) {
    this.mustChooseAttendance = false;
    this.mustFillNoteForPresent = false;
    return;
  }

  this.mustChooseAttendance =
    this.enforceNoteForPresence && !this.attendanceStatus;

  this.mustFillNoteForPresent =
    this.enforceNoteForPresence &&
    this.attendanceStatus === 'present' &&
    !this.hasAnyNote();
}


  getTimeString(v?: string | null): string {
    return v ? String(v).substring(0, 5) : '';
  }

  private extractDate(raw: any): string | null {
    if (!raw) return null;

    if (typeof raw === 'string') {
      // אם כבר YYYY-MM-DD
      if (raw.length >= 10) return raw.substring(0, 10);
      // אם ISO עם זמן
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
      return null;
    }

    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().substring(0, 10);
  }

  private getOccurDateForDb(): string | null {
    return this.extractDate(
      this.occurrence?.occur_date ||
        this.occurrence?.date ||
        this.occurrence?.start ||
        this.occurrence?.start_time
    );
  }
canMarkAttendanceNow(): boolean {
  if (!this.occurrence || !this.lessonDetails?.start_time) {
    return false;
  }

  const occurDate = this.getOccurDateForDb();
  if (!occurDate) return false;

  const lessonDate = new Date(
    `${occurDate}T${this.lessonDetails.start_time}`
  );

  const now = new Date();
  const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);

  // ❌ שיעור עתידי מעבר לשעה קדימה
  if (lessonDate > oneHourAhead) {
    return false;
  }

  // ✅ עבר / היום / עד שעה קדימה
  return true;
}

  /* ===================== LESSON DETAILS ===================== */
async loadChildDetails() {
  const childUuid = this.child?.child_uuid;
  if (!childUuid) return;

  // 1) הילד (לפי child_uuid, לא id)
  const { data: childData, error } = await this.dbc
    .from('children')
    .select('child_uuid, first_name, last_name, birth_date, parent_uid')
    .eq('child_uuid', childUuid)
    .maybeSingle();

  if (error || !childData) {
    console.error('[NOTE] failed loading child', error);
    return;
  }

  // 2) הורה (אם יש parent_uid)
  let parentName: string | null = null;
  let parentPhone: string | null = null;
  let parentEmail: string | null = null;

  if (childData.parent_uid) {
    const { data: parent, error: pErr } = await this.dbc
      .from('parents')
      .select('uid, first_name, last_name, email, phone')
      .eq('uid', childData.parent_uid)
      .maybeSingle();

    if (!pErr && parent) {
      parentName = `${parent.first_name ?? ''} ${parent.last_name ?? ''}`.trim() || null;
      parentPhone = parent.phone ?? null;
      parentEmail = parent.email ?? null;
    }
  }

  this.childDetails = {
    child_uuid: childUuid,
    first_name: childData.first_name ?? null,
    last_name: childData.last_name ?? null,
    birth_date: childData.birth_date ?? null,
    parent_name: parentName,
    parent_phone: parentPhone,
    parent_email: parentEmail,
  };
}


async loadLessonDetails() {
  const lessonId = this.occurrence?.lesson_id;
  const occurDate = this.getOccurDateForDb();

  if (!lessonId || !occurDate) return;

  // --- קריאה מה-VIEW (כמו בקוד המקורי) ---
  const { data, error } = await this.dbc
    .from('lessons_with_children')
    .select(`
      lesson_id,
      start_time,
      end_time,
      lesson_type,
      status,
      horse_id,
      horse_name,
      arena_id,
      arena_name
    `)
    .eq('lesson_id', lessonId)
    .eq('occur_date', occurDate)
    .limit(1);

  if (error) {
    console.error('[loadLessonDetails] view error', error);
    return;
  }

  const row = data?.[0];
  if (!row) return;

  // --- מיפוי ל-lessonDetails (בלי לגעת בטבלה) ---
  this.lessonDetails = {
    lesson_id: row.lesson_id,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    lesson_type: row.lesson_type ?? null,
    status: row.status ?? null,
    horse_id: row.horse_id ?? null,
    horse_name: row.horse_name ?? null,
    arena_id: row.arena_id ?? null,
    arena_name: row.arena_name ?? null,
  };
}

  /* ===================== HORSES / ARENAS ===================== */

  async loadHorses() {
    const { data } = await this.dbc.from('horses').select('id,name,is_active');
    this.horses =
      data?.map((h: any) => ({
        id: String(h.id),
        name: String(h.name),
        isActive: !!h.is_active,
      })) ?? [];
  }

  async loadArenas() {
    const { data } = await this.dbc.from('arenas').select('id,name,is_active');
    this.arenas =
      data?.map((a: any) => ({
        id: String(a.id),
        name: String(a.name),
        isActive: !!a.is_active,
      })) ?? [];
  }

  async onHorseChange(newHorseId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const occurDate = this.getOccurDateForDb();
    if (!occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: this.lessonDetails.lesson_id,
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

  async onArenaChange(newArenaId: string | null) {
    if (!this.canEditLessonResources || !this.lessonDetails) return;

    const occurDate = this.getOccurDateForDb();
    if (!occurDate) return;

    await this.dbc.from('lesson_resources').upsert(
      {
        lesson_id: this.lessonDetails.lesson_id,
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

  /* ===================== ATTENDANCE ===================== */
private async saveAttendance(status: AttendanceStatus | null) {
  const lessonId = this.occurrence?.lesson_id;
  const occurDate = this.getOccurDateForDb();
  const childId = this.child?.child_uuid;

  console.log('[ATTENDANCE] input', {
    lessonId,
    occurDate,
    childId,
    status,
  });

  if (!lessonId || !occurDate || !childId) {
    console.error('[ATTENDANCE] missing PK', {
      lessonId,
      occurDate,
      childId,
    });
    return;
  }

  const user = await getCurrentUserDetails('uid, role');
  console.log('[ATTENDANCE] user', user);

  /** ניקוי נוכחות */
  if (!status) {
    console.log('[ATTENDANCE] delete');

    const { error } = await this.dbc
      .from('lesson_attendance')
      .delete()
      .eq('lesson_id', lessonId)
      .eq('occur_date', occurDate)
      .eq('child_id', childId);

    if (error) {
      console.error('[ATTENDANCE] delete error', error);
    }

    return;
  }

  /** שמירה */
  const payload = {
    lesson_id: lessonId,
    child_id: childId,
    occur_date: occurDate,

    attendance_status: status,

    // ❗❗❗ כאן היה הבאג
    marked_by_uid: null,              // UUID בלבד → NULL
    marked_by_id: user?.uid ?? null,  // Firebase UID → TEXT

    marked_by_role: user?.role ?? null,
    marked_at: new Date().toISOString(),
    note: null,
  };

  console.log('[ATTENDANCE] upsert payload', payload);

  const { error } = await this.dbc
    .from('lesson_attendance')
    .upsert(payload, {
      onConflict: 'lesson_id,child_id,occur_date',
    });

  if (error) {
    console.error('[ATTENDANCE] upsert error', error);
  } else {
    console.log('[ATTENDANCE] saved OK');
  }
}



async setAttendance(status: AttendanceStatus) {
  if (!this.canEditNotes) return;

  if (!this.canMarkAttendanceNow()) {
    console.warn('[ATTENDANCE] blocked – future lesson');
    return;
  }

  this.attendanceStatus = status;
  this.attendanceChange.emit(status);

  await this.saveAttendance(status);
  this.recalcPresenceFlags();

  
}
clearAttendance(): void {
  this.setAttendance(null);
}

  /* ===================== NOTES ===================== */

  async loadNotes() {
    const childId = this.child?.child_uuid;
    if (!childId) return;

    const { data } = await this.dbc
      .from('notes')
      .select('id,content,date,instructor_uid,instructor_name,category')
      .eq('child_id', childId)
      .order('date', { ascending: false });

    const notes: NoteVM[] =
      (data ?? []).map((n: any) => ({
        id: String(n.id),
        display_text: String(n.content ?? ''),
        created_at: String(n.date ?? new Date().toISOString()),
        instructor_uid: n.instructor_uid ? String(n.instructor_uid) : null,
        instructor_name: n.instructor_name ? String(n.instructor_name) : null,
        category: (n.category ?? 'general') as Category,
        isEditing: false,
      })) ?? [];

    this.notesGeneral = notes.filter(n => n.category === 'general');
    this.notesMedical = notes.filter(n => n.category === 'medical');
    this.notesBehavioral = notes.filter(n => n.category === 'behavioral');
  }

  async loadReadyNotes() {
    const { data } = await this.dbc.from('list_notes').select('id,note');
    this.readyNotes =
      (data ?? []).map((n: any) => ({
        id: String(n.id),
        content: String(n.note ?? ''),
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

    const u = await getCurrentUserDetails('uid,first_name,last_name');

    const role = this.effectiveRole();

    // ✅ מדריך: נשמור uid+name
    // ✅ מזכירה: נשמור null/null כדי שה־HTML יציג "מזכירה"
    const isSecretary = role === 'secretary';

    const instructorUid: string | null = isSecretary ? null : (u?.uid ?? null);
    const fullName = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
    const instructorName: string | null = isSecretary ? null : (fullName || null);

    const category: Category = 'general'; // ✅ הורדנו קטגוריה בהוספת הערה

    await this.dbc.from('notes').insert([
      {
        id,
        child_id: childId,
        content,
        date: now,
        instructor_uid: instructorUid,
        instructor_name: instructorName,
        category,
      },
    ]);

    const note: NoteVM = {
      id,
      display_text: content,
      created_at: now,
      instructor_uid: instructorUid,
      instructor_name: instructorName,
      category,
      isEditing: false,
    };

    this.notesGeneral.unshift(note);
    this.newNote = '';

    // ✅ הוסיפו הערה חדשה -> אפשר לסגור גם אם “הגיע”
    this.mustAddNewNoteForPresent = false;
    this.resetCloseWarnings();
  }

  startEdit(note: NoteVM) {
    if (!this.canEditNotes) return;
    note.isEditing = true;
  }

  async saveEdit(note: NoteVM) {
    if (!this.canEditNotes) return;
    await this.dbc.from('notes').update({ content: note.display_text }).eq('id', note.id);
    note.isEditing = false;
  }

  async deleteNote(id: string) {
    if (!this.canEditNotes) return;

    await this.dbc.from('notes').delete().eq('id', id);

    this.notesGeneral = this.notesGeneral.filter(n => n.id !== id);
    this.notesMedical = this.notesMedical.filter(n => n.id !== id);
    this.notesBehavioral = this.notesBehavioral.filter(n => n.id !== id);
  }

  /* ===================== TRACK BY ===================== */

  trackByReady(_: number, item: ReadyNote) {
    return item.id;
  }
  trackByNote(_: number, item: NoteVM) {
    return item.id;
  }
  trackByHorse(_: number, item: HorseOption) {
    return item.id;
  }
  trackByArena(_: number, item: ArenaOption) {
    return item.id;
  }

  /* ===================== CLOSE / WARNINGS ===================== */

  private resetCloseWarnings() {
    this.mustChooseAttendance = false;
    this.mustFillNoteForPresent = false;
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.onClose();
  }

  onClose() {
  // ✅ אם אי אפשר לסמן נוכחות בזמן הזה — סוגרים בלי אזהרות
  if (!this.canMarkAttendanceNow()) {
    this.close.emit();
    return;
  }

  if (!this.enforceNoteForPresence) {
    this.close.emit();
    return;
  }

  // חובה לבחור נוכחות
  if (!this.attendanceStatus) {
    this.mustChooseAttendance = true;
    this.mustFillNoteForPresent = false;
    return;
  }

  // הגיע → חובה הערה
  if (this.attendanceStatus === 'present' && this.mustAddNewNoteForPresent) {
    this.mustChooseAttendance = false;
    this.mustFillNoteForPresent = true;
    return;
  }

  this.close.emit();
}

}

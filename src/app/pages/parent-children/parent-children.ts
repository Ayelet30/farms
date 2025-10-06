

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { ChildRow } from '../../Types/detailes.model';
import { dbTenant, fetchMyChildren, getCurrentUserData } from '../../services/supabaseClient.service';
import { ChildConsentsComponent } from '../../consents/child-consents.component/child-consents.component';

/* =========================
   Types
========================= */
type OccurrenceRow = {
  child_id: string;
  start_datetime: string;
  instructor_id?: string | null;
  status?: string | null;
  lesson_type?: 'רגיל' | 'השלמה' | string | null;
};
type InstructorRow = { id_number: string; full_name: string | null };

// ----- Status helpers (ENUM in English only) -----
type ChildStatus = 'Active' | 'Pending Deletion Approval' | 'Pending Addition Approval' | 'Deleted';


@Component({
  selector: 'app-parent-children',
  standalone: true,
  imports: [CommonModule, FormsModule, ChildConsentsComponent],
  templateUrl: './parent-children.html',
  styleUrls: ['./parent-children.css']
})
export class ParentChildrenComponent implements OnInit {

  /* =========================
     State (public – בשימוש התבנית)
  ========================= */
  children: ChildRow[] = [];
  loading = true;
  error: string | undefined;

  // מפות להצגת "התור הבא" ו"פעילות אחרונה"
  nextAppointments: Record<string, { date: string; time: string; instructor?: string; isToday: boolean; _ts: number } | null> = {};
  lastActivities: Record<string, { date: string; time: string; instructor?: string; pendingCompletion?: boolean } | null> = {};

  // בחירה מרובה
  maxSelected = 4;
  selectedIds = new Set<string>();          // child_uuid-ים מוצגים
  editing: Record<string, boolean> = {};    // child_uuid -> מצב עריכה
  editables: Record<string, any> = {};      // child_uuid -> טופס עריכה

  // הוספת ילד
  newChild: any = null;
  validationErrors: { [key: string]: string } = {};
  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];

  // הודעות מידע
  infoMessage: string | null = null;

  // מחיקה/עזיבה
  showDeleteConfirm = false;
  pendingDeleteId: string | null = null;

  // ---- History modal state ----
showHistory = false;
historyLoading = false;
historyChildName = '';
historyItems: { date: string; time: string; instructor?: string; status: string; lesson_type?: string }[] = [];

// תגית צבע לפי סטטוס להדפסה ב־[ngClass]
statusClass(st: string): string {
  switch (st) {
    case 'הושלם': return 'st-done';
    case 'אושר': return 'st-approved';
    case 'בוטל': return 'st-cancel';
    case 'ממתין לאישור': return 'st-pending';
    default: return 'st-other';
  }
}

  /* =========================
     Private fields
  ========================= */
  private infoTimer: any;
  private readonly CHILD_SELECT =
    'child_uuid, gov_id, full_name, birth_date, gender, health_fund, instructor_id, parent_uid, status, medical_notes';

  constructor(private router: Router) {}

  /* =========================
     Lifecycle
  ========================= */
  async ngOnInit() {
    await this.loadChildren();
  }

  async loadChildren(): Promise<void> {
    this.loading = true;

    const baseSelect =
      this.CHILD_SELECT && this.CHILD_SELECT.trim().length ? this.CHILD_SELECT : 'child_uuid, full_name, status';
    const hasStatus = /(^|,)\s*status\s*(,|$)/.test(baseSelect);
    const selectWithStatus = hasStatus ? baseSelect : `${baseSelect}, status`;

    const res = await fetchMyChildren(selectWithStatus);
    this.loading = false;

    if (!res.ok) {
      this.error = res.error;
      return;
    }
const rows = (res.data ?? []).filter((r: any) => !this.isDeletedStatus(r.status)) as ChildRow[];

    this.children = rows;

    // ברירת מחדל – מציג עד 4 פעילים ראשונים
    if (this.selectedIds.size === 0) {
  const actives = rows.filter(r => this.isActiveStatus(r.status));
  const pendings = rows.filter(r => !this.isActiveStatus(r.status) && !this.isDeletedStatus(r.status));
  const initial = [...actives, ...pendings].slice(0, this.maxSelected);

  this.selectedIds = new Set(initial.map(r => this.childId(r)).filter(Boolean) as string[]);
  initial.forEach(c => this.ensureEditable(c));
}


    await this.loadNextAppointments();
    await this.loadLastActivities();
  }

  /* =========================
     Selection & Card interactions
  ========================= */
  // מזהה בטוח לכל ילד (התבנית משתמשת)
  childId(c: any): string {
    return (c?.['child_uuid'] ?? '') as string;
  }

  hasSelected(c: any): boolean {
    const id = this.childId(c);
    return !!id && this.selectedIds.has(id);
  }

  get selectedChildren(): any[] {
    return this.children.filter(c => this.hasSelected(c));
  }

  isActiveChild(c: any): boolean {
  return this.isActiveStatus(c?.['status']);
}


  toggleChildSelection(child: any) {
    const id = this.childId(child);
    if (!id) return;

    // לא פעיל? הצגת הודעה בלבד
    if (!this.canOpenCardByStatus(child?.status)) {
  this.showInfo('לא ניתן לפתוח את הכרטיסייה, הילד לא פעיל');
  return;
}


    // כבר פתוח → סגירה
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      delete this.editing[id];
      delete this.editables[id];
      return;
    }

    // מגבלת 4 כרטיסים
    if (this.selectedIds.size >= this.maxSelected) {
      this.showInfo('ניתן לצפות עד 4 ילדים במקביל, סגור כרטיס קיים כדי להוסיף חדש');
      return;
    }

    this.selectedIds.add(id);
    this.ensureEditable(child);
  }

  closeCard(child: any) {
    const id = this.childId(child);
    if (!id) return;
    this.selectedIds.delete(id);
    delete this.editing[id];
    delete this.editables[id];
  }

  trackByChild = (_: number, item: any) => this.childId(item);

  private ensureEditable(child: any) {
    const id = this.childId(child);
    if (!id) return;
    if (!this.editables[id]) {
      this.editables[id] = {
        ...child,
        age: child.birth_date ? this.getAge(child.birth_date) : null
      };
    }
  }

  startEdit(child: any) {
    const id = this.childId(child);
    if (!id) return;
    this.ensureEditable(child);
    this.editing[id] = true;
  }

  async saveChild(child: any) {
  const id = this.childId(child);
  if (!id) {
    this.error = 'חסר מזהה ילד (child_uuid).';
    return;
  }

  const model = this.editables[id];

  const { error } = await dbTenant()
    .from('children')
    .update({
      full_name: model.full_name,
      birth_date: model.birth_date || null,
      health_fund: model.health_fund || null,
      medical_notes: model.medical_notes || null
    })
    .eq('child_uuid', id)
    .select('child_uuid')
    .single();

  if (error) {
    this.error = error.message ?? 'שגיאה בשמירה';
    return;
  }

  const idx = this.children.findIndex(c => this.childId(c) === id);
  if (idx !== -1) {
    const updated = {
      ...this.children[idx],
      full_name: model.full_name,
      birth_date: model.birth_date || null,
      health_fund: model.health_fund || null,
      medical_notes: model.medical_notes || null
    };

    this.children = [
      ...this.children.slice(0, idx),
      updated,
      ...this.children.slice(idx + 1)
    ];

    this.editables[id] = {
      ...updated,
      age: updated.birth_date ? this.getAge(updated.birth_date) : null
    };
  }

  this.editing[id] = false;
  this.showInfo('השינויים נשמרו בהצלחה');
}


  cancelEdit(child: any) {
    const id = this.childId(child);
    if (!id) return;
    const original = this.children.find(c => this.childId(c) === id);
    if (original) this.editables[id] = { ...original };
    this.editing[id] = false;
  }

  /* =========================
     Lessons data (Next / Last)
  ========================= */
  private isSameLocalDate(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }

  // “התור הבא” מכלול הילדים – מתוך lessons_occurrences
  private async loadNextAppointments(): Promise<void> {
    const ids = this.children.map(c => this.childId(c)).filter(Boolean) as string[];
    if (!ids.length) return;

    this.nextAppointments = {};
    ids.forEach(id => (this.nextAppointments[id] = null));

    const nowIso = new Date().toISOString();
    const dbc = dbTenant();

    const { data: occRaw, error } = await dbc
      .from('lessons_occurrences')
      .select('child_id, start_datetime, instructor_id, status')
      .in('child_id', ids)
      .gte('start_datetime', nowIso)
      .in('status', ['אושר'])
      .order('child_id', { ascending: true })
      .order('start_datetime', { ascending: true });

    if (error) {
      console.error('שגיאה בקריאת lessons_occurrences:', error);
      return;
    }

    const occs = (occRaw ?? []) as OccurrenceRow[];

    // שמות מדריכים
    const instrIds = Array.from(new Set(occs.map(o => o.instructor_id).filter(Boolean))) as string[];
    let instructorNameById: Record<string, string> = {};
    if (instrIds.length) {
      const { data: instRaw } = await dbc
        .from('instructors')
        .select('id_number, full_name')
        .in('id_number', instrIds);

      const inst = (instRaw ?? []) as InstructorRow[];
      instructorNameById = Object.fromEntries(inst.map(i => [i.id_number, i.full_name ?? ''])) as Record<string, string>;
    }

    // הראשונה לכל ילד היא הקרובה ביותר
    for (const o of occs) {
      const cid = o.child_id;
      if (!cid || this.nextAppointments[cid]) continue;

      const dt = new Date(o.start_datetime);
      this.nextAppointments[cid] = {
        date: this.fmtDateHe(dt),
        time: this.fmtTimeHe(dt),
        instructor: instructorNameById[o.instructor_id ?? ''],
        isToday: this.isSameLocalDate(dt, new Date()),
        _ts: dt.getTime()
      };
    }
  }

  // “פעילות אחרונה” – מופע אחרון בעבר (הושלם/אושר)
  private async loadLastActivities(): Promise<void> {
    const ids = this.children.map(c => this.childId(c)).filter(Boolean) as string[];
    if (!ids.length) return;

    this.lastActivities = {};
    ids.forEach(id => (this.lastActivities[id] = null));

    const dbc = dbTenant();
    const nowIso = new Date().toISOString();

    const { data: occRaw, error } = await dbc
      .from('lessons_occurrences')
      .select('child_id, start_datetime, instructor_id, status, lesson_type')
      .in('child_id', ids)
      .lt('start_datetime', nowIso)
      .in('status', ['הושלם', 'אושר'])
      .order('child_id', { ascending: true })
      .order('start_datetime', { ascending: false });

    if (error) {
      console.error('שגיאה בקריאת lessons_occurrences (last):', error);
      return;
    }

    const occs = (occRaw ?? []) as OccurrenceRow[];

    // שמות מדריכים
    const instrIds = Array.from(new Set(occs.map(o => o.instructor_id).filter(Boolean))) as string[];
    let instructorNameById: Record<string, string> = {};
    if (instrIds.length) {
      const { data: instRaw } = await dbc
        .from('instructors')
        .select('id_number, full_name')
        .in('id_number', instrIds);
      const inst = (instRaw ?? []) as InstructorRow[];
      instructorNameById = Object.fromEntries(inst.map(i => [i.id_number, i.full_name ?? ''])) as Record<string, string>;
    }

    // הראשונה לכל ילד (לפי מיון יורד בזמן) היא האחרונה שבוצעה
    for (const o of occs) {
      const cid = o.child_id;
      if (!cid || this.lastActivities[cid]) continue;

      const dt = new Date(o.start_datetime);
      const instr = instructorNameById[o.instructor_id ?? ''] || undefined;

      this.lastActivities[cid] = {
        date: this.fmtDateHe(dt),
        time: this.fmtTimeHe(dt),
        instructor: instr,
        pendingCompletion: o.status !== 'הושלם'
      };
    }
  }

  // מחזירים לאנגולר (התבנית קוראת)
  getNextAppointment(child: any) {
    const id = this.childId(child);
    const v = id ? this.nextAppointments[id] : null;
    if (!v) return null;
    const { date, time, instructor, isToday } = v;
    return { date, time, instructor, isToday };
  }

  getLastActivity(child: any) {
    const id = this.childId(child);
    return id ? this.lastActivities[id] ?? null : null;
  }

  /* =========================
     CRUD – New Child
  ========================= */
  addNewChild() {
    this.newChild = {
      gov_id: '',
      full_name: '',
      birth_date: '',
      gender: '',
      health_fund: '',
      instructor: '',
status: 'Pending Addition Approval',
      medical_notes: ''
    };
    this.validationErrors = {};
  }

  async saveNewChild() {
    this.validationErrors = {};

    if (!/^\d{9}$/.test(this.newChild.gov_id || '')) this.validationErrors['gov_id'] = 'ת״ז חייבת להכיל בדיוק 9 ספרות';
    if (!this.newChild.full_name) this.validationErrors['full_name'] = 'נא להזין שם מלא';
    if (!this.newChild.birth_date) this.validationErrors['birth_date'] = 'יש לבחור תאריך לידה';
    if (!this.newChild.gender) this.validationErrors['gender'] = 'יש לבחור מין';
    if (!this.newChild.health_fund) this.validationErrors['health_fund'] = 'יש לבחור קופת חולים';
    if (Object.keys(this.validationErrors).length > 0) return;

    const dbc = dbTenant();
    const parentUid = (await getCurrentUserData())?.uid ?? null;

    const payload: any = {
      gov_id: this.newChild.gov_id,
      full_name: this.newChild.full_name,
      birth_date: this.newChild.birth_date,
      gender: this.newChild.gender,
      health_fund: this.newChild.health_fund,
status: 'Pending Addition Approval',
      parent_uid: parentUid,
      medical_notes: this.newChild.medical_notes || null
    };

    const { data: exists } = await dbc.from('children').select('gov_id').eq('gov_id', this.newChild.gov_id).maybeSingle();
    if (exists) {
      this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
      return;
    }

    const { error } = await dbc.from('children').insert(payload);
    if (error) {
      if ((error as any).code === '23505') {
        this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
        return;
      }
      this.error = error.message ?? 'שגיאה בהוספה';
      return;
    }

    await this.loadChildren();
    this.newChild = null;
    this.showInfo('הוספת הילד עברה לאישור מזכירה');
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    if (!/^\d$/.test(event.key)) event.preventDefault();
  }

  cancelNewChild() {
    this.newChild = null;
    this.validationErrors = {};
  }

  /* =========================
     Delete / Leave (logical)
  ========================= */
  confirmDeleteChild(child: any) {
    const id = this.childId(child);
    if (!id) return;
    this.pendingDeleteId = id;
    this.showDeleteConfirm = true;
  }

  async deleteChild() {
    if (!this.pendingDeleteId) return;

   const { error } = await dbTenant()
  .from('children')
  .update({ status: 'Pending Deletion Approval' })
  .eq('child_uuid', this.pendingDeleteId);

    if (!error) {
      this.selectedIds.delete(this.pendingDeleteId);
      this.showDeleteConfirm = false;
      this.pendingDeleteId = null;
      await this.loadChildren();
      this.showInfo('הבקשה להסרת הילד נשלחה למזכירה');
    } else {
      this.error = error.message ?? 'שגיאה במחיקה';
    }
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
    this.pendingDeleteId = null;
  }

  /* =========================
     Navigation
  ========================= */

  goToBooking(child: any) {
  const id = this.childId(child);
  if (!id) return;

  if (!this.canBookByStatus(child?.status)) {
    const msg = this.isPendingAdd(child?.status)
      ? 'לא ניתן להזמין תור עד לאישור ההוספה'
      : 'לא ניתן להזמין תור לסטטוס זה';
    this.showInfo(msg);
    return;
  }

  this.router.navigate(['/parent-schedule'], { queryParams: { child: id } });
}

  /* =========================
     Helpers (formatting & UX)
  ========================= */
  getAge(birthDate: string): number {
    if (!birthDate) return 0;
    const birth = new Date(birthDate);
    const ageDiff = Date.now() - birth.getTime();
    return Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
  }

  private fmtDateHe(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private fmtTimeHe(d: Date): string {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private showInfo(msg: string, ms = 5000) {
    this.infoMessage = msg;
    if (this.infoTimer) clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => (this.infoMessage = null), ms);
  }
  openHistory(child: any) {
  const id = this.childId(child);
  if (!id) return;
  this.historyChildName = child.full_name || '';
  this.showHistory = true;
  this.loadChildHistory(id);
}

closeHistory() {
  this.showHistory = false;
  this.historyItems = [];
  this.historyLoading = false;
}

private async loadChildHistory(childId: string) {
  this.historyLoading = true;

  const dbc = dbTenant();
  const nowIso = new Date().toISOString();

  // כל המופעים בעבר (מאז הכניסה למערכת ועד עכשיו)
  const { data: occRaw, error } = await dbc
    .from('lessons_occurrences')
    .select('start_datetime, instructor_id, status, lesson_type')
    .eq('child_id', childId)
    .lte('start_datetime', nowIso)
    .order('start_datetime', { ascending: false });

  if (error) {
    console.error('שגיאה בטעינת היסטוריה:', error);
    this.historyLoading = false;
    return;
  }

  const occs = (occRaw ?? []) as OccurrenceRow[];

  // שמות מדריכים
  const instrIds = Array.from(new Set(occs.map(o => o.instructor_id).filter(Boolean))) as string[];
  let nameById: Record<string, string> = {};
  if (instrIds.length) {
    const { data: instRaw } = await dbc
      .from('instructors')
      .select('id_number, full_name')
      .in('id_number', instrIds);
    const inst = (instRaw ?? []) as InstructorRow[];
    nameById = Object.fromEntries(inst.map(i => [i.id_number, i.full_name ?? ''])) as Record<string, string>;
  }

  this.historyItems = occs.map(o => {
    const dt = new Date(o.start_datetime);
    return {
      date: this.fmtDateHe(dt),
      time: this.fmtTimeHe(dt),
      instructor: nameById[o.instructor_id ?? ''] || undefined,
      status: o.status || '',
      lesson_type: o.lesson_type || undefined
    };
  });

  this.historyLoading = false;
}
// ===== Status helpers (public so template can call) =====
public isActiveStatus = (st?: string | null): boolean =>
  st === 'Active';

public isPendingAdd = (st?: string | null): boolean =>
  st === 'Pending Addition Approval';

public isPendingDelete = (st?: string | null): boolean =>
  st === 'Pending Deletion Approval';

public isDeletedStatus = (st?: string | null): boolean =>
  st === 'Deleted';

// מותר לפתוח כרטיס? (הכול מלבד Deleted)
public canOpenCardByStatus = (st?: string | null): boolean =>
  !this.isDeletedStatus(st);

// מותר להזמין תור? (Active או Pending Deletion Approval)
public canBookByStatus = (st?: string | null): boolean =>
  st === 'Active' || st === 'Pending Deletion Approval';

}

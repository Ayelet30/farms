// import { Component, OnInit } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import type { ChildRow } from '../../Types/detailes.model';

// import {
//   dbTenant,                  // : לעבוד מול סכימת הטננט
//   fetchMyChildren,           //   select מלא
//   getCurrentUserData         // בשביל parent_uid ב-INSERT
// } from '../../services/supabaseClient';
// import { ScheduleComponent } from "../../custom-widget/schedule/schedule";

// @Component({
//   selector: 'app-parent-children',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './parent-children.html',
//   styleUrls: ['./parent-children.css']
  
// })
// export class ParentChildrenComponent implements OnInit {
//   children: any[] = [];
//   selectedChild: any = null;
//   editableChild: any = null;
//   isEditing = false;
//   loading = true;
//   error: string | undefined;
//   infoMessage: string | null = null;
// private infoTimer: any;


//   healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];
//   validationErrors: { [key: string]: string } = {};
//   newChild: any = null;
  
  

// private readonly CHILD_SELECT =
//   'child_uuid, gov_id, full_name, birth_date, gender, health_fund, instructor_id, parent_uid, status, medical_notes';

//   async ngOnInit() {
//     await this.loadChildren();
//   }
// private showInfo(msg: string, ms = 5000) {
//   this.infoMessage = msg;
//   if (this.infoTimer) clearTimeout(this.infoTimer);
//   this.infoTimer = setTimeout(() => (this.infoMessage = null), ms);
// }


// async loadChildren(): Promise<void> {
//   this.loading = true;

//   const baseSelect =
//     this.CHILD_SELECT && this.CHILD_SELECT.trim().length
//       ? this.CHILD_SELECT
//       : 'id, parent_id, full_name, status';

//   const hasStatus = /(^|,)\s*status\s*(,|$)/.test(baseSelect);
//   const selectWithStatus = hasStatus ? baseSelect : `${baseSelect}, status`;

//   const res = await fetchMyChildren(selectWithStatus);
//   this.loading = false;

//   if (!res.ok) {
//     this.error = res.error;
//     return;
//   }

//   const data = (res.data ?? []) as ChildRow[];

//   const rows = data.filter(r => r.status !== 'deleted');

//   this.children = rows;

//   if (this.selectedChild && !rows.some(r => r.id === this.selectedChild)) {
//     this.selectedChild = rows[0]?.id ?? '';
//   }

// }


// toggleChildDetails(child: any) {
//   this.selectedChild = this.selectedChild?.child_uuid === child.child_uuid ? null : child;

//   if (this.selectedChild) {
//     this.editableChild = {
//       ...this.selectedChild,
//       // גיל תמיד מחושב מתאריך, לא נערך
//       age: this.selectedChild.birth_date ? this.getAge(this.selectedChild.birth_date) : null
//     };
//   } else {
//     this.editableChild = null;
//   }

//   this.isEditing = false;
//   this.newChild = null;
// }


// async saveChild() {
//   console.log('saveChild clicked', this.editableChild);

//   if (!this.editableChild?.child_uuid) {
//     this.error = 'לא נבחר ילד לעריכה';
//     return;
//   }

//   const dbc = dbTenant();

//   const newBirthDate =
//     this.editableChild.birth_date || null; 

//   try {
//     const { data, error } = await dbc
//       .from('children')
//       .update({
//         full_name: this.editableChild.full_name,
//         birth_date: newBirthDate,                        
//         health_fund: this.editableChild.health_fund,
//         instructor: this.editableChild.instructor || null,
//         medical_notes: this.editableChild.medical_notes || null
//       })
//       .eq('child_uuid', this.editableChild.child_uuid)
//       .select('child_uuid');

//     if (error) {
//       console.error('שגיאה בשמירת ילד:', error);
//       this.error = error.message ?? 'שגיאה בשמירה';
//       return;
//     }

//     if (!data || data.length === 0) {
//       this.error = 'לא נמצאה רשומה לעדכון (בדקו child_uuid)';
//       return;
//     }

//     // רענון הרשימה
//     await this.loadChildren();

//     const uuid = this.editableChild.child_uuid;
//     const updated = this.children.find(c => c.child_uuid === uuid);

//     if (!updated) {
//       this.selectedChild = null;
//       this.editableChild = null;
//       this.isEditing = false;
//       return;
//     }

//     // שיחזור מצב תצוגה עקבי לאחר רענון
//     this.selectedChild = updated;
//     this.editableChild = {
//       ...updated,
//       age: updated.birth_date ? this.getAge(updated.birth_date) : null
//     };

//     this.isEditing = false;
//     this.error = undefined;
//   } catch (e: any) {
//     console.error('שגיאה לא צפויה בשמירה:', e);
//     this.error = e?.message ?? 'שגיאה לא צפויה';
//   }
// }

//   getAge(birthDate: string): number {
//     if (!birthDate) return 0;
//     const birth = new Date(birthDate);
//     const ageDiff = Date.now() - birth.getTime();
//     return Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
//   }

//   calculateBirthDateFromAge(age: number): string {
//     const today = new Date();
//     const birthYear = today.getFullYear() - age;
//     return new Date(birthYear, today.getMonth(), today.getDate())
//       .toISOString()
//       .split('T')[0];
//   }

//   addNewChild() {
//     this.newChild = {
//       gov_id: '',          // ת"ז (9 ספרות)
//       full_name: '',
//       birth_date: '',
//       gender: '',
//       health_fund: '',
//       instructor: '',
//       status: 'waiting',
//       medical_notes: ''
//     };
//     this.selectedChild = null;
//     this.validationErrors = {};
//   }

//   async saveNewChild() {
//     this.validationErrors = {};

//     if (!/^\d{9}$/.test(this.newChild.gov_id || '')) {
//       this.validationErrors['gov_id'] = 'ת״ז חייבת להכיל בדיוק 9 ספרות';
//     }
//     if (!this.newChild.full_name) this.validationErrors['full_name'] = 'נא להזין שם מלא';
//     if (!this.newChild.birth_date) this.validationErrors['birth_date'] = 'יש לבחור תאריך לידה';
//     if (!this.newChild.gender) this.validationErrors['gender'] = 'יש לבחור מין';
//     if (!this.newChild.health_fund) this.validationErrors['health_fund'] = 'יש לבחור קופת חולים';
    

//     if (Object.keys(this.validationErrors).length > 0) return;

//     const dbc = dbTenant();
//     const parentUid = (await getCurrentUserData())?.uid ?? null;

//     const payload: any = {
//       gov_id: this.newChild.gov_id,          
//       full_name: this.newChild.full_name,
//       birth_date: this.newChild.birth_date,
//       gender: this.newChild.gender,
//       health_fund: this.newChild.health_fund,      
//       status: 'waiting',
//       parent_uid: parentUid , 
//       medical_notes: this.newChild.medical_notes || null
//     };

//     const { data: exists } = await dbc.from('children').select('gov_id').eq('gov_id', this.newChild.gov_id).maybeSingle();
//     if (exists) {
//       this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
//       return;
//     }

//     const { error } = await dbc.from('children').insert(payload);
//     if (error) {
//       if ((error as any).code === '23505') { // unique violation על gov_id
//         this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
//         return;
//       }
//       console.error('שגיאה בהוספת ילד:', error);
//       this.error = error.message ?? 'שגיאה בהוספה';
//       return;
//     }

//     await this.loadChildren();
//     this.newChild = null;
//     this.showInfo('הוספת הילד עברה לאישור מזכירה');

//   }

//   allowOnlyNumbers(event: KeyboardEvent) {
//     if (!/^\d$/.test(event.key)) {
//       event.preventDefault();
//     }
//   }

//   cancelNewChild() {
//     this.newChild = null;
//     this.validationErrors = {};
//   }

//   // מחיקה לוגית
//   showDeleteConfirm = false;

//   confirmDeleteChild() {
//     this.showDeleteConfirm = true;
//   }

//   cancelDelete() {
//     this.showDeleteConfirm = false;
//   }

//   async deleteChild() {
//     if (!this.selectedChild?.child_uuid) return; 

//     const dbc = dbTenant();
//     const { data, error } = await dbc
//       .from('children')
//       .update({ status: 'waiting' })
//       .eq('child_uuid', this.selectedChild.child_uuid).select('child_uuid, status')
//     .single(); 

//     if (error) {
//       console.error('שגיאה במחיקה:', error);
//       this.error = error.message ?? 'שגיאה במחיקה';
//       return;
//     }

//     this.showDeleteConfirm = false;
//     this.selectedChild = null;
//     this.editableChild = null; 
//     await this.loadChildren();
//     this.showInfo('מחיקת הילד עברה לאישור המזכירה');

//   }
// }
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { ChildRow } from '../../Types/detailes.model';

import {
  dbTenant,
  fetchMyChildren,
  getCurrentUserData
} from '../../services/supabaseClient';
type OccurrenceRow = {
  child_id: string;
  start_datetime: string;          // עמודה ב־view (התאימי לשם המדויק אם שונה)
  instructor_id?: string | null;
  status?: string | null;
};

type InstructorRow = { id_number: string; full_name: string | null };

@Component({
  selector: 'app-parent-children',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-children.html',
  styleUrls: ['./parent-children.css']
})
export class ParentChildrenComponent implements OnInit {
  // --- נתונים כלליים ---
  children: ChildRow[] = [];
  loading = true;
  error: string | undefined;
// מפה: child_uuid -> התור הבא שלו
nextAppointments: Record<string, { date: string; time: string; instructor?: string; isToday: boolean; _ts: number } | null> = {};

  // --- בחירה מרובה של כרטיסים ---
  maxSelected = 4;
  selectedIds = new Set<string>();               // child_uuid-ים נבחרים

  // --- עריכה פר-כרטיס ---
  editing: Record<string, boolean> = {};         // לפי child_uuid
  editables: Record<string, any> = {};           // טפסי עריכה פר-כרטיס

  // --- הוספת ילד ---
  newChild: any = null;
  validationErrors: { [key: string]: string } = {};
  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];

  // --- הודעות מידע ---
  infoMessage: string | null = null;
  private infoTimer: any;

  // --- מחיקה/עזיבה ---
  showDeleteConfirm = false;
  pendingDeleteId: string | null = null;

  constructor(private router: Router) {}

  private readonly CHILD_SELECT =
    'child_uuid, gov_id, full_name, birth_date, gender, health_fund, instructor_id, parent_uid, status, medical_notes';

  async ngOnInit() {
    await this.loadChildren();
  }
// מזהה בטוח לכל אובייקט ילד
childId(c: any): string {
  return (c?.['child_uuid'] ?? '') as string;
}

// האם ילד מסומן?
hasSelected(c: any): boolean {
  const id = this.childId(c);
  return !!id && this.selectedIds.has(id);
}

// ל-trackBy ברשימות
trackByChild = (_: number, item: any) => this.childId(item);

  // ====== עזר ======
  private showInfo(msg: string, ms = 5000) {
    this.infoMessage = msg;
    if (this.infoTimer) clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => (this.infoMessage = null), ms);
  }

get selectedChildren(): any[] {
  return this.children.filter(c => this.hasSelected(c));
}
isActiveChild(c: any): boolean {
  return (c?.['status'] ?? '') === 'active';
}

toggleChildSelection(child: any) {
  const id = this.childId(child);
  if (!id) return;

  // לא פעיל? רק מציגים הודעה וחוזרים
  if (!this.isActiveChild(child)) {
    this.showInfo('לא ניתן לפתוח את הכרטיס כי הילד אינו פעיל');
    return;
  }

  // אם כבר פתוח – נסגור
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

  // לפתוח כרטיס
  this.selectedIds.add(id);
  this.ensureEditable(child);
}

  // ====== טעינה ======
  async loadChildren(): Promise<void> {
    this.loading = true;

    const baseSelect =
      this.CHILD_SELECT && this.CHILD_SELECT.trim().length
        ? this.CHILD_SELECT
        : 'child_uuid, full_name, status';

    const hasStatus = /(^|,)\s*status\s*(,|$)/.test(baseSelect);
    const selectWithStatus = hasStatus ? baseSelect : `${baseSelect}, status`;

    const res = await fetchMyChildren(selectWithStatus);
    this.loading = false;

    if (!res.ok) {
      this.error = res.error;
      return;
    }

    const rows = (res.data ?? []).filter((r: any) => r.status !== 'deleted') as ChildRow[];
    this.children = rows;

    // בחירת ברירת מחדל: עד 4 פעילים ראשונים
   if (this.selectedIds.size === 0) {
  const initial = rows.filter(r => r.status === 'active').slice(0, this.maxSelected);
  this.selectedIds = new Set(initial
    .map(r => this.childId(r))
    .filter(Boolean) as string[]);
  initial.forEach(c => this.ensureEditable(c));
}
await this.loadNextAppointments();

  }

  // ====== בחירה מרובה ======

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
// מיפוי ימי השבוע (תחילת שבוע ISO = שני)
private hebDayToIsoIndex(day: string): number {
  const map: Record<string, number> = {
    'שני': 0, 'שלישי': 1, 'רביעי': 2, 'חמישי': 3, 'שישי': 4, 'שבת': 5, 'ראשון': 6
  };
  return map[day] ?? -1;
}

private startOfIsoWeek(d: Date): Date {
  const x = new Date(d);
  const mondayIndex = (x.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  x.setDate(x.getDate() - mondayIndex);
  x.setHours(0, 0, 0, 0);
  return x;
}

private addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

private combineDateTime(date: Date, time: string): Date {
  const [hh, mm = '0', ss = '0'] = (time || '').split(':');
  const x = new Date(date);
  x.setHours(parseInt(hh || '0', 10), parseInt(mm, 10), parseInt(ss, 10), 0);
  return x;
}

private fmtDateHe(d: Date): string {
  //  dd/mm/yyyy
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
private nextOccurrenceForLesson(row: any, now: Date): Date | null {
  const dayIdx = this.hebDayToIsoIndex(row?.day_of_week || '');
  if (dayIdx < 0 || !row?.start_time) return null;

  // עוגן שבוע (ברירת מחדל: תחילת השבוע הנוכחי)
  let anchor = row?.anchor_week_start ? new Date(row.anchor_week_start) : this.startOfIsoWeek(now);
  anchor.setHours(0, 0, 0, 0);

  const rweeks = Math.max(1, Number(row?.repeat_weeks || 1));
  const nowWeek = this.startOfIsoWeek(now);

  // מיישרים לפריטציה של repeat_weeks מול העוגן
  const diffWeeks = Math.max(0, Math.floor((nowWeek.getTime() - anchor.getTime()) / (7 * 24 * 3600 * 1000)));
  const k = Math.floor(diffWeeks / rweeks) * rweeks;
  let wkStart = this.addDays(anchor, k * 7);

  // היום בשבוע בהתבסס על ISO (שני=0 ... ראשון=6)
  let candDate = this.addDays(wkStart, dayIdx);
  let candDT = this.combineDateTime(candDate, row.start_time);

  let guard = 0;
  while (candDT.getTime() < now.getTime() && guard < 300) {
    wkStart = this.addDays(wkStart, rweeks * 7);
    candDate = this.addDays(wkStart, dayIdx);
    candDT = this.combineDateTime(candDate, row.start_time);
    guard++;
  }
  return guard >= 300 ? null : candDT;
}
private async loadNextAppointments(): Promise<void> {
  const ids = this.children.map(c => this.childId(c)).filter(Boolean) as string[];
  if (ids.length === 0) return;

  // ברירת מחדל: אין תורים
  this.nextAppointments = {};
  ids.forEach(id => (this.nextAppointments[id] = null));

  const nowIso = new Date().toISOString();
  const dbc = dbTenant();

  // שולפים את כל המופעים הבאים (מאושר) לכל הילדים, ממויין לפי ילד ואז זמן
  const { data: occRaw, error } = await dbc
    .from('lessons_occurrences')
    .select('child_id, start_datetime, instructor_id, status')
    .in('child_id', ids)
    .gte('start_datetime', nowIso)
    .in('status', ['אושר'])                          // התאימי אם ה־view מחזיר סטטוסים אחרים
    .order('child_id', { ascending: true })
    .order('start_datetime', { ascending: true });

  if (error) {
    console.error('שגיאה בקריאת lessons_occurrences:', error);
    return;
  }

  const occs: OccurrenceRow[] = (occRaw ?? []) as OccurrenceRow[];

  // שמות מדריכים (אופציונלי)
  const instrIds = Array.from(new Set(occs.map(o => o.instructor_id).filter(Boolean))) as string[];
  let instructorNameById: Record<string, string> = {};
  if (instrIds.length) {
    const { data: instRaw } = await dbc
      .from('instructors')
      .select('id_number, full_name')
      .in('id_number', instrIds);

    const inst: InstructorRow[] = (instRaw ?? []) as InstructorRow[];
    instructorNameById = Object.fromEntries(inst.map(i => [i.id_number, i.full_name ?? ''])) as Record<string, string>;
  }

  // בגלל המיון: הפגישה הראשונה לכל ילד תהיה הרשומה הראשונה שנפגוש עבור אותו child_id
  for (const o of occs) {
    const cid = o.child_id;
    if (!cid) continue;
    if (this.nextAppointments[cid]) continue; // כבר קבענו "הקרובה ביותר" לילד זה

    const dt = new Date(o.start_datetime);
this.nextAppointments[cid] = {
  date: this.fmtDateHe(dt),
  time: this.fmtTimeHe(dt),
  instructor: instructorNameById[o.instructor_id ?? ''],
  isToday: this.isSameLocalDate(dt, new Date()),   // ⬅️ חדש
  _ts: dt.getTime(),
};

  }
}
private isSameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

async saveChild(child: any) {
  const id = this.childId(child);
  if (!id) return;
  const model = this.editables[id];
  const dbc = dbTenant();
  const { error } = await dbc.from('children').update({
      full_name: model.full_name,
      birth_date: model.birth_date || null,
      health_fund: model.health_fund || null,
      medical_notes: model.medical_notes || null
    })
    .eq('child_uuid', id)   // <-- כאן עכשיו string בטוח
    .select('child_uuid')
    .single();
  if (!error) this.editing[id] = false;
}

cancelEdit(child: any) {
  const id = this.childId(child);
  if (!id) return;
  const original = this.children.find(c => this.childId(c) === id);
  if (original) this.editables[id] = { ...original };
  this.editing[id] = false;
}





  // ====== חישוב גיל ======
  getAge(birthDate: string): number {
    if (!birthDate) return 0;
    const birth = new Date(birthDate);
    const ageDiff = Date.now() - birth.getTime();
    return Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
  }

  // ====== ניווטי פעולה ======
  goToHistory(child: any) {
  const id = this.childId(child);
  if (!id) return;
  this.router.navigate(['/history'], { queryParams: { child: id } });
}
goToBooking(child: any) {
  const id = this.childId(child);
  if (!id) return;
  this.router.navigate(['/parent-schedule'], { queryParams: { child: id } });
}


  // ====== הוספת ילד ======
  addNewChild() {
    this.newChild = {
      gov_id: '',
      full_name: '',
      birth_date: '',
      gender: '',
      health_fund: '',
      instructor: '',
      status: 'waiting',
      medical_notes: ''
    };
    this.validationErrors = {};
  }

  async saveNewChild() {
    this.validationErrors = {};

    if (!/^\d{9}$/.test(this.newChild.gov_id || '')) {
      this.validationErrors['gov_id'] = 'ת״ז חייבת להכיל בדיוק 9 ספרות';
    }
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
      status: 'waiting',
      parent_uid: parentUid,
      medical_notes: this.newChild.medical_notes || null
    };

    const { data: exists } = await dbc
      .from('children')
      .select('gov_id')
      .eq('gov_id', this.newChild.gov_id)
      .maybeSingle();
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
      console.error('שגיאה בהוספת ילד:', error);
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

  // ====== מחיקה/עזיבה ======

  cancelDelete() {
    this.showDeleteConfirm = false;
    this.pendingDeleteId = null;
  }

confirmDeleteChild(child: any) {
  const id = this.childId(child);
  if (!id) return;
  this.pendingDeleteId = id;
  this.showDeleteConfirm = true;
}

async deleteChild() {
  if (!this.pendingDeleteId) return;
  const dbc = dbTenant();
  const { error } = await dbc
    .from('children')
    .update({ status: 'waiting' })
    .eq('child_uuid', this.pendingDeleteId);
  if (!error) {
    this.selectedIds.delete(this.pendingDeleteId);
    this.showDeleteConfirm = false;
    this.pendingDeleteId = null;
    await this.loadChildren();
    this.showInfo('הבקשה להסרת הילד נשלחה למזכירה');
  }
}


  // ====== תצוגות "התור הבא" ו"פעילות אחרונה" (ממלא מקום) ======
  // חברי כאן לשאילתה/שירותים המתאימים של שיעורים/יומן.
  getNextAppointment(child: any) {
  const id = this.childId(child);
  const v = id ? this.nextAppointments[id] : null;
  if (!v) return null;
  const { date, time, instructor, isToday } = v;   // ⬅️ כולל isToday
  return { date, time, instructor, isToday };
}



  getLastActivity(_child: ChildRow): { desc: string; date: string; rating?: number } | null {
    // TODO: למשוך מה-DB
    return null;
  }
  closeCard(child: any) {
  const id = this.childId(child);
  if (!id) return;
  // מסירים מהתצוגה בלבד
  this.selectedIds.delete(id);
  delete this.editing[id];
  delete this.editables[id];
}

}

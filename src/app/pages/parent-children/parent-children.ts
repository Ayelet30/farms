import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  dbTenant,                  // CHANGED: לעבוד מול סכימת הטננט
  fetchMyChildren,           // נשתמש עם select מלא
  getCurrentUserData         // בשביל parent_uid ב-INSERT
} from '../../services/supabaseClient';

@Component({
  selector: 'app-parent-children',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-children.html',
  styleUrls: ['./parent-children.css']
})
export class ParentChildrenComponent implements OnInit {
  children: any[] = [];
  selectedChild: any = null;
  editableChild: any = null;
  isEditing = false;
  loading = true;
  error: string | undefined;


  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];
  //instructors: { id?: string | number; full_name: string }[] = [];
  validationErrors: { [key: string]: string } = {};
  newChild: any = null;
  

  // CHANGED: ה-SELECT כולל את המזהה החדש child_uuid ואת gov_id (ת"ז)
  private readonly CHILD_SELECT =
    'child_uuid, gov_id, full_name, birth_date, gender, health_fund, instructor, parent_uid, status , medical_notes'; // CHANGED

  async ngOnInit() {
    await this.loadChildren();
   // await this.loadInstructors(); // CHANGED: בלי farm
  }

  async loadChildren() {
    this.loading = true;
    const res = await fetchMyChildren(this.CHILD_SELECT); // CHANGED
    this.loading = false;

    if (!res.ok) {
      this.error = res.error;
    } else {
      this.children = res.data ?? [];
    }
  }

  toggleChildDetails(child: any) {
    // CHANGED: השוואה לפי child_uuid במקום id
    this.selectedChild = this.selectedChild?.child_uuid === child.child_uuid ? null : child; // CHANGED

    this.editableChild = this.selectedChild
      ? {
          ...this.selectedChild,
          age: this.selectedChild.birth_date ? this.getAge(this.selectedChild.birth_date) : null
        }
      : null;

    this.isEditing = false;
    this.newChild = null;
  }

  async saveChild() {
    if (!this.editableChild) return;

    const dbc = dbTenant();

    // חישוב גיל -> תאריך לידה חדש אם נערך
    const newBirthDate =
      this.editableChild.age != null
        ? this.calculateBirthDateFromAge(this.editableChild.age)
        : this.editableChild.birth_date;

    // CHANGED: אין עדכון id, ואין שימוש ב-id; מסננים לפי child_uuid
    const { error } = await dbc
      .from('children')
      .update({
        full_name: this.editableChild.full_name,
        birth_date: newBirthDate,
        health_fund: this.editableChild.health_fund,
        instructor: this.editableChild.instructor || null,
        gender: this.editableChild.gender , 
         medical_notes: this.newChild.medical_notes || null
      })
      .eq('child_uuid', this.editableChild.child_uuid); // CHANGED

    if (error) {
      console.error('שגיאה בשמירת ילד:', error);
      this.error = error.message ?? 'שגיאה בשמירה';
      return;
    }

    await this.loadChildren();

    // CHANGED: למצוא מחדש לפי child_uuid
    const updated = this.children.find(c => c.child_uuid === this.editableChild.child_uuid); // CHANGED
    this.selectedChild = updated ?? null;
    this.isEditing = false;
  }

  getAge(birthDate: string): number {
    if (!birthDate) return 0;
    const birth = new Date(birthDate);
    const ageDiff = Date.now() - birth.getTime();
    return Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
  }

  calculateBirthDateFromAge(age: number): string {
    const today = new Date();
    const birthYear = today.getFullYear() - age;
    return new Date(birthYear, today.getMonth(), today.getDate())
      .toISOString()
      .split('T')[0];
  }

  // // CHANGED: טעינת מדריכים מהסכימה של הטננט; בלי farm_id
  // async loadInstructors() {
  //   const dbc = dbTenant();
  //   const { data, error } = await dbc
  //     .from('instructors')
  //     .select('id, full_name')
  //     .order('full_name');

  //   if (error) {
  //     console.error('שגיאה בטעינת מדריכים:', error);
  //     this.instructors = [];
  //   } else {
  //     this.instructors = (data ?? []).map((d: any) => ({ id: d.id, full_name: d.full_name }));
  //   }
  //}

  addNewChild() {
    // CHANGED: הוספת gov_id (ת"ז) ב"ילד חדש". לא מזינים child_uuid (נוצר אוטומטית)
    this.newChild = {
      gov_id: '',          // CHANGED: ת"ז (9 ספרות)
      full_name: '',
      birth_date: '',
      gender: '',
      health_fund: '',
      instructor: '',
      status: 'waiting',
      medical_notes: ''
    };
    this.selectedChild = null;
    this.validationErrors = {};
  }

  async saveNewChild() {
    this.validationErrors = {};

    // CHANGED: ולידציה על gov_id
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

    // CHANGED: לא שולחים child_uuid; כן שולחים gov_id
    const payload: any = {
      gov_id: this.newChild.gov_id,          // CHANGED
      full_name: this.newChild.full_name,
      birth_date: this.newChild.birth_date,
      gender: this.newChild.gender,
      health_fund: this.newChild.health_fund,
      instructor: this.newChild.instructor || null,
      status: 'waiting',
      parent_uid: parentUid , 
      medical_notes: this.newChild.medical_notes || null
    };

    // אופציונלי: בדיקת כפילות gov_id להודעה ידידותית
    const { data: exists } = await dbc.from('children').select('gov_id').eq('gov_id', this.newChild.gov_id).maybeSingle();
    if (exists) {
      this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
      return;
    }

    const { error } = await dbc.from('children').insert(payload);
    if (error) {
      if ((error as any).code === '23505') { // unique violation על gov_id
        this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
        return;
      }
      console.error('שגיאה בהוספת ילד:', error);
      this.error = error.message ?? 'שגיאה בהוספה';
      return;
    }

    await this.loadChildren();
    this.newChild = null;
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  }

  cancelNewChild() {
    this.newChild = null;
    this.validationErrors = {};
  }

  // מחיקה לוגית
  showDeleteConfirm = false;

  confirmDeleteChild() {
    this.showDeleteConfirm = true;
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
  }

  async deleteChild() {
    if (!this.selectedChild?.child_uuid) return; // CHANGED

    const dbc = dbTenant();
    const { error } = await dbc
      .from('children')
      .update({ status: 'deleted' })
      .eq('child_uuid', this.selectedChild.child_uuid); // CHANGED

    if (error) {
      console.error('שגיאה במחיקה:', error);
      this.error = error.message ?? 'שגיאה במחיקה';
      return;
    }

    this.showDeleteConfirm = false;
    this.selectedChild = null;
    await this.loadChildren();
  }
}

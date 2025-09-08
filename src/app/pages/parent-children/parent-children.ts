import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { ChildRow } from '../../Types/detailes.model';

import {
  dbTenant,                  // : לעבוד מול סכימת הטננט
  fetchMyChildren,           //   select מלא
  getCurrentUserData         // בשביל parent_uid ב-INSERT
} from '../../services/supabaseClient';
import { ScheduleComponent } from "../../custom-widget/schedule/schedule";

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
  infoMessage: string | null = null;
private infoTimer: any;


  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];
  validationErrors: { [key: string]: string } = {};
  newChild: any = null;
  
  

private readonly CHILD_SELECT =
  'child_uuid, gov_id, full_name, birth_date, gender, health_fund, instructor_id, parent_uid, status, medical_notes';

  async ngOnInit() {
    await this.loadChildren();
  }
private showInfo(msg: string, ms = 5000) {
  this.infoMessage = msg;
  if (this.infoTimer) clearTimeout(this.infoTimer);
  this.infoTimer = setTimeout(() => (this.infoMessage = null), ms);
}


async loadChildren(): Promise<void> {
  this.loading = true;

  const baseSelect =
    this.CHILD_SELECT && this.CHILD_SELECT.trim().length
      ? this.CHILD_SELECT
      : 'id, parent_id, full_name, status';

  const hasStatus = /(^|,)\s*status\s*(,|$)/.test(baseSelect);
  const selectWithStatus = hasStatus ? baseSelect : `${baseSelect}, status`;

  const res = await fetchMyChildren(selectWithStatus);
  this.loading = false;

  if (!res.ok) {
    this.error = res.error;
    return;
  }

  const data = (res.data ?? []) as ChildRow[];

  const rows = data.filter(r => r.status !== 'deleted');

  this.children = rows;

  if (this.selectedChild && !rows.some(r => r.id === this.selectedChild)) {
    this.selectedChild = rows[0]?.id ?? '';
  }

}


toggleChildDetails(child: any) {
  this.selectedChild = this.selectedChild?.child_uuid === child.child_uuid ? null : child;

  if (this.selectedChild) {
    this.editableChild = {
      ...this.selectedChild,
      // גיל תמיד מחושב מתאריך, לא נערך
      age: this.selectedChild.birth_date ? this.getAge(this.selectedChild.birth_date) : null
    };
  } else {
    this.editableChild = null;
  }

  this.isEditing = false;
  this.newChild = null;
}


async saveChild() {
  console.log('saveChild clicked', this.editableChild);

  if (!this.editableChild?.child_uuid) {
    this.error = 'לא נבחר ילד לעריכה';
    return;
  }

  const dbc = dbTenant();

  const newBirthDate =
    this.editableChild.birth_date || null; 

  try {
    const { data, error } = await dbc
      .from('children')
      .update({
        full_name: this.editableChild.full_name,
        birth_date: newBirthDate,                        
        health_fund: this.editableChild.health_fund,
        instructor: this.editableChild.instructor || null,
        medical_notes: this.editableChild.medical_notes || null
      })
      .eq('child_uuid', this.editableChild.child_uuid)
      .select('child_uuid');

    if (error) {
      console.error('שגיאה בשמירת ילד:', error);
      this.error = error.message ?? 'שגיאה בשמירה';
      return;
    }

    if (!data || data.length === 0) {
      this.error = 'לא נמצאה רשומה לעדכון (בדקו child_uuid)';
      return;
    }

    // רענון הרשימה
    await this.loadChildren();

    const uuid = this.editableChild.child_uuid;
    const updated = this.children.find(c => c.child_uuid === uuid);

    if (!updated) {
      this.selectedChild = null;
      this.editableChild = null;
      this.isEditing = false;
      return;
    }

    // שיחזור מצב תצוגה עקבי לאחר רענון
    this.selectedChild = updated;
    this.editableChild = {
      ...updated,
      age: updated.birth_date ? this.getAge(updated.birth_date) : null
    };

    this.isEditing = false;
    this.error = undefined;
  } catch (e: any) {
    console.error('שגיאה לא צפויה בשמירה:', e);
    this.error = e?.message ?? 'שגיאה לא צפויה';
  }
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

  addNewChild() {
    this.newChild = {
      gov_id: '',          // ת"ז (9 ספרות)
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
      parent_uid: parentUid , 
      medical_notes: this.newChild.medical_notes || null
    };

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
    this.showInfo('הוספת הילד עברה לאישור מזכירה');

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
    if (!this.selectedChild?.child_uuid) return; 

    const dbc = dbTenant();
    const { data, error } = await dbc
      .from('children')
      .update({ status: 'waiting' })
      .eq('child_uuid', this.selectedChild.child_uuid).select('child_uuid, status')
    .single(); 

    if (error) {
      console.error('שגיאה במחיקה:', error);
      this.error = error.message ?? 'שגיאה במחיקה';
      return;
    }

    this.showDeleteConfirm = false;
    this.selectedChild = null;
    this.editableChild = null; 
    await this.loadChildren();
    this.showInfo('מחיקת הילד עברה לאישור המזכירה');

  }
}

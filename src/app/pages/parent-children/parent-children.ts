import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { fetchMyChildren, getCurrentUserData, getMyChildren, getSupabaseClient } from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';

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
  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];
  instructors: string[] = [];
  validationErrors: { [key: string]: string } = {};
  error: string | undefined;



  async ngOnInit() {
      const res = await fetchMyChildren();
    this.loading = false;
    if (!res.ok) this.error = res.error;
    else this.children = res.data;

    const farmId = this.children[0]?.farm_id;
    if (farmId) {
      await this.loadInstructors(farmId);
    }
    this.loading = false;
  }

  toggleChildDetails(child: any) {
    this.selectedChild = this.selectedChild?.id === child.id ? null : child;

    // יצירת עותק עם שדה גיל מחושב
    this.editableChild = {
      ...child,
      age: this.getAge(child.birth_date)
    };

    this.isEditing = false;
    this.newChild = null; 

  }
  async saveChild() {
    const supabase = getSupabaseClient();

    // חשב גיל חדש (אם יש צורך)
    const newBirthDate = this.calculateBirthDateFromAge(this.editableChild.age);

    const { error } = await supabase
      .from('children')
      .update({
        full_name: this.editableChild.full_name,
        birth_date: newBirthDate,
        health_fund: this.editableChild.health_fund,
        instructor: this.editableChild.instructor,
        gender: this.editableChild.gender
      })
      .eq('id', this.editableChild.id);

    if (error) {
      console.error("שגיאה בשמירה:", error);
      return;
    }

    // עדכון מקומי ב־selectedChild + ברשימת הילדים
    this.selectedChild = { ...this.editableChild };
    this.selectedChild.birth_date = newBirthDate;

    const index = this.children.findIndex(c => c.id === this.editableChild.id);
    if (index !== -1) {
      this.children[index] = { ...this.editableChild };
      this.children[index].birth_date = newBirthDate;
    }

    // סיום עריכה
    this.isEditing = false;
  }

  getAge(birthDate: string): number {
    const birth = new Date(birthDate);
    const ageDiff = Date.now() - birth.getTime();
    return Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));
  }

  calculateBirthDateFromAge(age: number): string {
    const today = new Date();
    const birthYear = today.getFullYear() - age;
    return new Date(birthYear, today.getMonth(), today.getDate()).toISOString().split('T')[0];
  }

  async loadInstructors(farmId: string) {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('instructors')
      .select('full_name')
      .eq('farm_id', farmId);

    if (error) {
      console.error("שגיאה בטעינת מדריכים:", error);
    } else {
      this.instructors = data.map(d => d.full_name);
    }
  }
  newChild: any = null;

  addNewChild() {
    this.newChild = {
      full_name: '',
      birth_date: '',
      gender: '',
      health_fund: '',
      instructor: '',
      status: 'waiting'
    };
    this.selectedChild = null;
  }
  async getFarmId(): Promise<string | null> {
    const userData = await getCurrentUserData(); // מתוך supabase.service.ts
    return userData?.farm_id ?? null;
  }
  async loadChildren() {
  const res = await fetchMyChildren();
    this.loading = false;
    if (!res.ok) this.error = res.error;
    else this.children = res.data;

}

  async saveNewChild() {
    this.validationErrors = {}; // איפוס שגיאות

    // בדיקות
    if (!this.newChild.id || this.newChild.id.length !== 9) {
      this.validationErrors['id'] = 'ת"ז חייבת להכיל בדיוק 9 ספרות';
    }

    if (!this.newChild.full_name) {
      this.validationErrors['full_name'] = 'נא להזין שם מלא';
    }

    if (!this.newChild.birth_date) {
      this.validationErrors['birth_date'] = 'יש לבחור תאריך לידה';
    }

    if (!this.newChild.gender) {
      this.validationErrors['gender'] = 'יש לבחור מין';
    }

    if (!this.newChild.health_fund) {
      this.validationErrors['health_fund'] = 'יש לבחור קופת חולים';
    }

    // if (!this.newChild.instructor) {
    //   this.validationErrors['instructor'] = 'יש לבחור מדריך';
    // }

    // אם יש שגיאות, עצור
    if (Object.keys(this.validationErrors).length > 0) {
      return;
    }

    // בדיקת כפילות
    // const { data: existingChild } = await this.supabase
    //   .from('children')
    //   .select('id')
    //   .eq('id', this.newChild.id)
    //   .maybeSingle();
      

    // if (existingChild) {
    //   this.validationErrors['id'] = 'ת"ז זו כבר קיימת במערכת';
    //   return;
    // }

    // המשך שמירה...
    const uid = (await getCurrentUserData())?.uid;
    const farmId = await this.getFarmId();

    // const { error } = await this.supabase
    //   .from('children')
    //   .insert({
    //     id: this.newChild.id,
    //     full_name: this.newChild.full_name,
    //     birth_date: this.newChild.birth_date,
    //     gender: this.newChild.gender,
    //     health_fund: this.newChild.health_fund,
    //     instructor: this.newChild.instructor,
    //     status: 'waiting',
    //     parent_uid: uid,
    //     farm_id: farmId
    //   });
      //נדרש להוסיף שליחה לאישור המזכירה 
    // if (!error) {
    //   this.loadChildren();
    //   this.newChild = null;
    // }
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    const charCode = event.key;
    if (!/^\d$/.test(charCode)) {
      event.preventDefault();
    }
  }

  cancelNewChild() {
    this.newChild = null;
    this.validationErrors = {};

  }
showDeleteConfirm = false;

confirmDeleteChild() {
  this.showDeleteConfirm = true;
}

cancelDelete() {
  this.showDeleteConfirm = false;
}

async deleteChild() {
//   const { error } = await this.supabase
//     .from('children')
//     .update({ status: 'deleted' })
//     .eq('id', this.selectedChild.id);

//   if (!error) {
//     this.showDeleteConfirm = false;
//     this.selectedChild = null;
//     this.loadChildren(); // מרענן את הרשימה
//   }
}



}

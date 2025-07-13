import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getSupabaseClient } from '../../services/supabase.service';

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

  async ngOnInit() {
    const supabase = getSupabaseClient();

    // טוען את הילדים
    const { data: childrenData } = await supabase.from('children').select('*');
    this.children = childrenData || [];

    // טוען מדריכים לפי farm_id של הילד הראשון (או תחליפי לפי איך שיש לך)
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

}

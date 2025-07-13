import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { getSupabaseClient } from '../../services/supabase.service';
import { getAuth } from '@angular/fire/auth';

@Component({
  selector: 'app-parent-children',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './parent-children.html',
  styleUrls: ['./parent-children.css']
})
export class ParentChildrenComponent implements OnInit {
  children: any[] = [];
  loading = true;
  selectedChild: any = null;

  async ngOnInit() {
    const auth = getAuth();
    const parentUid = auth.currentUser?.uid;

    if (!parentUid) {
      console.error('לא נמצא מזהה הורה');
      return;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('children')
      .select('*')
      .eq('parent_uid', parentUid);

    if (error) {
      console.error('שגיאה בשליפת ילדים:', error.message);
      return;
    }

    this.children = data || [];
    this.loading = false;

    console.log('ילדים:', this.children);
  }

  getAge(birthdate: string): number {
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  toggleChildDetails(child: any) {
    this.selectedChild = this.selectedChild?.id === child.id ? null : child;
  }
}

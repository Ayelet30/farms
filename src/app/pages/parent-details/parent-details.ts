import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { getCurrentUserData, getSupabaseClient } from '../../services/supabase.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-parent-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-details.html',
  styleUrls: ['./parent-details.css']
})
export class ParentDetailsComponent implements OnInit {
  parent: any = null;
  children: any[] = [];
  loading = true;
  isEditing = false;
  editableParent: any = {
    full_name: '',
    address: '',
    phone: '',
    email: ''
  };



  async ngOnInit() {
    const user = await getCurrentUserData();
    if (!user?.uid) {
      this.loading = false;
      return;
    }

    const supabase = getSupabaseClient();

    // שליפת פרטי ההורה
    const { data: parentData, error: parentError } = await supabase
      .from('parents')
      .select('*')
      .eq('uid', user.uid)
      .single();

    if (!parentError && parentData) {
      this.parent = parentData;
      this.editableParent = { ...parentData };

      // שליפת הילדים של ההורה
      const { data: childrenData, error: childrenError } = await supabase
        .from('children')
        .select('*')
        .eq('parent_uid', parentData.uid);



      if (!childrenError) {
        this.children = childrenData;
      }
    }

    this.loading = false;
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active': return 'פעיל';
      case 'waiting': return 'ממתין לאישור מזכירה';
      case 'deleted': return 'נמחק';
      default: return 'לא ידוע';
    }
  }

  getAge(dateString: string): number {
    const birth = new Date(dateString);
    const diff = Date.now() - birth.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  }
  editing = false;
  editForm = {
    full_name: '',
    address: '',
    phone: '',
    email: ''
  };

  enableEditing() {
    this.editing = true;
    this.editForm = {
      full_name: this.parent.full_name || '',
      address: this.parent.address || '',
      phone: this.parent.phone || '',
      email: this.parent.email || ''
    };
  }
  phoneError = '';
  emailError = '';

  async saveParent() {
    // ולידציה לטלפון
    const phoneRegex = /^05\d{8}$/;
    if (!phoneRegex.test(this.editableParent.phone)) {
      this.phoneError = 'מספר טלפון לא תקין. יש להזין מספר סלולרי בן 10 ספרות המתחיל ב-05.';
      return;
    }

    // ולידציה לאימייל
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.editableParent.email)) {
      this.emailError = 'כתובת מייל לא תקינה.';
      return;
    }
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('parents')
      .update({
        full_name: this.editableParent.full_name,
        address: this.editableParent.address,
        phone: this.editableParent.phone,
        email: this.editableParent.email
      })
      .eq('uid', this.parent.uid);

    if (!error) {
      this.parent = { ...this.editableParent };
      this.isEditing = false;
      this.phoneError = '';
      this.emailError = '';
    }
  }
  cancelEdit() {
  this.isEditing = false;
  this.editableParent = { ...this.parent };
  this.phoneError = '';
  this.emailError = '';
}

}

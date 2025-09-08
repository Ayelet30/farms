import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getCurrentUserData } from '../../services/supabaseClient';
import { OnDestroy } from '@angular/core';
// ...


@Component({
  selector: 'app-parent-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-details.html',
  styleUrls: ['./parent-details.css']
})
export class ParentDetailsComponent implements OnInit, OnDestroy  {

ngOnDestroy() {
  if (this.infoTimer) clearTimeout(this.infoTimer);
}
  parent: any = null;
  children: any[] = [];
  visibleChildren: any[] = [];

  loading = true;
  isEditing = false;
  error?: string;

  editableParent: any = {
    full_name: '',
    address: '',
    phone: '',
    email: ''
  };

  phoneError = '';
  emailError = '';
  infoMessage: string | null = null;
private infoTimer: ReturnType<typeof setTimeout> | null = null;


  // SELECT מפורש
  private readonly PARENT_SELECT =
  'uid, id_number, full_name, address, phone, email';

  private readonly CHILD_SELECT =
    'child_uuid, full_name, gov_id, birth_date, gender, health_fund, status, medical_notes, parent_uid';

  async ngOnInit() {
    try {
      const user = await getCurrentUserData();
      if (!user?.uid) {
        this.loading = false;
        this.error = 'משתמש לא מחובר';
        return;
      }

      const dbc = dbTenant();

      // שליפת פרטי ההורה מהסכמה של הטננט
      const { data: parentData, error: parentError } = await dbc
        .from('parents')
        .select(this.PARENT_SELECT)
        .eq('uid', user.uid)
        .single();

      if (parentError) {
        this.error = parentError.message ?? 'שגיאה בטעינת הורה';
        this.loading = false;
        return;
      }

      this.parent = parentData;
      this.editableParent = { ...parentData };

      // שליפת הילדים של ההורה
      const { data: childrenData, error: childrenError } = await dbc
        .from('children')
        .select(this.CHILD_SELECT)
        .eq('parent_uid', parentData.uid);

      if (childrenError) {
        this.error = childrenError.message ?? 'שגיאה בטעינת ילדים';
        this.loading = false;
        return;
      }

      this.children = childrenData ?? [];
      this.visibleChildren = this.children.filter(c => c.status !== 'deleted');
    } catch (e: any) {
      this.error = e?.message ?? 'שגיאה לא צפויה';
    } finally {
      this.loading = false;
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active':   return 'פעיל';
      case 'waiting':  return 'ממתין לאישור מזכירה';
      case 'deleted':  return 'נמחק';
      default:         return 'לא ידוע';
    }
  }
private showInfo(msg: string, ms = 5000) {
  this.infoMessage = msg;
  if (this.infoTimer) clearTimeout(this.infoTimer);
  this.infoTimer = setTimeout(() => {
    this.infoMessage = null;
    this.infoTimer = null;
  }, ms);
}



  getAge(dateString: string): number {
    if (!dateString) return 0;
    const birth = new Date(dateString);
    const diff = Date.now() - birth.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  }

  enableEditing() {
    this.isEditing = true;
    this.phoneError = '';
    this.emailError = '';
    this.error = undefined;
    this.editableParent = {
      full_name: this.parent?.full_name ?? '',
      address:   this.parent?.address ?? '',
      phone:     this.parent?.phone ?? '',
      email:     this.parent?.email ?? ''
    };
      this.infoMessage = null;   // ⬅️ הוספה

  }

  cancelEdit() {
    this.isEditing = false;
    this.phoneError = '';
    this.emailError = '';
    this.error = undefined;
    this.editableParent = { ...this.parent };
  }

  async saveParent() {
    // ולידציה לטלפון
    const phoneRegex = /^05\d{8}$/;
    if (!phoneRegex.test(this.editableParent.phone || '')) {
      this.phoneError = 'מספר טלפון לא תקין. יש להזין מספר סלולרי בן 10 ספרות המתחיל ב-05.';
      return;
    } else {
      this.phoneError = '';
    }

    // ולידציה לאימייל
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.editableParent.email || '')) {
      this.emailError = 'כתובת מייל לא תקינה.';
      return;
    } else {
      this.emailError = '';
    }

    try {
      const dbc = dbTenant();

      const { error } = await dbc
        .from('parents')
        .update({
          full_name: this.editableParent.full_name,
          address:   this.editableParent.address,
          phone:     this.editableParent.phone,
          email:     this.editableParent.email
        })
        .eq('uid', this.parent.uid);

      if (error) {
        this.error = error.message ?? 'שגיאה בשמירת פרטי ההורה';
        return;
      }

      this.parent = { ...this.editableParent };
      this.isEditing = false;
      this.error = undefined;
    } catch (e: any) {
      this.error = e?.message ?? 'שגיאה לא צפויה בשמירה';
    }
    this.showInfo('פרטי ההורה נשמרו בהצלחה');  

  }
}

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getCurrentUserData } from '../../services/legacy-compat';
import { OnDestroy } from '@angular/core';
// ...
type ParentNotify = {
  email?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
};


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
  first_name: '',
  last_name: '',
  address: '',
  phone: '',
  email: '',
  notify: {
    email: true,
    sms: false,
    whatsapp: false,
  } as ParentNotify,
};

showConfirmDialog = false;


  phoneError = '';
  emailError = '';
  infoMessage: string | null = null;
private infoTimer: ReturnType<typeof setTimeout> | null = null;


  // SELECT מפורש
 private readonly PARENT_SELECT =
  'uid, id_number, first_name, last_name, address, phone, email, notify, billing_day_of_month';


  private readonly CHILD_SELECT =
 'child_uuid, first_name, last_name, gov_id, birth_date, gender, health_fund, status, medical_notes, parent_uid';
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

this.editableParent = {
  first_name: parentData.first_name ?? '',
  last_name:  parentData.last_name ?? '',
  address:    parentData.address ?? '',
  phone:      parentData.phone ?? '',
  email:      parentData.email ?? '',
  notify: {
    email:    parentData.notify?.email ?? true,
    sms:      parentData.notify?.sms ?? false,
    whatsapp: parentData.notify?.whatsapp ?? false,
  } as ParentNotify,
};


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

private validateParent(): boolean {
  // ולידציה לטלפון
  const phoneRegex = /^05\d{8}$/;
  if (!phoneRegex.test(this.editableParent.phone || '')) {
    this.phoneError = 'מספר טלפון לא תקין. יש להזין מספר סלולרי בן 10 ספרות המתחיל ב-05.';
    return false;
  } else {
    this.phoneError = '';
  }

  // ולידציה לאימייל
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(this.editableParent.email || '')) {
    this.emailError = 'כתובת מייל לא תקינה.';
    return false;
  } else {
    this.emailError = '';
  }

  return true;
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
    first_name: this.parent?.first_name ?? '',
    last_name:  this.parent?.last_name ?? '',
    address:    this.parent?.address ?? '',
    phone:      this.parent?.phone ?? '',
    email:      this.parent?.email ?? '',
    notify: {
      email:    this.parent?.notify?.email ?? true,
      sms:      this.parent?.notify?.sms ?? false,
      whatsapp: this.parent?.notify?.whatsapp ?? false,
    } as ParentNotify,
  };

  this.infoMessage = null;
}


  cancelEdit() {
    this.isEditing = false;
    this.phoneError = '';
    this.emailError = '';
    this.error = undefined;
    this.editableParent = { ...this.parent };
  }
// בתוך ParentDetailsComponent

onSaveClick() {
  this.error = undefined;

  // אם יש שגיאות – לא נפתח מודאל
  if (!this.validateParent()) {
    return;
  }

  this.showConfirmDialog = true;
}
confirmSave() {
  this.showConfirmDialog = false;
  this.saveParent();
}

cancelSaveDialog() {
  this.showConfirmDialog = false;     // לסגור מודאל
  this.cancelEdit();                  // ⬅️ לצאת ממצב עריכה ולהחזיר ערכים מקוריים
}


  async saveParent() {
  try {
    const dbc = dbTenant();

   const { error } = await dbc
  .from('parents')
  .update({
    first_name: this.editableParent.first_name,
    last_name:  this.editableParent.last_name,
    address:    this.editableParent.address,
    phone:      this.editableParent.phone,
    email:      this.editableParent.email,
    notify:     this.editableParent.notify,  
  })
  .eq('uid', this.parent.uid);


    if (error) {
      this.error = error.message ?? 'שגיאה בשמירת פרטי ההורה';
      return;
    }

    this.parent = { ...this.editableParent };
    this.isEditing = false;
    this.error = undefined;
    this.showInfo('פרטי ההורה נשמרו בהצלחה');
  } catch (e: any) {
    this.error = e?.message ?? 'שגיאה לא צפויה בשמירה';
  }
}

}

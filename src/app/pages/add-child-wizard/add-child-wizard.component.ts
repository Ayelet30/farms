import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getCurrentUserData } from '../../services/supabaseClient.service';

type ChildStatus = 'Active' | 'Pending Deletion Approval' | 'Pending Addition Approval' | 'Deleted';

interface MedicalFlags {
  growthDelay: boolean;
  epilepsy: boolean;
  autismSpectrum: boolean;
  physicalDisability: boolean;
  cognitiveDisability: boolean;
  emotionalIssues: boolean;
  other: string;
  
  autismFunction?: 'low' | 'high' | null;   
}

interface PaymentInfo {
  chargeDay: number | null;        // יום בחודש לחיוב
  registrationAmount: number | null; // סכום דמי הרשמה (אופציונלי)
  cardHolderId: string;            // ת"ז בעל/ת הכרטיס
  cardLast4: string;               // 4 ספרות אחרונות (או אסימון – לפי טרנזילה שלך)
}

@Component({
  selector: 'app-add-child-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-child-wizard.component.html',
  styleUrls: ['./add-child-wizard.component.scss'],
})
export class AddChildWizardComponent {
  @Output() closed = new EventEmitter<void>();
  @Output() childAdded = new EventEmitter<void>(); // ההורה יעשה loadChildren

  // שלבים
  steps = ['פרטי ילד', 'שאלון רפואי', 'תקנון', 'תשלום הרשמה'];
  stepIndex = 0;

  // מצב כללי
  saving = false;
  error: string | null = null;

  // מודל נתונים
  child = {
    gov_id: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    gender: '',
    health_fund: '',
    medical_notes_free: '',
    status: 'Pending Addition Approval' as ChildStatus,
  };

  healthFunds: string[] = ['כללית', 'מאוחדת', 'מכבי', 'לאומית'];

  medical: MedicalFlags = {
    growthDelay: false,
    epilepsy: false,
    autismSpectrum: false,
    physicalDisability: false,
    cognitiveDisability: false,
    emotionalIssues: false,
    other: '',
    autismFunction: null,
  };

  termsAccepted = false;
  termsSignature = '';

  payment: PaymentInfo = {
    chargeDay: null,
    registrationAmount: null,
    cardHolderId: '',
    cardLast4: '',
  };

  validationErrors: { [key: string]: string } = {};

  /* ---------- ניווט בין שלבים ---------- */

  goToStep(index: number) {
    if (index < 0 || index >= this.steps.length) return;
    // לא מאפשרים לקפוץ קדימה מעל שלב שלא עבר ולידציה
    if (index > this.stepIndex && !this.validateCurrentStep()) return;
    this.stepIndex = index;
  }

  nextStep() {
    if (!this.validateCurrentStep()) return;
    if (this.stepIndex < this.steps.length - 1) {
      this.stepIndex++;
    }
  }

  prevStep() {
    if (this.stepIndex > 0) this.stepIndex--;
  }

  close() {
    if (this.saving) return;
    this.closed.emit();
  }

  /* ---------- ולידציה ---------- */

  private validateCurrentStep(): boolean {
  this.validationErrors = {};
  this.error = null;

  switch (this.stepIndex) {
    case 0:
      this.validateChildDetails();
      break;
    case 1:
      this.validateMedical();   // ← כאן
      break;
    case 2:
      this.validateTerms();
      break;
    case 3:
      this.validatePayment();
      break;
  }

  return Object.keys(this.validationErrors).length === 0 && !this.error;
}


  private validateChildDetails() {
    if (!/^\d{9}$/.test(this.child.gov_id || '')) {
      this.validationErrors['gov_id'] = 'ת״ז חייבת להכיל בדיוק 9 ספרות';
    }
    if (!this.child.first_name) {
      this.validationErrors['first_name'] = 'נא להזין שם פרטי';
    }
    if (!this.child.last_name) {
      this.validationErrors['last_name'] = 'נא להזין שם משפחה';
    }
    if (!this.child.birth_date) {
      this.validationErrors['birth_date'] = 'יש לבחור תאריך לידה';
    }
    if (!this.child.gender) {
      this.validationErrors['gender'] = 'יש לבחור מין';
    }
    if (!this.child.health_fund) {
      this.validationErrors['health_fund'] = 'יש לבחור קופת חולים';
    }
  }

  private validateTerms() {
    if (!this.termsAccepted) {
      this.validationErrors['terms'] = 'יש לאשר את התקנון לפני המשך';
    }
    if (!this.termsSignature.trim()) {
      this.validationErrors['signature'] = 'נא להזין שם כמין חתימה דיגיטלית';
    }
  }

  private validatePayment() {
    if (!this.payment.chargeDay || this.payment.chargeDay < 1 || this.payment.chargeDay > 28) {
      this.validationErrors['chargeDay'] = 'נא לבחור יום חיוב בין 1 ל-28';
    }
    if (!this.payment.cardHolderId || !/^\d{9}$/.test(this.payment.cardHolderId)) {
      this.validationErrors['cardHolderId'] = 'ת״ז בעל/ת הכרטיס נדרשת (9 ספרות)';
    }
    if (!this.payment.cardLast4 || !/^\d{4}$/.test(this.payment.cardLast4)) {
      this.validationErrors['cardLast4'] = 'נא להזין 4 ספרות אחרונות של הכרטיס';
    }
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    if (!/^\d$/.test(event.key)) event.preventDefault();
  }

  private validateMedical() {
  if (this.medical.autismSpectrum && !this.medical.autismFunction) {
    this.validationErrors['autismFunction'] = 'נא לבחור תפקוד נמוך או תפקוד גבוה';
  }
}


  /* ---------- סיום האשף – שמירה בבסיס הנתונים ---------- */

  async completeWizard() {
    if (!this.validateCurrentStep()) return;

    this.saving = true;
    this.error = null;

    try {
      const dbc = dbTenant();
      const user = await getCurrentUserData();
      const parentUid = user?.uid ?? null;

      if (!parentUid) {
        this.error = 'שגיאה: לא נמצאו פרטי הורה מחובר';
        this.saving = false;
        return;
      }

      // בדיקה אם ת"ז הילד כבר קיימת
      const { data: exists, error: existsError } = await dbc
        .from('children')
        .select('gov_id')
        .eq('gov_id', this.child.gov_id)
        .maybeSingle();

      if (existsError) {
        this.error = existsError.message ?? 'שגיאה בבדיקת תעודת זהות';
        this.saving = false;
        return;
      }
      if (exists) {
        this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
        this.saving = false;
        this.stepIndex = 0;
        return;
      }

      // בניית הערות רפואיות כטקסט אחד (אפשר להחליף ל-JSON לעמודה מתאימה)
      const medicalSummaryLines: string[] = [];
      if (this.medical.growthDelay) medicalSummaryLines.push('עיכובי גדילה');
      if (this.medical.epilepsy) medicalSummaryLines.push('אפילפסיה');
      if (this.medical.autismSpectrum) medicalSummaryLines.push('על הרצף');
      if (this.medical.physicalDisability) medicalSummaryLines.push('מוגבלות פיזית');
      if (this.medical.cognitiveDisability) medicalSummaryLines.push('מוגבלות קוגניטיבית');
      if (this.medical.emotionalIssues) medicalSummaryLines.push('קשיים רגשיים');
      if (this.medical.other.trim()) medicalSummaryLines.push(`אחר: ${this.medical.other.trim()}`);
      if (this.child.medical_notes_free.trim()) {
        medicalSummaryLines.push(`הערות נוספות: ${this.child.medical_notes_free.trim()}`);
      }

      const medicalNotesCombined = medicalSummaryLines.join(' | ');

      // הכנסת הילד לטבלת children
      const childPayload: any = {
        gov_id: this.child.gov_id,
        first_name: this.child.first_name,
        last_name: this.child.last_name,
        birth_date: this.child.birth_date,
        gender: this.child.gender,
        health_fund: this.child.health_fund,
        status: 'Pending Addition Approval' as ChildStatus,
        parent_uid: parentUid,
        medical_notes: medicalNotesCombined || null,
      };

      const { data: insertedChild, error: insertChildError } = await dbc
        .from('children')
        .insert(childPayload)
        .select(
          'child_uuid, gov_id, first_name, last_name, birth_date, gender, health_fund, medical_notes, status, parent_uid'
        )
        .single();

      if (insertChildError || !insertedChild) {
        if ((insertChildError as any)?.code === '23505') {
          this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
          this.stepIndex = 0;
        } else {
          this.error = insertChildError?.message ?? 'שגיאה בהוספת הילד';
        }
        this.saving = false;
        return;
      }

      // יצירת בקשה למזכירה עם כל הפרטים (כולל שאלון ופרטי תשלום)
      const secretarialPayload = {
        request_type: 'ADD_CHILD',
        status: 'PENDING',
        requested_by_uid: parentUid,
        requested_by_role: 'parent',
        child_id: insertedChild.child_uuid,
        payload: {
          // פרטי ילד
          gov_id: insertedChild.gov_id,
          first_name: insertedChild.first_name,
          last_name: insertedChild.last_name,
          birth_date: insertedChild.birth_date,
          gender: insertedChild.gender,
          health_fund: insertedChild.health_fund,
          medical_notes: insertedChild.medical_notes,
          // שאלון רפואי מפורק
          medical_questionnaire: { ...this.medical },
          // תקנון
          terms: {
            accepted: this.termsAccepted,
            signed_name: this.termsSignature.trim(),
            accepted_at: new Date().toISOString(),
          },
          // תשלום הרשמה – הצד שלך בטרנזילה יטפל בחיוב בפועל אחרי אישור מזכירה
          registration_payment: {
            status: 'PENDING',
            charge_day: this.payment.chargeDay,
            registration_amount: this.payment.registrationAmount,
            method: 'credit_card',
            card_holder_id: this.payment.cardHolderId,
            card_last4: this.payment.cardLast4,
          },
        },
      };

      const { error: secretarialError } = await dbc
        .from('secretarial_requests')
        .insert(secretarialPayload);

      if (secretarialError) {
        console.error('שגיאה ביצירת בקשה למזכירה:', secretarialError);
        this.error =
          'הילד נוסף למערכת, אך הייתה שגיאה בשליחת הבקשה למזכירה. אנא צרי קשר עם המשרד.';
        this.saving = false;
        // עדיין נרים childAdded כדי שהילד יופיע להורה
        this.childAdded.emit();
        this.closed.emit();
        return;
      }

      // הצלחה מלאה
      this.childAdded.emit();
      this.closed.emit();
    } catch (e: any) {
      console.error(e);
      this.error = 'אירעה שגיאה לא צפויה בהוספת הילד';
    } finally {
      this.saving = false;
    }
  }
}

// add-child-wizard.component.ts
import { Component, EventEmitter, Output, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, ensureTenantContextReady, getCurrentUserData } from '../../services/supabaseClient.service';
import { FarmSettingsService } from '../../services/farm-settings.service';

type ChildStatus =
  | 'Active'
  | 'Pending Deletion Approval'
  | 'Pending Addition Approval'
  | 'Deleted';

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
  chargeDay: number | null;
  registrationAmount: number | null;
  cardHolderId: string;
  cardLast4: string;
}

type WizardMode = 'parent' | 'secretary';

interface ParentOption {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  id_number: string | null;
}

@Component({
  selector: 'app-add-child-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-child-wizard.component.html',
  styleUrls: ['./add-child-wizard.component.scss'],
})
export class AddChildWizardComponent implements OnInit {
  /** מצב: הורה / מזכירה */
  @Input() mode: WizardMode = 'parent';

  /** למקרה שתרצי לפתוח את האשף עם הורה שכבר נבחר מראש (מזכירה) */
  @Input() presetParentUid: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() childAdded = new EventEmitter<void>();

  // שלבים – ייקבעו לפי mode
  steps: string[] = [];

  stepIndex = 0;
  saving = false;
  error: string | null = null;

  // פרטי ילד
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

  // תקנון + תשלום – ישמשו רק במצב הורה
  termsAccepted = false;
  termsSignature = '';

  payment: PaymentInfo = {
    chargeDay: null,
    registrationAmount: null,
    cardHolderId: '',
    cardLast4: '',
  };

  validationErrors: { [key: string]: string } = {};

  // ===== הורים (למזכירה) =====
  parents: ParentOption[] = [];
  parentsLoading = false;
  parentsError: string | null = null;
  selectedParentUid: string | null = null;

  // *** טקסט שמופיע בשדה בחירת ההורה (לחיפוש לייב) ***
  parentInputText = '';

  private farmSettings = inject(FarmSettingsService);

  registrationFeeAgorot: number | null = null;
  registrationFeeLoaded = false;

  async ngOnInit() {
    // קודם נטען את דמי ההרשמה מה-DB
    await this.loadRegistrationFeeFromDb();

    // אם האשף פתוח במצב מזכירה – נטעין גם את רשימת ההורים
    if (this.isSecretaryMode) {
      await this.loadParentsForSecretary();
    }

    // בסוף נבנה את רשימת השלבים לפי המצב (הורה / מזכירות + דמי הרשמה)
    this.rebuildSteps();
  }

  get hasRegistrationFee(): boolean {
    return (this.registrationFeeAgorot ?? 0) > 0;
  }

  private async loadRegistrationFeeFromDb(): Promise<void> {
    try {
      const db = dbTenant();         // סכימת הטננט הנוכחי

      const { data, error } = await db
        .from('farm_settings')
        .select('registration_fee')
        .single();                   // יש רק שורה אחת לחווה

      if (error) {
        console.error('load farm_settings error', error);
        this.registrationFeeAgorot = 0;
      } else {
        this.registrationFeeAgorot = (data as any)?.registration_fee ?? 0;
      }
    } catch (e) {
      console.error('loadRegistrationFeeFromDb failed', e);
      this.registrationFeeAgorot = 0;
    } finally {
      this.registrationFeeLoaded = true;
    }
  }

  /** בניית השלבים לפי ה-mode והאם יש דמי הרשמה */
  private rebuildSteps() {
    const hasFee = this.hasRegistrationFee;

    if (this.mode === 'parent') {
      this.steps = [
        'פרטי ילד',
        'שאלון רפואי',
        'תקנון',
        ...(hasFee ? ['תשלום הרשמה'] : []),
      ];
    } else {
      // מזכירה – בלי תקנון, עם/בלי תשלום
      this.steps = [
        'פרטי ילד',
        'שאלון רפואי',
        ...(hasFee ? ['תשלום הרשמה'] : []),
      ];
    }
  }

  get isParentMode() {
    return this.mode === 'parent';
  }

  get isSecretaryMode() {
    return this.mode === 'secretary';
  }

  // טקסטים דינמיים לכותרת / כפתור
  get headerTitle(): string {
    return this.isParentMode ? 'הוספת ילד/ה לחווה' : 'הוספת ילד/ה (מזכירות)';
  }

  get headerSubtitle(): string {
    if (this.isParentMode) {
      return 'האשף מלווה אותך בארבעה שלבים קצרים: פרטי ילד, שאלון רפואי, אישור תקנון ותשלום הרשמה. החיוב יבוצע רק לאחר אישור המזכירה.';
    }
    return 'כאן ניתן להוסיף ילד/ה לחווה, לבחור הורה אחראי ולמלא שאלון רפואי קצר. השמירה מתבצעת ישירות במערכת.';
  }

  get finishButtonLabel(): string {
    return this.isParentMode ? 'סיום ושליחה לאישור' : 'סיום ושמירה';
  }

  // טעינת הורים – רק למזכירה
  private async loadParentsForSecretary() {
    this.parentsLoading = true;
    this.parentsError = null;

    try {
      // לוודא שהטננט / סכימה נטענו
      await ensureTenantContextReady();

      const dbc = dbTenant();
      const { data, error } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, id_number')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      this.parents = (data ?? []) as ParentOption[];

      // 🟩 חדש – אם קיבלנו presetParentUid / או שכבר יש selectedParentUid,
      // נמלא את השדה הטקסטואלי בטקסט היפה
      const uidToUse = this.selectedParentUid || this.presetParentUid;
      if (uidToUse) {
        const match = this.parents.find(p => p.uid === uidToUse);
        if (match) {
          this.selectedParentUid = match.uid;
          this.parentInputText = this.formatParentOption(match);
        }
      }
    } catch (e: any) {
      console.error(e);
      this.parents = [];
      this.parentsError = e?.message ?? 'שגיאה בטעינת רשימת ההורים';
    } finally {
      this.parentsLoading = false;
    }
  }



  // ===== פורמט להורה + סנכרון טקסט לשדה =====

  // פונקציה שמרכיבה טקסט יפה להורה (שם + ת"ז)
  formatParentOption(p: ParentOption): string {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const id = p.id_number || '';
    return id ? `${name} - ${id}` : name || '(ללא שם)';
  }

onParentInputChange(value: string) {
  this.parentInputText = value;
  const lower = (value || '').toLowerCase().trim();

  const match = this.parents.find(p =>
    this.formatParentOption(p).toLowerCase() === lower
  );

  this.selectedParentUid = match ? match.uid : null;
}


  /* ---------- ניווט ---------- */

  goToStep(index: number) {
    if (index < 0 || index >= this.steps.length) return;
    if (index > this.stepIndex && !this.validateCurrentStep()) return;
    this.stepIndex = index;
  }

  nextStep() {
    if (!this.validateCurrentStep()) return;
    if (this.stepIndex < this.steps.length - 1) this.stepIndex++;
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
        this.validateMedical();
        break;
      case 2:
        if (this.isParentMode) this.validateTerms();
        break;
      case 3:
        if (this.isParentMode) this.validatePayment();
        break;
    }

    return Object.keys(this.validationErrors).length === 0 && !this.error;
  }

  private validateChildDetails() {
    if (this.isSecretaryMode && !this.selectedParentUid) {
      this.validationErrors['parent_uid'] = 'יש לבחור הורה אחראי';
    }

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
    if (
      !this.payment.chargeDay ||
      this.payment.chargeDay < 1 ||
      this.payment.chargeDay > 28
    ) {
      this.validationErrors['chargeDay'] = 'נא לבחור יום חיוב בין 1 ל-28';
    }
    if (
      !this.payment.cardHolderId ||
      !/^\d{9}$/.test(this.payment.cardHolderId)
    ) {
      this.validationErrors['cardHolderId'] =
        'ת״ז בעל/ת הכרטיס נדרשת (9 ספרות)';
    }
    if (!this.payment.cardLast4 || !/^\d{4}$/.test(this.payment.cardLast4)) {
      this.validationErrors['cardLast4'] =
        'נא להזין 4 ספרות אחרונות של הכרטיס';
    }
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    if (!/^\d$/.test(event.key)) event.preventDefault();
  }

  private validateMedical() {
    if (this.medical.autismSpectrum && !this.medical.autismFunction) {
      this.validationErrors['autismFunction'] =
        'נא לבחור תפקוד נמוך או תפקוד גבוה';
    }
  }

  /* ---------- שמירה ---------- */

  async completeWizard() {
    if (!this.validateCurrentStep()) return;

    this.saving = true;
    this.error = null;

    try {
      const dbc = dbTenant();

      let parentUid: string | null = null;

      if (this.isParentMode) {
        const user = await getCurrentUserData();
        parentUid = user?.uid ?? null;
      } else {
        parentUid = this.selectedParentUid ?? null;
      }

      if (!parentUid) {
        this.error = 'שגיאה: לא נמצא הורה אחראי';
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

      // בניית הערות רפואיות
      const medicalSummaryLines: string[] = [];
      if (this.medical.growthDelay) medicalSummaryLines.push('עיכובי גדילה');
      if (this.medical.epilepsy) medicalSummaryLines.push('אפילפסיה');
      if (this.medical.autismSpectrum) medicalSummaryLines.push('על הרצף');
      if (this.medical.physicalDisability)
        medicalSummaryLines.push('מוגבלות פיזית');
      if (this.medical.cognitiveDisability)
        medicalSummaryLines.push('מוגבלות קוגניטיבית');
      if (this.medical.emotionalIssues)
        medicalSummaryLines.push('קשיים רגשיים');
      if (this.medical.other.trim())
        medicalSummaryLines.push(`אחר: ${this.medical.other.trim()}`);
      if (this.child.medical_notes_free.trim()) {
        medicalSummaryLines.push(
          `הערות נוספות: ${this.child.medical_notes_free.trim()}`
        );
      }

      const medicalNotesCombined = medicalSummaryLines.join(' | ');

      const status: ChildStatus = this.isParentMode
        ? 'Pending Addition Approval'
        : 'Active';

      const childPayload: any = {
        gov_id: this.child.gov_id,
        first_name: this.child.first_name,
        last_name: this.child.last_name,
        birth_date: this.child.birth_date,
        gender: this.child.gender,
        health_fund: this.child.health_fund,
        status,
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

      // במצב הורה – יוצרים גם בקשה למזכירה
      if (this.isParentMode) {
        const secretarialPayload = {
          request_type: 'ADD_CHILD',
          status: 'PENDING',
          requested_by_uid: parentUid,
          requested_by_role: 'parent',
          child_id: insertedChild.child_uuid,
          payload: {
            gov_id: insertedChild.gov_id,
            first_name: insertedChild.first_name,
            last_name: insertedChild.last_name,
            birth_date: insertedChild.birth_date,
            gender: insertedChild.gender,
            health_fund: insertedChild.health_fund,
            medical_notes: insertedChild.medical_notes,
            medical_questionnaire: { ...this.medical },
            terms: {
              accepted: this.termsAccepted,
              signed_name: this.termsSignature.trim(),
              accepted_at: new Date().toISOString(),
            },
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
          this.childAdded.emit();
          this.closed.emit();
          return;
        }
      }

      // הצלחה
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

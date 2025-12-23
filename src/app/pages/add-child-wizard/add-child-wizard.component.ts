// add-child-wizard.component.ts
import { Component, EventEmitter, Output, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import {
  dbTenant,
  ensureTenantContextReady,
  getCurrentFarmMetaSync,
  getCurrentUserData,
} from '../../services/supabaseClient.service';
import { TranzilaService } from '../../services/tranzila.service';

type ChildStatus =
  | 'Active'
  | 'Pending Deletion Approval'
  | 'Pending Addition Approval'
  | 'Deleted';

type WizardMode = 'parent' | 'secretary';

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
  registrationAmount: number | null;
}

interface ParentOption {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  id_number: string | null;
}

type PaymentProfileSummary = {
  id: string;
  last4: string | null;
  brand: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
};

declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
  onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
};

@Component({
  selector: 'app-add-child-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './add-child-wizard.component.html',
  styleUrls: ['./add-child-wizard.component.scss'],
})
export class AddChildWizardComponent implements OnInit {
  @Input() mode: WizardMode = 'parent';
  @Input() presetParentUid: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() childAdded = new EventEmitter<void>();

  private tranzila = inject(TranzilaService);

  // ===== תשלום (Hosted Fields + שמירת טוקן) =====
  private hfReg: HostedFieldsInstance | null = null;
  private thtkReg: string | null = null;

  savingToken = false;
  tokenSaved = false;
  tokenError: string | null = null;

  private savedToken: {
    token: string;
    last4: string | null;
    brand: string | null;
    expiryMonth?: string | null;
    expiryYear?: string | null;
  } | null = null;

  // כרטיס שמור מהטבלה
  loadingPaymentProfile = false;
  savedPaymentProfile: PaymentProfileSummary | null = null;

  get hasSavedPaymentProfile(): boolean {
    return !!this.savedPaymentProfile?.id;
  }

  // ===== UI כללי =====
  steps: string[] = [];
  stepIndex = 0;
  saving = false;
  error: string | null = null;

  validationErrors: Record<string, string> = {};

  // ===== דמי הרשמה (מ-farm_settings.registration_fee באגורות) =====
  registrationFeeAgorot: number | null = null;

  get hasRegistrationFee(): boolean {
    return (this.registrationFeeAgorot ?? 0) > 0;
  }

  // שלב תשלום קיים רק להורה ורק אם registration_fee > 0
  get paymentStepIndex(): number {
    if (!this.isParentMode || !this.hasRegistrationFee) return -1;
    // parent: פרטי ילד(0), רפואי(1), תקנון(2), תשלום(3)
    return 3;
  }

  // ===== מצב/טקסטים =====
  get isParentMode() {
    return this.mode === 'parent';
  }
  get isSecretaryMode() {
    return this.mode === 'secretary';
  }

  get headerTitle(): string {
    return this.isParentMode ? 'הוספת ילד/ה לחווה' : 'הוספת ילד/ה (מזכירות)';
  }

  get headerSubtitle(): string {
    if (this.isParentMode) {
      return 'האשף מלווה אותך בשלבים קצרים. החיוב יתבצע רק לאחר אישור המזכירה.';
    }
    return 'כאן ניתן להוסיף ילד/ה לחווה, לבחור הורה אחראי ולמלא שאלון קצר. השמירה מתבצעת ישירות במערכת.';
  }

  get finishButtonLabel(): string {
    return this.isParentMode ? 'סיום ושליחה לאישור' : 'סיום ושמירה';
  }

  // ===== מודל ילד =====
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

  // תקנון (רק הורה)
  termsAccepted = false;
  termsSignature = '';

  // תשלום
  payment: PaymentInfo = { registrationAmount: null };

  // ===== הורים (למזכירה) =====
  parents: ParentOption[] = [];
  parentsLoading = false;
  parentsError: string | null = null;
  selectedParentUid: string | null = null;
  parentInputText = '';

  async ngOnInit() {
    await this.loadRegistrationFeeFromDb();

    if (this.isSecretaryMode) {
      await this.loadParentsForSecretary();
    }

    // אם הורה ויש שלב תשלום — נביא כרטיס שמור כדי לדלג על Hosted Fields
    if (this.isParentMode && this.hasRegistrationFee) {
      const user = await getCurrentUserData();
      const parentUid = user?.uid ?? null;
      if (parentUid) {
        await this.loadSavedPaymentProfileForParent(parentUid);
      }
    }

    this.rebuildSteps();
  }

  private rebuildSteps() {
    const hasFee = this.hasRegistrationFee;

    if (this.isParentMode) {
      this.steps = ['פרטי ילד', 'שאלון רפואי', 'תקנון', ...(hasFee ? ['אמצעי תשלום'] : [])];
    } else {
      this.steps = ['פרטי ילד', 'שאלון רפואי', ...(hasFee ? ['אמצעי תשלום'] : [])];
    }
  }

  private async loadRegistrationFeeFromDb(): Promise<void> {
    try {
      const db = dbTenant();
      const { data, error } = await db.from('farm_settings').select('registration_fee').single();
      if (error) throw error;

      this.registrationFeeAgorot = (data as any)?.registration_fee ?? 0;

      // ברירת מחדל להצגה: אם יש דמי הרשמה – למלא בשקלים
      if (this.hasRegistrationFee) {
        this.payment.registrationAmount = Math.round((this.registrationFeeAgorot ?? 0) / 100);
      }
    } catch (e) {
      console.error('loadRegistrationFeeFromDb failed', e);
      this.registrationFeeAgorot = 0;
    }
  }

  // ===== הורים (מזכירה) =====
  private async loadParentsForSecretary() {
    this.parentsLoading = true;
    this.parentsError = null;

    try {
      await ensureTenantContextReady();
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, id_number')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      this.parents = (data ?? []) as ParentOption[];

      const uidToUse = this.selectedParentUid || this.presetParentUid;
      if (uidToUse) {
        const match = this.parents.find((p) => p.uid === uidToUse);
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

  formatParentOption(p: ParentOption): string {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const id = p.id_number || '';
    return id ? `${name} - ${id}` : name || '(ללא שם)';
  }

  onParentInputChange(value: string) {
    this.parentInputText = value;
    const lower = (value || '').toLowerCase().trim();
    const match = this.parents.find((p) => this.formatParentOption(p).toLowerCase() === lower);
    this.selectedParentUid = match ? match.uid : null;
  }

  // ===== ניווט =====
  nextStep() {
    if (!this.validateCurrentStep()) return;

    if (this.stepIndex < this.steps.length - 1) {
      this.stepIndex++;
    }

    // אם נכנסנו לשלב התשלום ורק אם אין כרטיס שמור — לאתחל Hosted Fields
    if (
      this.isParentMode &&
      this.stepIndex === this.paymentStepIndex &&
      this.hasRegistrationFee &&
      !this.hasSavedPaymentProfile
    ) {
      queueMicrotask(() => this.ensureRegHostedFieldsReady());
    }
  }

  prevStep() {
    if (this.stepIndex > 0) this.stepIndex--;
  }

  close() {
    if (this.saving) return;
    this.closed.emit();
  }

  allowOnlyNumbers(event: KeyboardEvent) {
    if (!/^\d$/.test(event.key)) event.preventDefault();
  }

  // ===== ולידציה =====
  private validateCurrentStep(): boolean {
    this.validationErrors = {};
    this.error = null;

    if (this.stepIndex === 0) this.validateChildDetails();
    if (this.stepIndex === 1) this.validateMedical();
    if (this.stepIndex === 2 && this.isParentMode) this.validateTerms();
    if (this.stepIndex === this.paymentStepIndex && this.isParentMode) this.validatePayment();

    return Object.keys(this.validationErrors).length === 0 && !this.error;
  }

  private validateChildDetails() {
    if (this.isSecretaryMode && !this.selectedParentUid) {
      this.validationErrors['parent_uid'] = 'יש לבחור הורה אחראי';
    }
    if (!/^\d{9}$/.test(this.child.gov_id || '')) {
      this.validationErrors['gov_id'] = 'ת״ז חייבת להכיל בדיוק 9 ספרות';
    }
    if (!this.child.first_name) this.validationErrors['first_name'] = 'נא להזין שם פרטי';
    if (!this.child.last_name) this.validationErrors['last_name'] = 'נא להזין שם משפחה';
    if (!this.child.birth_date) this.validationErrors['birth_date'] = 'יש לבחור תאריך לידה';
    if (!this.child.gender) this.validationErrors['gender'] = 'יש לבחור ערך';
    if (!this.child.health_fund) this.validationErrors['health_fund'] = 'יש לבחור קופת חולים';
  }

  private validateMedical() {
    if (this.medical.autismSpectrum && !this.medical.autismFunction) {
      this.validationErrors['autismFunction'] = 'נא לבחור תפקוד נמוך או תפקוד גבוה';
    }
  }

  private validateTerms() {
    if (!this.termsAccepted) this.validationErrors['terms'] = 'יש לאשר את התקנון לפני המשך';
    if (!this.termsSignature.trim()) this.validationErrors['signature'] = 'נא להזין שם לחתימה דיגיטלית';
  }

  private validatePayment() {
    if (!this.hasRegistrationFee) return;

    const v = Number(this.payment.registrationAmount ?? 0);
    if (!Number.isFinite(v) || v <= 0) {
      this.validationErrors['registrationAmount'] = 'נא להזין סכום דמי הרשמה';
    }

    // אם יש כרטיס שמור — לא דורשים טוקניזציה
    if (!this.hasSavedPaymentProfile && !this.tokenSaved) {
      this.validationErrors['token'] = 'יש לשמור אמצעי תשלום לפני המשך';
      this.error = 'יש ללחוץ על "שמירת אמצעי תשלום" לפני המשך';
    }
  }

  // ===== שמירה =====
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
        return;
      }
      if (exists) {
        this.validationErrors['gov_id'] = 'ת״ז זו כבר קיימת במערכת';
        this.stepIndex = 0;
        return;
      }

      const medicalNotesCombined = this.buildMedicalNotes();

      const status: ChildStatus = this.isParentMode ? 'Pending Addition Approval' : 'Active';

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
        return;
      }

      // במצב הורה – יוצרים גם בקשה למזכירה
      if (this.isParentMode) {
        const cardLast4 = this.savedPaymentProfile?.last4 ?? this.savedToken?.last4 ?? null;

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
            registration_payment: this.hasRegistrationFee
              ? {
                  status: 'PENDING',
                  registration_amount: this.payment.registrationAmount,
                  method: 'credit_card',
                  card_last4: cardLast4,
                  note: cardLast4
                    ? `חיוב לאחר אישור מזכירה מכרטיס שמסתיים ב-${cardLast4}`
                    : 'חיוב לאחר אישור מזכירה',
                }
              : null,
          },
        };

        const { error: secretarialError } = await dbc.from('secretarial_requests').insert(secretarialPayload);

        if (secretarialError) {
          console.error('שגיאה ביצירת בקשה למזכירה:', secretarialError);
          this.error = 'הילד נוסף למערכת, אך הייתה שגיאה בשליחת הבקשה למזכירה. אנא צרי קשר עם המשרד.';
          this.childAdded.emit();
          this.closed.emit();
          return;
        }
      }

      this.childAdded.emit();
      this.closed.emit();
    } catch (e) {
      console.error(e);
      this.error = 'אירעה שגיאה לא צפויה בהוספת הילד';
    } finally {
      this.saving = false;
    }
  }

  private buildMedicalNotes(): string {
    const lines: string[] = [];
    if (this.medical.growthDelay) lines.push('עיכובי גדילה');
    if (this.medical.epilepsy) lines.push('אפילפסיה');
    if (this.medical.autismSpectrum) lines.push('על הרצף');
    if (this.medical.physicalDisability) lines.push('מוגבלות פיזית');
    if (this.medical.cognitiveDisability) lines.push('מוגבלות קוגניטיבית');
    if (this.medical.emotionalIssues) lines.push('קשיים רגשיים');
    if ((this.medical.other || '').trim()) lines.push(`אחר: ${(this.medical.other || '').trim()}`);
    if ((this.child.medical_notes_free || '').trim()) lines.push(`הערות נוספות: ${(this.child.medical_notes_free || '').trim()}`);
    return lines.join(' | ');
  }

  // ===== תשלום =====
  private async loadSavedPaymentProfileForParent(parentUid: string): Promise<void> {
    this.loadingPaymentProfile = true;
    try {
      const dbc = dbTenant();
      const { data, error } = await dbc
        .from('payment_profiles')
        .select('id, last4, brand, expiry_month, expiry_year')
        .eq('parent_uid', parentUid)
        .eq('active', true)
        .eq('is_default', true)
        .maybeSingle();

      if (error) throw error;

      this.savedPaymentProfile = (data as any) ?? null;

      if (this.hasSavedPaymentProfile) {
        this.tokenSaved = true; // מאפשר מעבר שלב בלי “שמירת אמצעי תשלום”
        this.tokenError = null;
      }
    } catch (e) {
      console.error('loadSavedPaymentProfileForParent failed', e);
      this.savedPaymentProfile = null;
    } finally {
      this.loadingPaymentProfile = false;
    }
  }

  private async ensureRegHostedFieldsReady() {
    if (this.hfReg) return;
    this.tokenError = null;

    try {
      const { thtk } = await this.tranzila.getHandshakeToken();
      this.thtkReg = thtk;

      if (!TzlaHostedFields) {
        this.tokenError = 'רכיב התשלום לא נטען';
        return;
      }

      this.hfReg = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: {
            selector: '#reg_credit_card_number',
            placeholder: '4580 4580 4580 4580',
            tabindex: 1,
          },
          cvv: {
            selector: '#reg_cvv',
            placeholder: '123',
            tabindex: 2,
          },
          expiry: {
            selector: '#reg_expiry',
            placeholder: '12/26',
            version: '1',
          },
        },
      });

      this.hfReg?.onEvent?.('validityChange', () => {});
    } catch (e: any) {
      console.error('[reg] handshake/init error', e);
      this.tokenError = e?.message ?? 'שגיאה באתחול שדות האשראי';
    }
  }

  async tokenizeCard() {
    this.tokenError = null;

    if (!this.isParentMode) return;
    if (!this.hfReg || !this.thtkReg) {
      this.tokenError = 'שדות התשלום לא מוכנים';
      return;
    }

    const user = await getCurrentUserData();
    const parentUid = user?.uid ?? null;
    if (!parentUid) {
      this.tokenError = 'לא זוהה הורה מחובר';
      return;
    }

    await ensureTenantContextReady();
    const farm = getCurrentFarmMetaSync();
    const tenantSchema = farm?.schema_name ?? undefined;
    if (!tenantSchema) {
      this.tokenError = 'לא זוהתה סכמת חווה';
      return;
    }

    // ניקוי שגיאות שדות
    ['credit_card_number', 'expiry', 'cvv'].forEach((k) => {
      const el = document.getElementById('reg_errors_for_' + k);
      if (el) el.textContent = '';
    });

    this.savingToken = true;
    this.tokenSaved = false;

    const terminalName = 'moachapp';
    const amount = '1.00'; // verify

    this.hfReg.charge(
      {
        terminal_name: terminalName,
        thtk: this.thtkReg,
        currency_code: 'ILS',
        amount,
        txn_type: 'verify',
        verify_mode: 2,
        response_language: 'hebrew',
        requested_by_user: 'registration-tokenize',
        email: user?.email ?? undefined,
        contact: `${this.child.first_name} ${this.child.last_name}`.trim() || undefined,
      },
      async (err: any, response: any) => {
        try {
          if (err?.messages?.length) {
            err.messages.forEach((msg: any) => {
              const el = document.getElementById('reg_errors_for_' + msg.param);
              if (el) el.textContent = msg.message;
            });
            this.tokenError = 'שגיאה בפרטי הכרטיס';
            return;
          }

          const tx = response?.transaction_response;
          if (!tx?.success) {
            this.tokenError = tx?.error || 'שמירת אמצעי תשלום נכשלה';
            return;
          }

          const token = tx?.token;
          if (!token) {
            this.tokenError = 'לא התקבל טוקן מהסליקה';
            return;
          }

          const last4 =
            tx?.credit_card_last_4_digits ??
            tx?.last_4 ??
            (tx?.card_mask ? String(tx.card_mask).slice(-4) : null);

          const brand = tx?.card_type_name ?? tx?.card_type ?? null;

          this.savedToken = {
            token: String(token),
            last4: last4 ? String(last4) : null,
            brand: brand ? String(brand) : null,
            expiryMonth: tx?.expiry_month ?? null,
            expiryYear: tx?.expiry_year ?? null,
          };

          await this.tranzila.savePaymentMethod({
            parentUid,
            tenantSchema,
            token: this.savedToken.token,
            last4: this.savedToken.last4,
            brand: this.savedToken.brand,
            expiryMonth: this.savedToken.expiryMonth,
            expiryYear: this.savedToken.expiryYear,
          });

          this.tokenSaved = true;
          // אחרי שמירה – נביא את הפרופיל שוב, כדי להציג הודעה/last4 מהטבלה
          await this.loadSavedPaymentProfileForParent(parentUid);
        } catch (e: any) {
          console.error('[tokenizeCard] save error', e);
          this.tokenError = e?.message ?? 'שגיאה בשמירת אמצעי תשלום במערכת';
        } finally {
          this.savingToken = false;
        }
      }
    );
  }
}

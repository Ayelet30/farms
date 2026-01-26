// add-child-wizard.component.ts
import { Component, EventEmitter, Output, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import {
  dbTenant,
  ensureTenantContextReady,
  getCurrentFarmMetaSync,
  getCurrentUserData,
  getSupabaseClient, // ✅ חשוב (אם אין אצלך – תגידי ואיתן לך גרסה לפי השירות שלך)
} from '../../services/supabaseClient.service';

import { TranzilaService } from '../../services/tranzila.service';

import { PDFDocument, rgb } from 'pdf-lib';
import * as fontkitModule from '@pdf-lib/fontkit';

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

type FarmDoc = {
  id: string;
  title: string;
  version: number;
  storage_bucket: string;
  storage_path: string;
  published_at: string;
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
  private sanitizer = inject(DomSanitizer);

  // =========================
  // ===== תקנון (Parent) =====
  // =========================
  termsLoading = false;
  termsSaving = false;
  termsError: string | null = null;

  activeTermsDoc: FarmDoc | null = null;
  termsUrlRaw: string | null = null;
  termsUrlSafe: SafeResourceUrl | null = null;

  termsAccepted = false;
  termsSignature = '';

  // =========================
  // ===== תשלום =====
  // =========================
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

  // ===== דמי הרשמה =====
  registrationFeeAgorot: number | null = null;

  get hasRegistrationFee(): boolean {
    return (this.registrationFeeAgorot ?? 0) > 0;
  }

  get paymentStepIndex(): number {
    if (!this.isParentMode || !this.hasRegistrationFee) return -1;
    return 3; // parent: child(0), medical(1), terms(2), payment(3)
  }

  // ===== מצב =====
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

    // ✅ במצב הורה – נטען תקנון פעיל מהאחסון כבר בכניסה
    if (this.isParentMode) {
      await this.loadActiveTermsDocFromDbAndStorage();
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

      if (this.hasRegistrationFee) {
        this.payment.registrationAmount = Math.round((this.registrationFeeAgorot ?? 0) / 100);
      }
    } catch (e) {
      console.error('loadRegistrationFeeFromDb failed', e);
      this.registrationFeeAgorot = 0;
    }
  }

  // =========================================
  // ===== תקנון: טעינה מ-farm_documents =====
  // =========================================
  private async loadActiveTermsDocFromDbAndStorage(): Promise<void> {
    this.termsLoading = true;
    this.termsError = null;
    this.activeTermsDoc = null;
    this.termsUrlRaw = null;
    this.termsUrlSafe = null;

    try {
      await ensureTenantContextReady();
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('farm_documents')
        .select('id, title, version, storage_bucket, storage_path, published_at')
        .eq('doc_type', 'TERMS')
        .eq('is_active', true)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        this.termsError = 'לא נמצא תקנון פעיל בחווה';
        return;
      }

      this.activeTermsDoc = data as any;

      const bucket = (data as any).storage_bucket as string;
      const path = (data as any).storage_path as string;

      const client = getSupabaseClient();
      const { data: pub } = client.storage.from(bucket).getPublicUrl(path);
      const url = pub?.publicUrl ?? null;

      this.termsUrlRaw = url;
      this.termsUrlSafe = url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;

      if (!url) this.termsError = 'לא הצלחתי לייצר קישור לתקנון';
    } catch (e: any) {
      console.error(e);
      this.termsError = e?.message ?? 'שגיאה בטעינת התקנון';
    } finally {
      this.termsLoading = false;
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
    if (this.termsLoading) {
      this.validationErrors['terms_loading'] = 'התקנון עדיין נטען…';
      this.error = 'התקנון עדיין נטען…';
      return;
    }
    if (!this.activeTermsDoc || !this.termsUrlRaw) {
      this.validationErrors['terms_missing'] = 'לא נמצא תקנון פעיל';
      this.error = 'לא נמצא תקנון פעיל';
      return;
    }

    if (!this.termsAccepted) this.validationErrors['terms'] = 'יש לאשר את התקנון לפני המשך';
    if (!this.termsSignature.trim()) this.validationErrors['signature'] = 'נא להזין שם לחתימה דיגיטלית';
  }

  private validatePayment() {
    if (!this.hasRegistrationFee) return;

    const v = Number(this.payment.registrationAmount ?? 0);
    if (!Number.isFinite(v) || v <= 0) {
      this.validationErrors['registrationAmount'] = 'נא להזין סכום דמי הרשמה';
    }

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

      // יוצרים דרישת תקנון (כמו אצלך)
      await dbc.rpc('create_child_terms_requirement', { p_child_id: insertedChild.child_uuid });

      // ✅ במצב הורה: אחרי יצירת הילד — חותמים ושומרים PDF חתום
      if (this.isParentMode) {
        await this.signAndAttachTermsPdfAfterChildInsert({
          childId: insertedChild.child_uuid,
          childName: `${insertedChild.first_name} ${insertedChild.last_name}`.trim(),
        });
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
              document_id: this.activeTermsDoc?.id ?? null,
              document_version: this.activeTermsDoc?.version ?? null,
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
    if ((this.child.medical_notes_free || '').trim())
      lines.push(`הערות נוספות: ${(this.child.medical_notes_free || '').trim()}`);
    return lines.join(' | ');
  }

  // ============================================================
  // ===== חתימה + בניית PDF חתום + העלאה + attach ל-DB =====
  // ============================================================
  private async signAndAttachTermsPdfAfterChildInsert(args: {
    childId: string;
    childName: string;
  }): Promise<void> {
    // ולידציות קשיחות (כדי שלא יווצר ילד בלי מסמך חתום)
    if (!this.activeTermsDoc) throw new Error('חסר מסמך תקנון פעיל');
    if (!this.termsUrlRaw) throw new Error('חסר קישור לתקנון');
    if (!this.termsAccepted) throw new Error('יש לאשר את התקנון');
    if (!this.termsSignature.trim()) throw new Error('חסר שם לחתימה');

    this.termsSaving = true;
    this.termsError = null;

    try {
      const dbc = dbTenant();
      const userAgent = navigator.userAgent || null;

      const { error } = await dbc.rpc('sign_child_terms', {
        p_child_id: args.childId,
        p_signed_name: this.termsSignature.trim(),
        p_signature_svg: null,
        p_signature_text: this.termsSignature.trim(),
        p_user_agent: userAgent,
        p_ip: null,
      });

      if (error) throw error;

      const signedBytes = await this.buildSignedPdf(
        this.termsUrlRaw,
        this.termsSignature.trim(),
        args.childName
      );

      const signedBucket = 'signed-docs';

      // path לפי storage_path של התקנון הפעיל
      const doc = this.activeTermsDoc;
      const baseDir = doc.storage_path.replace(/\/[^\/]+$/, ''); // remove filename
      const path = `${baseDir}/signed/${args.childId}/terms_v${doc.version}.pdf`;

      await this.uploadSignedPdf(signedBytes, signedBucket, path);

      const { error: attachErr } = await dbc.rpc('attach_signed_terms_pdf', {
        p_child_id: args.childId,
        p_document_id: doc.id,
        p_bucket: signedBucket,
        p_path: path,
      });
      if (attachErr) throw attachErr;
    } catch (e: any) {
      console.error('[signAndAttachTermsPdfAfterChildInsert] error', e);
      this.termsError = e?.message ?? 'שגיאה בחתימה/שמירת התקנון';
      throw e; // חשוב כדי לעצור את ה-flow אם את רוצה שהכל יהיה עקבי
    } finally {
      this.termsSaving = false;
    }
  }

  private async buildSignedPdf(originalPdfUrl: string, signedName: string, childName: string): Promise<Uint8Array> {
    const pdfBytes = await fetch(originalPdfUrl).then((r) => r.arrayBuffer());
    const pdfDoc = await PDFDocument.load(pdfBytes);

    pdfDoc.registerFontkit((fontkitModule as any).default ?? (fontkitModule as any));

    const fontBytes = await fetch('/assets/fonts/Assistant.ttf').then((r) => r.arrayBuffer());
    const hebFont = await pdfDoc.embedFont(fontBytes, { subset: true });

    const pages = pdfDoc.getPages();

    const RLM = '\u200F';
    const LRM = '\u200E';

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');

    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateTime = `${LRM}${dateStr} ${timeStr}${LRM}`;

    const line1 = `${RLM}נחתם דיגיטלית בתאריך: ${dateTime}`;
    const line2 = `${RLM}שם החותם: ${signedName} • ילד: ${childName}`;

    const fontSize = 9;
    const marginX = 24;
    const lineGap = 12;
    const bottomPadding = 18;

    for (const page of pages) {
      const { width } = page.getSize();

      const y2 = bottomPadding;
      const y1 = y2 + lineGap;

      page.drawText(line1, {
        x: marginX,
        y: y1,
        size: fontSize,
        font: hebFont,
        color: rgb(0.35, 0.35, 0.35),
        maxWidth: width - marginX * 2,
      });

      page.drawText(line2, {
        x: marginX,
        y: y2,
        size: fontSize,
        font: hebFont,
        color: rgb(0.35, 0.35, 0.35),
        maxWidth: width - marginX * 2,
      });
    }

    return await pdfDoc.save();
  }

  private async uploadSignedPdf(bytes: Uint8Array, bucket: string, path: string): Promise<void> {
    const client = getSupabaseClient();

    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const file = new Blob([ab], { type: 'application/pdf' });

    const { error } = await client.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '3600',
    });

    if (error) throw error;
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
        this.tokenSaved = true;
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
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;
      if (!tenantSchema) {
        this.tokenError = 'לא זוהה סכמת חווה';
        return;
      }

      const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema);
      this.thtkReg = thtk;

      if (!TzlaHostedFields) {
        this.tokenError = 'רכיב התשלום לא נטען';
        return;
      }

      this.hfReg = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: { selector: '#reg_credit_card_number', placeholder: '4580 4580 4580 4580', tabindex: 1 },
          cvv: { selector: '#reg_cvv', placeholder: '123', tabindex: 2 },
          expiry: { selector: '#reg_expiry', placeholder: '12/26', version: '1' },
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

    ['credit_card_number', 'expiry', 'cvv'].forEach((k) => {
      const el = document.getElementById('reg_errors_for_' + k);
      if (el) el.textContent = '';
    });

    this.savingToken = true;
    this.tokenSaved = false;

    const terminalName = 'moachapp';
    const amount = '1.00';

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

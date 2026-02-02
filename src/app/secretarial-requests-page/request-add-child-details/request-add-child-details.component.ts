import { Component, Input, OnChanges, OnInit, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getSupabaseClient } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

type AddChildDetails = {
  request_id: string;
  created_at: string;
  requested_by_uid: string;
  requester_role: string;

  parent_uid: string;
  parent_name: string | null;

  child_id: string;
  child_name: string | null;
  gov_id: string | null;
  birth_date: string | null;
  age_years: number | null;
  gender: string | null;
  health_fund: string | null;

  medical_notes: string | null;

  growth_delay: boolean;
  epilepsy: boolean;
  autism_spectrum: boolean;
  autism_function: string | null;
  physical_disability: boolean;
  cognitive_disability: boolean;
  emotional_issues: boolean;
  medical_other: string | null;

  terms_signed_name: string | null;
  terms_accepted_at: string | null;

  registration_amount: number | null;
  card_last4: string | null;

  // ✅ חדש - מגיע מה-RPC
  signed_pdf_bucket: string | null;
  signed_pdf_path: string | null;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-add-child-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './request-add-child-details.component.html',
  styleUrls: ['./request-add-child-details.component.scss'],
})
export class RequestAddChildDetailsComponent implements OnInit, OnChanges {
  @Input({ required: true }) request!: any; // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  private db = dbTenant();
  private snack = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);

  loading = signal(false);
  details = signal<AddChildDetails | null>(null);
  decisionNote = '';

  // ===== Signed Terms popup =====
  signedOpen = signal(false);
  loadingSigned = signal(false);
  signedDocUrlRaw = signal<string | null>(null);
  signedDocUrlSafe = signal<SafeResourceUrl | null>(null);

  async ngOnInit() {
    await this.loadDetails();
  }

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['request'] && !changes['request'].firstChange) {
      const prev = changes['request'].previousValue?.id;
      const curr = changes['request'].currentValue?.id;

      if (prev !== curr) {
        await this.loadDetails();
      }
    }
  }

  async loadDetails() {
    this.loading.set(true);
    try {
      const { data, error } = await this.db.rpc('get_add_child_request_details', {
        p_request_id: this.request.id,
      });
      if (error) throw error;

      const row = (data?.[0] ?? null) as AddChildDetails | null;
      this.details.set(row);
      console.log('details:', this.details);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת פרטי הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  get medicalTags(): string[] {
    const d = this.details();
    if (!d) return [];
    const tags: string[] = [];
    if (d.growth_delay) tags.push('עיכובי גדילה');
    if (d.epilepsy) tags.push('אפילפסיה');
    if (d.autism_spectrum) tags.push(`על הרצף${d.autism_function ? ` (${d.autism_function})` : ''}`);
    if (d.physical_disability) tags.push('מוגבלות פיזית');
    if (d.cognitive_disability) tags.push('מוגבלות קוגניטיבית');
    if (d.emotional_issues) tags.push('קשיים רגשיים');
    if ((d.medical_other || '').trim()) tags.push(`אחר: ${d.medical_other}`);
    return tags;
  }

  // ===== תקנון חתום: פתיחה/סגירה =====
  async openSignedTerms() {
    const d = this.details();
    if (!d?.child_id) return;

    this.loadingSigned.set(true);
    this.signedDocUrlRaw.set(null);
    this.signedDocUrlSafe.set(null);

    try {
      const bucket = d.signed_pdf_bucket ?? null;
      const path = d.signed_pdf_path ?? null;

      if (!bucket || !path) {
        this.signedOpen.set(true);
        return;
      }

      const client = getSupabaseClient();
      const { data: pub } = client.storage.from(bucket).getPublicUrl(path);
      let url = pub?.publicUrl ?? null;

      // cache-bust כדי שלא ייתקע על גרסה ישנה
      if (url) url = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

      this.signedDocUrlRaw.set(url);
      this.signedDocUrlSafe.set(url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null);
      this.signedOpen.set(true);
    } catch (e: any) {
      console.error(e);
      this.toast(e?.message ?? 'שגיאה בפתיחת תקנון חתום', 'error');
    } finally {
      this.loadingSigned.set(false);
    }
  }

  closeSignedPopup() {
    this.signedOpen.set(false);
  }

  async approve() {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('approve_add_child_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      const d = this.details();
      const child = d?.child_name || 'הילד/ה';
      const parent = d?.parent_name ? `להורה ${d.parent_name}` : 'להורה';
      const msg = `אישרת הוספת ${child}. הודעה נשלחה ${parent}.`;

      this.toast(msg, 'success');

      this.onApproved?.({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        message: msg,
        meta: d,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה באישור הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  async reject() {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('reject_secretarial_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      const d = this.details();
      const child = d?.child_name || 'הילד/ה';
      const msg = `דחית בקשת הוספת ${child}. הודעה נשלחה ברגעים אלה.`;

      this.toast(msg, 'info');

      this.onRejected?.({
        requestId: this.request.id,
        newStatus: 'REJECTED',
        message: msg,
        meta: d,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בדחיית הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  private toast(message: string, type: ToastKind = 'info') {
    this.snack.open(message, 'סגור', {
      duration: 3500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: [`sf-toast`, `sf-toast-${type}`],
    });
  }
}

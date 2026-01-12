import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

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
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-add-child-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './request-add-child-details.component.html',
  styleUrls: ['./request-add-child-details.component.scss'],
})
export class RequestAddChildDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;      // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  private db = dbTenant();
  private snack = inject(MatSnackBar);

  loading = signal(false);
  details = signal<AddChildDetails | null>(null);
  decisionNote = '';

  async ngOnInit() {
    await this.loadDetails();
  }

  async loadDetails() {
    this.loading.set(true);
    try {
      const { data, error } = await this.db.rpc('get_add_child_request_details', {
        p_request_id: this.request.id,
      });
      if (error) throw error;
      this.details.set((data?.[0] ?? null) as AddChildDetails | null);
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

      // TODO: הודעה להורה (כשתכתבי)
      // await this.db.rpc('notify_parent_add_child_approved', { p_request_id: this.request.id });

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

      // TODO: הודעה להורה
      // await this.db.rpc('notify_parent_add_child_rejected', { p_request_id: this.request.id });

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

import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

type CancelDetails = {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  child_id: string;
  child_name: string;
  instructor_id: string;
  instructor_name: string;
  reason: string;
  notified_at: string;
  cancelled_count_in_series: number;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-cancel-occurrence-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './request-cancel-occurrence-details.component.html',
  styleUrls: ['./request-cancel-occurrence-details.component.scss'],
})
export class RequestCancelOccurrenceDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;      // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  private db = dbTenant();
  private snack = inject(MatSnackBar);

  loading = signal(false);
  details = signal<CancelDetails | null>(null);
  decisionNote = '';

  async ngOnInit() {
    await this.loadDetails();
  }

  async loadDetails() {
    this.loading.set(true);
    try {
      const { data, error } = await this.db.rpc('get_cancel_occurrence_details', {
        p_request_id: this.request.id,
      });
      if (error) throw error;
      this.details.set((data?.[0] ?? null) as CancelDetails | null);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת פרטי הביטול';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  async approve() {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('approve_secretarial_cancel_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      const d = this.details();
      const who = d?.child_name ? `ל${d.child_name}` : 'לילד/ה';
      const when = d?.occur_date ? `בתאריך ${this.formatDate(d.occur_date)}` : '';
      const msg = `אישרת ביטול שיעור ${who} ${when}. הודעה להורה תישלח כעת.`;

      this.toast(msg, 'success');

      // TODO: הודעה להורה + הודעה למזכירה (כשתכתבי)
      // await this.db.rpc('notify_parent_cancelled_lesson', { p_request_id: this.request.id });

      this.onApproved?.({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        message: msg,
        meta: d,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה באישור בקשת ביטול';
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
      const who = d?.child_name ? `ל${d.child_name}` : 'לילד/ה';
      const msg = `דחית בקשת ביטול שיעור ${who}. הודעה נשלחה ברגעים אלה.`;

      this.toast(msg, 'info');

      // TODO: הודעה למבקש/הורה (כשתכתבי)
      // await this.db.rpc('notify_parent_cancel_rejected', { p_request_id: this.request.id });

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

  private formatDate(d: any): string {
    try { return new Date(d).toLocaleDateString('he-IL'); }
    catch { return String(d ?? ''); }
  }
}

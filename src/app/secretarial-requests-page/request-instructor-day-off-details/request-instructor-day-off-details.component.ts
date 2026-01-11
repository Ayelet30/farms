import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

type ImpactRow = {
  occur_date: string;     // date
  start_time: string;     // time
  end_time: string;       // time
  child_name: string;
  lesson_id: string;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-instructor-day-off-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './request-instructor-day-off-details.component.html',
  styleUrls: ['./request-instructor-day-off-details.component.scss'],
})
export class RequestInstructorDayOffDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;      // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  // ✅ callbacks שהאב מעביר דרך ngComponentOutlet
  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  private snack = inject(MatSnackBar);
  private db = dbTenant();

  loading = signal(false);
  loadingImpact = signal(false);
  impactRows = signal<ImpactRow[]>([]);
  decisionNote = '';

  async ngOnInit() {
    await this.loadImpact();
  }

  async loadImpact() {
    this.loadingImpact.set(true);
    try {
      const { data, error } = await this.db.rpc('get_instructor_day_off_impact', {
        p_request_id: this.request.id,
      });
      if (error) throw error;
      this.impactRows.set((data ?? []) as ImpactRow[]);
    } catch (e: any) {
      console.error(e);
      this.toast(e?.message || 'שגיאה בטעינת השיעורים שיתבטלו', 'error');
      this.onError?.({ requestId: this.request?.id, message: e?.message || 'impact load failed', raw: e });
    } finally {
      this.loadingImpact.set(false);
    }
  }

  async approve() {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('approve_instructor_day_off_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      const msg = `אישרת: ${this.getDayOffTitle()}. נשלחו הודעות להורים הרלוונטיים.`;
      this.toast(msg, 'success');

      // TODO: שליחת הודעה למדריך + הורים רלוונטיים (כשתכתבי RPCים)
      // await this.db.rpc('notify_instructor_day_off_approved', { p_request_id: this.request.id });
      // await this.db.rpc('notify_parents_lessons_cancelled', { p_request_id: this.request.id });

      // ✅ חשוב: לדווח לאב כדי שיעדכן רשימה מיידית
      this.onApproved?.({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        message: msg,
        meta: { impactCount: this.impactRows().length },
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
      const { error } = await this.db.rpc('reject_instructor_day_off_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      const msg = `דחית את הבקשה: ${this.getDayOffTitle()}. הודעה נשלחה ברגעים אלה.`;
      this.toast(msg, 'info');

      // TODO: שליחת הודעה למדריך
      // await this.db.rpc('notify_instructor_day_off_rejected', { p_request_id: this.request.id });

      this.onRejected?.({
        requestId: this.request.id,
        newStatus: 'REJECTED',
        message: msg,
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

  private getDayOffTitle(): string {
    const name = this.request?.instructorName || 'המדריך/ה';
    const from = this.formatDate(this.request?.fromDate);
    const to = this.formatDate(this.request?.toDate || this.request?.fromDate);

    return from === to
      ? `${name} – יום חופש בתאריך ${from}`
      : `${name} – יום חופש בין ${from} עד ${to}`;
  }
}

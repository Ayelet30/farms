import { Component, Input, OnInit, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';

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

@Component({
  selector: 'app-request-cancel-occurrence-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './request-cancel-occurrence-details.component.html',
  styleUrls: ['./request-cancel-occurrence-details.component.scss'],
})
export class RequestCancelOccurrenceDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;      // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED'; meta?: any }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  private db = dbTenant();

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
      this.error.emit(e?.message || 'שגיאה בטעינת פרטי הביטול');
    } finally {
      this.loading.set(false);
    }
  }

  // אישור: מפעיל את מה שכבר קיים אצלך היום
  async approve() {
    try {
      this.loading.set(true);

      // זו הפונקציה שממופה אצלך ל-CANCEL_OCCURRENCE
      const { error } = await this.db.rpc('approve_secretarial_cancel_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      // TODO: שליחת הודעה להורה (כשיהיה)
      // await this.db.rpc('notify_parent_cancelled_lesson', {...});

      this.approved.emit({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        meta: this.details(),
      });
    } catch (e: any) {
      console.error(e);
      this.error.emit(e?.message || 'שגיאה באישור בקשת ביטול');
    } finally {
      this.loading.set(false);
    }
  }

  // דחייה: להשאיר את הפונקציה שנקראת עכשיו (אצלך זה reject_secretarial_request)
  async reject() {
    try {
      this.loading.set(true);

      const { error } = await this.db.rpc('reject_secretarial_request', {
        p_request_id: this.request.id,
        p_decided_by_uid: this.decidedByUid,
        p_decision_note: this.decisionNote || null,
      });
      if (error) throw error;

      // TODO: הודעה למבקש/הורה
      // await this.db.rpc('notify_parent_cancel_rejected', {...});

      this.rejected.emit({ requestId: this.request.id, newStatus: 'REJECTED' });
    } catch (e: any) {
      console.error(e);
      this.error.emit(e?.message || 'שגיאה בדחיית הבקשה');
    } finally {
      this.loading.set(false);
    }
  }
}

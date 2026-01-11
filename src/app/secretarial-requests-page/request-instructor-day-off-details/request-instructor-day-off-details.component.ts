import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';


type ImpactRow = {
  occur_date: string;     // date
  start_time: string;     // time
  end_time: string;       // time
  child_name: string;
  lesson_id: string;
};

@Component({
  selector: 'app-request-instructor-day-off-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './request-instructor-day-off-details.component.html',
  styleUrls: ['./request-instructor-day-off-details.component.scss'], 
})
export class RequestInstructorDayOffDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;     // UiRequest
  @Input({ required: true }) decidedByUid!: string;

   @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  private snack = inject(MatSnackBar);

  loadingImpact = signal(false);
  impactRows = signal<ImpactRow[]>([]);
  decisionNote = '';

  private db = dbTenant();

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
    } finally {
      this.loadingImpact.set(false);
    }
  }

  async approve() {
  try {
    const { error } = await this.db.rpc('approve_instructor_day_off_request', {
      p_request_id: this.request.id,
      p_decided_by_uid: this.decidedByUid,
      p_decision_note: this.decisionNote || null,
    });
    if (error) throw error;

    // הודעה קופצת
    this.toast(`אישרת: ${this.getDayOffTitle()}.`, 'success');

    // TODO: שליחת הודעה למדריך + הורים רלוונטיים
    // await this.db.rpc('notify_instructor_day_off_approved', { ... });
    // await this.db.rpc('notify_parents_lessons_cancelled', { ... });

    this.approved.emit({ requestId: this.request.id, newStatus: 'APPROVED' });

  } catch (e: any) {
    console.error(e);
    this.toast(e?.message || 'שגיאה באישור הבקשה', 'error');
     this.error.emit(e?.message || 'שגיאה באישור');
    throw e;
  }

}


 async reject() {
  try {
    const { error } = await this.db.rpc('reject_instructor_day_off_request', {
      p_request_id: this.request.id,
      p_decided_by_uid: this.decidedByUid,
      p_decision_note: this.decisionNote || null,
    });
    if (error) throw error;

    // הודעה קופצת
    this.toast(`דחית את הבקשה: ${this.getDayOffTitle()}. הודעה נשלחה ברגעים אלה.`, 'info');

    // TODO: שליחת הודעה למדריך
    // await this.db.rpc('notify_instructor_day_off_rejected', { ... });

    this.rejected.emit({ requestId: this.request.id, newStatus: 'REJECTED' });

  } catch (e: any) {
    console.error(e);
    this.toast(e?.message || 'שגיאה בדחיית הבקשה', 'error');
     this.error.emit(e?.message || 'שגיאה בדחייה');
    throw e;
  }
}


  private toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
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
  const name = this.request.instructorName || 'המדריך/ה';
  const from = this.formatDate(this.request.fromDate);
  const to = this.formatDate(this.request.toDate || this.request.fromDate);

  return from === to
    ? `${name} – יום חופש בתאריך ${from}`
    : `${name} – יום חופש בין ${from} עד ${to}`;
}


}

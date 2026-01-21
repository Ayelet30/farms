import { Component, EventEmitter, Input, Output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

type UiRequest = any;

@Component({
  selector: 'app-request-remove-child-details',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './request-remove-child-details.component.html',
  styleUrls: ['./request-remove-child-details.component.css'],
})
export class RequestRemoveChildDetailsComponent {
  @Input({ required: true }) request!: UiRequest;
  @Input() decidedByUid?: string;

  // תמיכה גם ב-callbacks (כי את מעבירה inputs: { onApproved... })
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;

  // תמיכה גם ב-EventEmitters (כי את מאזינה דרך ngComponentOutletActivate)
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  // חילוץ payload בטוח
  payload = computed(() => (this.request?.payload ?? {}) as any);

  childFullName = computed(() => {
    const p = this.payload();
    const first = (p.first_name ?? p.firstName ?? '').toString().trim();
    const last = (p.last_name ?? p.lastName ?? '').toString().trim();
    const full = `${first} ${last}`.trim();
    return full || this.request?.childName || '—';
  });

  // אם יש אצלך שדות נוספים בבקשה למחיקה (למשל reason) אפשר להרחיב כאן
  reason = computed(() => {
    const p = this.payload();
    return (
      p.reason ??
      p.delete_reason ??
      p.summary ??
      this.request?.summary ??
      ''
    )
      .toString()
      .trim();
  });

  // ===== פעולות (סימולציה בלבד, ללא DB) =====
   async approveSimulate() {
    try {
      const ok = window.await.this.confirm(
        'לא מתבצעת מחיקה בדאטאבייס.\nרק סימון UI כ"מאושר".\nלהמשיך?'
      );
      if (!ok) return;

      const e = { requestId: this.request.id, newStatus: 'APPROVED' as const };
      this.approved.emit(e);
      this.onApproved?.(e);
    } catch (err: any) {
      const msg = err?.message ?? 'שגיאה באישור (סימולציה)';
      this.error.emit(msg);
      this.onError?.({ requestId: this.request?.id, message: msg, raw: err });
    }
  }

  rejectSimulate() {
    try {
      const ok = window.confirm(
        'לא מתבצעת מחיקה בדאטאבייס.\nרק סימון UI כ"נדחה".\nלהמשיך?'
      );
      if (!ok) return;

      const e = { requestId: this.request.id, newStatus: 'REJECTED' as const };
      this.rejected.emit(e);
      this.onRejected?.(e);
    } catch (err: any) {
      const msg = err?.message ?? 'שגיאה בדחייה (סימולציה)';
      this.error.emit(msg);
      this.onError?.({ requestId: this.request?.id, message: msg, raw: err });
    }
  }
}

import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

type BulkOutcomeKind = 'success' | 'systemRejected' | 'notProcessed';
type ViewKey = 'all' | 'success' | 'systemRejected' | 'notProcessed';

type BulkRunItemReport = {
  id: string;
  requestType?: string;
  summary?: string;
  requestedByName?: string;
  childName?: string;
  instructorName?: string;

  kind: BulkOutcomeKind;

  systemReason?: string;
  errorMessage?: string;
  warningMessage?: string;
};

type BulkRunReport = {
  action: 'approve' | 'reject';
  total: number;

  successCount: number;
  systemRejectedCount: number;
  notProcessedCount: number;

  results: BulkRunItemReport[];
  success?: BulkRunItemReport[];
  systemRejected?: BulkRunItemReport[];
  notProcessed?: BulkRunItemReport[];
};

@Component({
  selector: 'app-bulk-run-report-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './bulk-run-report-dialog.component.html',
  styleUrls: ['./bulk-run-report-dialog.component.css'],
})
export class BulkRunReportDialogComponent {
  private ref = inject<MatDialogRef<BulkRunReportDialogComponent>>(MatDialogRef);
  public data = inject<BulkRunReport>(MAT_DIALOG_DATA);

  // ✅ מצב תצוגה נבחר (כדי להבליט צ׳יפ ולהציג רשימה מסוננת)
  view = signal<ViewKey>('all');

  // ✅ מערכים מסודרים (גם אם לא הגיעו מהשרת)
  allList = computed<BulkRunItemReport[]>(() => this.data.results ?? []);
  successList = computed(() => (this.data.success ?? this.allList().filter(x => x.kind === 'success')));
  systemRejectedList = computed(() => (this.data.systemRejected ?? this.allList().filter(x => x.kind === 'systemRejected')));
  notProcessedList = computed(() => (this.data.notProcessed ?? this.allList().filter(x => x.kind === 'notProcessed')));

  // ✅ הרשימה שמוצגת בפועל לפי הצ׳יפ שנבחר
  visibleList = computed<BulkRunItemReport[]>(() => {
    switch (this.view()) {
      case 'success': return this.successList();
      case 'systemRejected': return this.systemRejectedList();
      case 'notProcessed': return this.notProcessedList();
      case 'all':
      default: return this.allList();
    }
  });

  // ✅ כותרת קטגוריה מעל הרשימה
  viewTitle = computed<string>(() => {
    switch (this.view()) {
      case 'success': return 'הצליחו';
      case 'systemRejected': return 'נדחו אוטומטית';
      case 'notProcessed': return 'לא טופלו';
      case 'all':
      default: return 'כל הבקשות';
    }
  });

  // ✅ מונה ליד הכותרת
  viewCount = computed<number>(() => this.visibleList().length);

  constructor() {
    // ✅ ברירת מחדל חכמה: אם יש “לא טופלו” – לפתוח שם, אחרת אם יש “נדחו מערכת”, אחרת “הצליחו”, אחרת “סה״כ”
    const np = (this.data.notProcessedCount ?? 0);
    const sys = (this.data.systemRejectedCount ?? 0);
    const ok = (this.data.successCount ?? 0);

    if (np > 0) this.view.set('notProcessed');
    else if (sys > 0) this.view.set('systemRejected');
    else if (ok > 0) this.view.set('success');
    else this.view.set('all');
  }

  setView(v: ViewKey) {
    this.view.set(v);
  }

  // ===== תוויות/אייקונים =====
  statusLabel(kind: BulkOutcomeKind): string {
    switch (kind) {
      case 'success': return 'בוצע';
      case 'systemRejected': return 'נדחה מערכת';
      case 'notProcessed': return 'לא טופל';
    }
  }

  statusIcon(kind: BulkOutcomeKind): string {
    switch (kind) {
      case 'success': return 'check_circle';
      case 'systemRejected': return 'info';
      case 'notProcessed': return 'hourglass_empty';
    }
  }

  // מה להציג בשורת “סיבה”
  rowReason(it: BulkRunItemReport): string | null {
    if (it.kind === 'systemRejected') return it.systemReason?.trim() || 'נדחה אוטומטית ע״י המערכת';
    if (it.kind === 'notProcessed') return it.errorMessage?.trim() || 'לא בוצעה פעולה';
    // success: רק אם יש warning
    return it.warningMessage?.trim() || null;
  }

  // אופציונלי: העתקת דוח
  copyReport() {
    const list = this.allList();
    const lines = list.map((it) => {
      const type = this.typeLabel(it.requestType ?? '');
      const st = this.statusLabel(it.kind);
      const summary = (it.summary ?? '').replace(/\s+/g, ' ').trim();
      const reason = (this.rowReason(it) ?? '—').replace(/\s+/g, ' ').trim();
      return `${st} | ${type} | ${summary}${reason !== '—' ? ` | ${reason}` : ''}`;
    });

    const header =
      `דוח הרצה – ${this.data.action === 'approve' ? 'אישור' : 'דחייה'}\n` +
      `סה"כ: ${this.data.total} | הצליחו: ${this.data.successCount} | נדחו מערכת: ${this.data.systemRejectedCount} | לא טופלו: ${this.data.notProcessedCount}\n\n`;

    navigator.clipboard?.writeText(header + lines.join('\n'));
  }

  close() {
    this.ref.close();
  }

  typeLabel(t: string): string {
    switch (t) {
      case 'DELETE_CHILD': return 'מחיקת ילד/ה';
      case 'NEW_SERIES': return 'סדרת שיעורים';
      case 'CANCEL_OCCURRENCE': return 'ביטול שיעור';
      case 'INSTRUCTOR_DAY_OFF': return 'יום חופש מדריך';
      case 'ADD_CHILD': return 'הוספת ילד/ה';
      case 'MAKEUP_LESSON': return 'שיעור השלמה';
      case 'FILL_IN': return 'מילוי מקום';
      case 'PARENT_SIGNUP': return 'הרשמת הורה';
      default: return t || '—';
    }
  }

  trackById = (_: number, x: BulkRunItemReport) => x?.id;
}

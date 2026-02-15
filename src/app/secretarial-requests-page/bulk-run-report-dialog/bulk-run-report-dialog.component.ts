import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

type BulkRunItemReport = any; // אפשר לייבא טיפוס אם שמור בקובץ משותף
type BulkRunReport = any;

@Component({
  selector: 'app-bulk-run-report-dialog',
  standalone: true,
imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule, MatTooltipModule],
  templateUrl: './bulk-run-report-dialog.component.html',
  styleUrls: ['./bulk-run-report-dialog.component.css'],
})
export class BulkRunReportDialogComponent {
  private ref = inject<MatDialogRef<BulkRunReportDialogComponent>>(MatDialogRef);
  public data = inject<BulkRunReport>(MAT_DIALOG_DATA);
displayedColumns = ['status', 'type', 'summary', 'reason'];

statusLabel(kind: 'success' | 'failed' | 'systemRejected'): string {
  switch (kind) {
    case 'success': return 'בוצע';
    case 'systemRejected': return 'נדחה מערכת';
    case 'failed': return 'נכשל';
  }
}

statusIcon(kind: 'success' | 'failed' | 'systemRejected'): string {
  switch (kind) {
    case 'success': return 'check_circle';
    case 'systemRejected': return 'warning';
    case 'failed': return 'error';
  }
}

rowReason(it: any): string {
  if (it.kind === 'systemRejected') return it.systemReason ?? '—';
  if (it.kind === 'failed') return it.errorMessage ?? '—';
  return '—';
}

// אופציונלי: העתקת דוח
copyReport() {
  const lines = (this.data.results ?? []).map((it: any) => {
    const type = this.typeLabel(it.requestType);
    const st = this.statusLabel(it.kind);
    const summary = (it.summary ?? '').replace(/\s+/g, ' ').trim();
    const reason = this.rowReason(it).replace(/\s+/g, ' ').trim();
    return `${st} | ${type} | ${summary}${reason !== '—' ? ` | ${reason}` : ''}`;
  });

  const header =
    `דוח הרצה – ${this.data.action === 'approve' ? 'אישור' : 'דחייה'}\n` +
    `סה"כ: ${this.data.total} | הצליחו: ${this.data.successCount} | נדחו מערכת: ${this.data.systemRejectedCount} | נכשלו: ${this.data.failedCount}\n\n`;

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

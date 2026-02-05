import { CommonModule } from '@angular/common';
import { Component, Inject, signal, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BreakpointObserver } from '@angular/cdk/layout';
export type BulkDecisionMode = 'approve' | 'reject';

export type BulkDecisionItem = {
  id: string;
  requestType: string;
  requestedByName?: string;
  summary?: string;
  childName?: string;
  instructorName?: string;
  createdAt?: string; // ISO
};

export type BulkDecisionDialogData = {
  mode: BulkDecisionMode;
  title: string;
  items: BulkDecisionItem[];
};

export type BulkDecisionDialogResult =
  | { confirmed: true; reasonsById?: Record<string, string> }  // 👈 חדש
  | { confirmed: false };

@Component({
  selector: 'app-bulk-decision-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './bulk-decision-dialog.component.html',
  styleUrls: ['./bulk-decision-dialog.component.css'],
})
export class BulkDecisionDialogComponent {
  isMobile = signal(false);

  private bo = inject(BreakpointObserver);
  reasonsById = signal<Record<string, string>>({});
  isReject = computed(() => this.data.mode === 'reject');

  private ref =
    inject<MatDialogRef<BulkDecisionDialogComponent, BulkDecisionDialogResult>>(MatDialogRef);

  public data =
    inject<BulkDecisionDialogData>(MAT_DIALOG_DATA);

  constructor() {
    this.bo.observe(['(max-width: 900px)']).subscribe(r => {
      this.isMobile.set(r.matches);
    });
  }
  reason = signal('');

setReason(id: string, v: string) {
    const cur = this.reasonsById();
    this.reasonsById.set({ ...cur, [id]: v });
  }
   getReason(id: string): string {
    return (this.reasonsById()[id] ?? '').toString();
  }
 canConfirm = computed(() => {
    if (!this.isReject()) return true;

    // חובה סיבה לכל item
    const items = this.data.items ?? [];
    const map = this.reasonsById();
    return items.every(it => (map[it.id] ?? '').trim().length > 0);
  });
  closeNo() {
    this.ref.close({ confirmed: false });
  }

  closeYes() {
    if (this.isReject()) {
      // מחזירים את כל הסיבות לפי id
      const map = this.reasonsById();
      const cleaned: Record<string, string> = {};
      for (const it of (this.data.items ?? [])) {
        cleaned[it.id] = (map[it.id] ?? '').trim();
      }
      this.ref.close({ confirmed: true, reasonsById: cleaned });
      return;
    }

    this.ref.close({ confirmed: true });
  }
  trackById = (_: number, r: any) => r?.id;

getTypeLabel(type: string): string {
  switch (type) {
    case 'DELETE_CHILD': return 'מחיקת ילד/ה';
    case 'NEW_SERIES': return 'סדרת שיעורים';
    case 'CANCEL_OCCURRENCE': return 'ביטול שיעור';
    case 'INSTRUCTOR_DAY_OFF': return 'יום חופש מדריך';
    case 'ADD_CHILD': return 'הוספת ילד/ה';
    case 'MAKEUP_LESSON': return 'שיעור פיצוי';
    case 'FILL_IN': return 'מילוי מקום';
    case 'PARENT_SIGNUP': return 'הרשמת הורה';
    default: return type || '—';
  }
}

}
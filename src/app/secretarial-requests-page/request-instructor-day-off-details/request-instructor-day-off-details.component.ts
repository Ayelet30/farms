import { Component, Input, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

type ImpactRow = {
  occur_date: string; // date
  start_time: string; // time
  end_time: string;   // time
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
export class RequestInstructorDayOffDetailsComponent {
  private snack = inject(MatSnackBar);
  private db = dbTenant();

  // ====== INPUTS → Signals (כדי שהפרטים יתעדכנו תמיד) ======
  private _req = signal<any | null>(null);
  readonly req = this._req;

  @Input({ required: true })
  set request(value: any) {
    this._req.set(value);
  }

  private _decidedByUid = signal<string | null>(null);
  readonly decidedByUidSig = this._decidedByUid;

  @Input({ required: true })
  set decidedByUid(value: string) {
    this._decidedByUid.set(value);
  }

  // callbacks מהאב
  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  // ====== UI state ======
  loading = signal(false);
  loadingImpact = signal(false);
  impactRows = signal<ImpactRow[]>([]);
  decisionNote = signal(''); // ✅ סיגנל במקום string

  // כדי למנוע מצב שבו response ישן מגיע אחרי חדש
  private runToken = 0;

  // ====== נגזרים ======
  impactCount = computed(() => this.impactRows().length);

  constructor() {
    // כל פעם שהבקשה משתנה (לפי id) → טוענים impact מחדש
    effect(() => {
      const id = this.req()?.id;
      if (!id) return;

      // איפוס תצוגה “מיד” כדי שלא יישארו שורות מהבקשה הקודמת
      this.impactRows.set([]);
      this.decisionNote.set(this.decisionNote()); // משאירה מה שהקלדת (אם תרצי לאפס: set(''))

      void this.loadImpact();
    });
  }

  async loadImpact() {
    const r = this.req();
    const requestId = r?.id;
    if (!requestId) return;

    const token = ++this.runToken;

    this.loadingImpact.set(true);
    try {
      const { data, error } = await this.db.rpc('get_instructor_day_off_impact', {
        p_request_id: requestId,
      });
      if (error) throw error;

      if (token !== this.runToken) return; // נזרק אם כבר נבחרה בקשה אחרת
      this.impactRows.set((data ?? []) as ImpactRow[]);
    } catch (e: any) {
      if (token !== this.runToken) return;
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת השיעורים שיתבטלו';
      this.toast(msg, 'error');
      this.onError?.({ requestId, message: msg, raw: e });
    } finally {
      if (token !== this.runToken) return;
      this.loadingImpact.set(false);
    }
  }

  static async isValidRequset(row: any): Promise<{ ok: boolean; reason?: string }> {
    const end = row?.toDate ?? row?.fromDate ?? null;
    if (!end) return { ok: true };

    const dt = RequestInstructorDayOffDetailsComponent.combineDateTime(end, '23:59');
    if (dt.getTime() < Date.now()) {
      return { ok: false, reason: 'עבר מועד חופשת המדריך' };
    }
    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestInstructorDayOffDetailsComponent.isValidRequset(this.req());
  }

  async approve() {
    if (this.loading()) return;

    const r = this.req();
    const requestId = r?.id;
    const decidedByUid = this.decidedByUidSig();

    if (!requestId || !decidedByUid) return;

    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('approve_instructor_day_off_request', {
        p_request_id: requestId,
        p_decided_by_uid: decidedByUid,
        p_decision_note: (this.decisionNote().trim() || null),
      });
      if (error) throw error;

      const msg = `אישרת: ${this.getDayOffTitle()}. נשלחו הודעות להורים הרלוונטיים.`;
      this.toast(msg, 'success');

      this.onApproved?.({
        requestId,
        newStatus: 'APPROVED',
        message: msg,
        meta: { impactCount: this.impactRows().length },
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה באישור הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  async reject() {
    if (this.loading()) return;

    const r = this.req();
    const requestId = r?.id;
    const decidedByUid = this.decidedByUidSig();

    if (!requestId || !decidedByUid) return;

    this.loading.set(true);

    try {
      const { error } = await this.db.rpc('reject_instructor_day_off_request', {
        p_request_id: requestId,
        p_decided_by_uid: decidedByUid,
        p_decision_note: (this.decisionNote().trim() || null),
      });
      if (error) throw error;

      const msg = `דחית את הבקשה: ${this.getDayOffTitle()}. הודעה נשלחה ברגעים אלה.`;
      this.toast(msg, 'info');

      this.onRejected?.({
        requestId,
        newStatus: 'REJECTED',
        message: msg,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בדחיית הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId, message: msg, raw: e });
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

  private static combineDateTime(dateStr: string, timeStr?: string | null): Date {
    const d = dateStr?.slice(0, 10);
    const t = (timeStr ?? '00:00').slice(0, 5);
    return new Date(`${d}T${t}:00`);
  }

  getDayOffTitle(): string {
    const r = this.req();
    const name = r?.instructorName || 'המדריך/ה';
    const from = this.formatDate(r?.fromDate);
    const to = this.formatDate(r?.toDate || r?.fromDate);

    return from === to
      ? `${name} – יום חופש בתאריך ${from}`
      : `${name} – יום חופש בין ${from} עד ${to}`;
  }
}

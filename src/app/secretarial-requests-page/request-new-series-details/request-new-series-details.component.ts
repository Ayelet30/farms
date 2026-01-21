

import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';

import { SeriesRequestsService } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';

// חשוב: זה הטיפוס שאת מעבירה מהדף הראשי
import { UiRequest } from '../../Types/detailes.model';

@Component({
  selector: 'app-secretarial-series-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './request-new-series-details.component.html',
  styleUrls: ['./request-new-series-details.component.scss'],
})
export class SecretarialSeriesRequestsComponent {
  private api = inject(SeriesRequestsService);
async ngOnInit() {
  await this.loadPaymentPlanName();
}

  // ✅ הבקשה שנבחרה מהדף הראשי
  @Input({ required: true }) request!: UiRequest;

  // ✅ מי מאשר (מגיע מהדף הראשי)
  @Input() decidedByUid?: string | null;

  // (אופציונלי) callbacks – כי את מעבירה אותם כבר ב-inputs
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;

  // ✅ outputs – כדי שגם onDetailsActivate יוכל להאזין (approved/rejected/error)
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  loading = signal(false);
paymentPlanName = signal<string>('טוען...');

  // הערה אחת לבקשה הנוכחית
  note = '';

  // נוחות: payload מקוצר
  get p(): any {
    return this.request?.payload ?? {};
  }

  // נוחות: שדות נפוצים (עם fallback)
  get referralUrl(): string {
  return this.p?.referral_url ?? '';
}

get isOpenEnded(): boolean {
  return !!this.p?.is_open_ended;
}

get requestedStartTime(): string {
  return this.p?.requested_start_time ?? '—';
}

// תאריך התחלה/סיום מגיעים מהטבלה עצמה (from_date/to_date)
get startDate(): string {
  return this.request?.fromDate ?? '—';
}

// ✅ אם לא open-ended – לקחת מהטבלה (to_date)
get endDate(): string {
  if (this.isOpenEnded) return '—';
  return this.request?.toDate ?? '—';
}

get seriesSearchHorizonDays(): number | string {
  return this.p?.series_search_horizon_days ?? '—';
}

get skippedFarmDates(): string[] {
  return Array.isArray(this.p?.skipped_farm_dates) ? this.p.skipped_farm_dates : [];
}

get skippedInstructorDates(): string[] {
  return Array.isArray(this.p?.skipped_instructor_dates) ? this.p.skipped_instructor_dates : [];
}

 
  get startTime(): string {
    return this.p.start_time ?? this.p.time ?? '';
  }
 
  get repeatWeeks(): number {
    return Number(this.p.repeat_weeks ?? this.p.weeks ?? 0) || 0;
  }
  get paymentSource(): string {
    return this.p.payment_source ?? this.p.paymentSource ?? '—';
  }

  private async resolveDeciderUid(): Promise<string | null> {
    if (this.decidedByUid) return this.decidedByUid;
    const uid = (await getCurrentUserData())?.uid ?? null;
    return uid;
  }
private async loadPaymentPlanName() {
  const id = this.p?.payment_plan_id;
  if (!id) {
    this.paymentPlanName.set('—');
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('payment_plans')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    this.paymentPlanName.set(data?.name ?? 'לא נמצא');
  } catch (e) {
    console.error('loadPaymentPlanName failed', e);
    this.paymentPlanName.set('שגיאה בטעינה');
  }
}

  async approveSelected() {
  if (!this.request?.id) return;

  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) {
      throw new Error('לא נמצא משתמש מאשר (uid)');
    }

    const note = this.note.trim();

    const res = await this.api.approve(this.request.id, uid, note);
    const first = Array.isArray(res) ? res[0] : res;

    if (!first?.ok) {
      const msg = `לא ניתן לאשר: ${first?.deny_reason ?? 'unknown'}`;
      this.error.emit(msg);
      this.onError?.({ requestId: this.request.id, message: msg, raw: first });
      alert(msg);
      return;
    }

    const payload = { requestId: this.request.id, newStatus: 'APPROVED' as const };
    this.approved.emit(payload);
    this.onApproved?.(payload);
  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה באישור';
    this.error.emit(msg);
    this.onError?.({ requestId: this.request.id, message: msg, raw: e });
    alert(msg);
  } finally {
    this.loading.set(false);
  }
}

  async rejectSelected() {
  if (!this.request?.id) return;

  const note = this.note.trim();
  if (!note) {
    alert('כדי לדחות חייבים לכתוב סיבת דחייה קצרה');
    return;
  }

  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) {
      throw new Error('לא נמצא משתמש מאשר (uid)');
    }

    await this.api.reject(this.request.id, uid, note);

    const payload = { requestId: this.request.id, newStatus: 'REJECTED' as const };
    this.rejected.emit(payload);
    this.onRejected?.(payload);
  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה בדחייה';
    this.error.emit(msg);
    this.onError?.({ requestId: this.request.id, message: msg, raw: e });
    alert(msg);
  } finally {
    this.loading.set(false);
  }
}

}

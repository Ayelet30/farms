

import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';

import { SeriesRequestsService } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';

// חשוב: זה הטיפוס שאת מעבירה מהדף הראשי
import type { UiRequest } from '../../Types/detailes.model';
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
  if (!this.request) return;

  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');

    await ensureTenantContextReady();
    const db = dbTenant();

    const p: any = this.request.payload ?? {};
const instructorIdNumber = this.request.instructorId; // מה-row בטבלה
if (!instructorIdNumber) throw new Error('חסר instructor_id_number בבקשה');

const instructorUid = await this.getInstructorUidByIdNumber(instructorIdNumber);
if (!instructorUid) throw new Error('למדריך אין uid במערכת');
    // ⚠️ חשוב: fromDate/toDate מגיעים מהטבלה secretarial_requests אצלך (לא מה-payload)
    const params = {
     p_child_id: this.request.childId ?? null,
      p_instructor_id_number: instructorIdNumber,
  p_instructor_uid: instructorUid,
      p_series_start_date: this.request.fromDate ?? null,
      p_start_time: p.requested_start_time ?? null,
      p_is_open_ended: !!p.is_open_ended,
      p_repeat_weeks: p.repeat_weeks ?? null,                   
      p_series_search_horizon_days: p.series_search_horizon_days ?? 90,
      p_max_participants: 1,
      p_payment_source: p.payment_source ?? null,              
      p_existing_approval_id: null,
      p_payment_plan_id: p.payment_plan_id ?? null,
      p_health_fund: p.health_fund ?? null,
      p_approval_number: p.approval_number ?? null,
      p_total_lessons: p.total_lessons ?? null,
      p_referral_url: p.referral_url ?? null,

      p_riding_type_id: p.riding_type_id ?? null,
      p_origin: "secretary",
    };

    const { data, error } = await db.rpc('create_series_with_validation', params);
    if (error) throw error;

    const first = Array.isArray(data) ? data[0] : data;

    if (!first?.ok) {
      const msg = `לא ניתן לאשר: ${first?.deny_reason ?? 'unknown'}`;
      this.error.emit(msg);
      this.onError?.({ requestId: this.request.id, message: msg, raw: first });
      alert(msg);
      return;
    }
await ensureTenantContextReady();

// ✅ עדכון סטטוס הבקשה רק אם עדיין PENDING
const { data: upd, error: updErr } = await db
  .from('secretarial_requests')
  .update({
    status: 'APPROVED',
    decided_by_uid: uid,
    decision_note: this.note || null,
    decided_at: new Date().toISOString(), // (אם תרצי server time נדבר על זה)
  })
  .eq('id', this.request.id)
  .eq('status', 'PENDING')
  .select('id,status')
  .maybeSingle();

if (updErr) throw updErr;

if (!upd) {
  // כלומר או שלא הייתה בקשה כזו, או שכבר לא PENDING (מישהו אישר/דחה לפני)
  throw new Error('הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).');
}

    // ✅ אם הצליח – פה יש לך lesson_id / approval_id וכו’
    // אבל שימי לב: create_series_with_validation לא מעדכנת סטטוס של secretarial_requests!
    // אם את רוצה שהבקשה תיעלם – חייבים update לטבלה או RPC נוסף.
    // כרגע רק נעדכן UI
    const payload = { requestId: this.request.id, newStatus: 'APPROVED' as const };
    this.approved.emit(payload);
    this.onApproved?.(payload);

  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה באישור';
    this.error.emit(msg);
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
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
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');

    await ensureTenantContextReady();
    const db = dbTenant();

    // ✅ עדכון סטטוס רק אם עדיין PENDING
    const { data, error } = await db
      .from('secretarial_requests')
      .update({
        status: 'REJECTED',
        decided_by_uid: uid,
        decision_note: note,
        decided_at: new Date().toISOString(),
      })
      .eq('id', this.request.id)
      .eq('status', 'PENDING')
      .select('id,status')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      alert('הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).');
      return;
    }

    const payload = { requestId: this.request.id, newStatus: 'REJECTED' as const };
    this.rejected.emit(payload);
    this.onRejected?.(payload);

  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה בדחייה';
    this.error.emit(msg);
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    alert(msg);
  } finally {
    this.loading.set(false);
  }
}

private async getInstructorUidByIdNumber(idNumber: string): Promise<string | null> {
  await ensureTenantContextReady();
  const db = dbTenant();

  const { data, error } = await db
    .from('instructors')
    .select('uid')
    .eq('id_number', idNumber)
    .maybeSingle();

  if (error) throw error;
  return data?.uid ?? null;
}


}

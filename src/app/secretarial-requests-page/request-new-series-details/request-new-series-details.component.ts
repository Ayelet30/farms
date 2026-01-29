

import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';

import { SeriesRequestsService } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent } from '../confirm-dialog.component';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';


// חשוב: זה הטיפוס שאת מעבירה מהדף הראשי
import type { UiRequest } from '../../Types/detailes.model';
@Component({
  selector: 'app-secretarial-series-requests',
  standalone: true,
  imports: [CommonModule, FormsModule , MatDialogModule , MatSnackBarModule, MatTooltipModule],
  templateUrl: './request-new-series-details.component.html',
  styleUrls: ['./request-new-series-details.component.scss'],
})
export class SecretarialSeriesRequestsComponent {
  private api = inject(SeriesRequestsService);
async ngOnInit() {
  // await this.loadPaymentPlanName();
  // await this.loadInstructorName();

}

  // ✅ הבקשה שנבחרה מהדף הראשי
private _request!: UiRequest;
ridingTypeName = signal<string>('טוען...');
lessonTypeMode = signal<string | null>(null);

@Input({ required: true })
set request(v: UiRequest) {
  this._request = v;

  // ✅ איפוס טקסט והודעות כשעוברים לבקשה אחרת
  this.note = '';
  this.clearMessages();
   this.loading.set(false);

  // 2) איפוס נתונים שמגיעים מטעינות async
  this.paymentPlanName.set('טוען...');
  this.instructorName.set('טוען...');

  // 3) טעינה מחדש לפי הבקשה החדשה
  void this.loadPaymentPlanName();
  void this.loadInstructorName();
  this.ridingTypeName.set('טוען...');
this.lessonTypeMode.set(null);

void this.loadLessonTypeFromAvailability();
this.existingParticipants.set([]);
this.participantsCapacity.set(null);

void this.loadExistingParticipants();
void this.loadChildStatus();

}

get request(): UiRequest {
  return this._request;
}

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
instructorName = signal<string>('טוען...');
private dialog = inject(MatDialog);
private snack = inject(MatSnackBar);
successMsg = signal<string | null>(null);
errorMsg = signal<string | null>(null);
existingParticipants = signal<any[]>([]);
participantsCapacity = signal<{ current: number; max: number } | null>(null);
// ===== Child status (from children table) =====
childStatus = signal<string | null>(null);
childDeletionRequestedAt = signal<string | null>(null);
childScheduledDeletionAt = signal<string | null>(null);

canApprove = signal<boolean>(true); // יתעדכן לפי סטטוס

private statusToHebrew(status: string | null): string {
  switch (status) {
    case 'Active': return 'פעיל';
    case 'Pending Addition Approval': return 'ממתין לאישור הוספה';
    case 'Pending Deletion Approval': return 'ממתין לאישור מחיקה';
    case 'Deletion Scheduled': return 'מחיקה מתוכננת';
    case 'Deleted': return 'נמחק';
    default: return status ? status : 'לא ידוע';
  }
}

private formatDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  // "2026-01-29T..." -> "2026-01-29"
  return iso.slice(0, 10);
}

get childStatusHebrew(): string {
  return this.statusToHebrew(this.childStatus());
}

get childStatusBannerText(): string | null {
  const st = this.childStatus();
  if (!st) return null;
  if (st === 'Active') return null;

  const stHe = this.statusToHebrew(st);

  if (st === 'Deletion Scheduled') {
    const d = this.formatDateOnly(this.childScheduledDeletionAt());
    return `ילד זה אינו פעיל (סטטוס: ${stHe})${d ? ` • תאריך מחיקה עתידי: ${d}` : ''}`;
  }

  if (st === 'Deleted') {
    // אין לך deleted_at בטבלה, אז נשתמש במה שיש (עדיף scheduled_deletion_at אם קיים, אחרת deletion_requested_at)
    const when =
      this.formatDateOnly(this.childScheduledDeletionAt()) ??
      this.formatDateOnly(this.childDeletionRequestedAt());

    return `ילד זה אינו פעיל (סטטוס: ${stHe})${when ? ` • נמחק בתאריך: ${when}` : ''}`;
  }

  // כל שאר הסטטוסים
  return `ילד זה אינו פעיל (סטטוס: ${stHe})`;
}

private async loadChildStatus() {
  const childId = this.request?.childId;
  if (!childId) {
    this.childStatus.set(null);
    this.childDeletionRequestedAt.set(null);
    this.childScheduledDeletionAt.set(null);
    this.canApprove.set(true);
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('children')
      .select('status, deletion_requested_at, scheduled_deletion_at')
      .eq('child_uuid', childId)
      .maybeSingle();

    if (error) throw error;

    const st = (data as any)?.status ?? null;
    this.childStatus.set(st);
    this.childDeletionRequestedAt.set((data as any)?.deletion_requested_at ?? null);
    this.childScheduledDeletionAt.set((data as any)?.scheduled_deletion_at ?? null);

this.canApprove.set(st !== 'Deleted');
  } catch (e) {
    console.error('loadChildStatus failed', e);
    // במקרה תקלה – ניזהר ולא נאפשר אישור עד שהכל ברור
    this.childStatus.set('לא ידוע');
    this.canApprove.set(false);
  }
}

private clearMessages() {
  this.successMsg.set(null);
  this.errorMsg.set(null);
}

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
  this.clearMessages();

  if (!this.request) return;
  if (!this.canApprove()) {
  const msg = this.childStatusBannerText ?? 'לא ניתן לאשר סדרה לילד שאינו פעיל';
  this.errorMsg.set(msg);
  this.snack.open('לא ניתן לאשר: הילד אינו פעיל', 'סגור', {
    duration: 2500,
    panelClass: ['snack-reject'],
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
  });
  return;
}


  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');
const ok = await this.confirmApprove();
if (!ok) return;

    await ensureTenantContextReady();
    const db = dbTenant();

    const p: any = this.request.payload ?? {};
const instructorIdNumber = this.request.instructorId; // מה-row בטבלה
if (!instructorIdNumber) throw new Error('חסר instructor_id_number בבקשה');

const instructorUid = await this.getInstructorUidByIdNumber(instructorIdNumber);
if (!instructorUid) throw new Error('למדריך אין uid במערכת');
const isOpenEnded = !!p.is_open_ended;
const ridingTypeId = p.riding_type_id ?? null;
const maxParticipants = await this.getMaxParticipantsForRidingType(ridingTypeId);
const normalizeTime = (t: string) => {
  const s = (t ?? '').trim();
  if (!s) return null;
  return s.length === 5 ? `${s}:00` : s; // "09:00" -> "09:00:00"
};

const startTime = normalizeTime(this.requestedStartTime);

const repeatWeeks =
  isOpenEnded
    ? null
    : Number(p.repeat_weeks);
    // ⚠️ חשוב: fromDate/toDate מגיעים מהטבלה secretarial_requests אצלך (לא מה-payload)
    const params = {
     p_child_id: this.request.childId ?? null,
      p_instructor_id_number: instructorIdNumber,
  p_instructor_uid: instructorUid,
      p_series_start_date: this.request.fromDate ?? null,
      p_start_time: startTime,
      p_is_open_ended: !!p.is_open_ended,
      p_repeat_weeks: repeatWeeks,                   
      p_series_search_horizon_days: p.series_search_horizon_days ?? 90,
      p_max_participants: maxParticipants,
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
      this.snack.open('הבקשה אושרה בהצלחה', 'סגור', {
  duration: 2500,
  panelClass: ['snack-success'],
  direction: 'rtl',
});
    this.approved.emit(payload);
    this.onApproved?.(payload);

  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה באישור';
  

    this.error.emit(msg);
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
this.errorMsg.set(msg);
  } finally {
    this.loading.set(false);
  }
}



async rejectSelected() {
  this.clearMessages();

  if (!this.request?.id) return;
   const note = this.note.trim();
  if (!note) {
    this.errorMsg.set('חובה למלא סיבה לפני דחיית בקשה');
    return;
  }

  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');
const ok = await this.confirmReject();
if (!ok) return; // חוזר למצב הקודם, לא עושה כלום

    await ensureTenantContextReady();
    const db = dbTenant();

    const note = this.note.trim(); // יכול להיות גם ''

    const { data, error } = await db
      .from('secretarial_requests')
      .update({
        status: 'REJECTED',
        decided_by_uid: uid,
        decision_note: note , 
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
     this.snack.open('הבקשה נדחתה בהצלחה', 'סגור', {
  duration: 2500,
  panelClass: ['snack-reject'],
  direction: 'rtl',
  horizontalPosition: 'center',
  verticalPosition: 'top',
});

    this.rejected.emit(payload);
    this.onRejected?.(payload);

  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה בדחייה';
 
    this.error.emit(msg);
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
this.errorMsg.set(msg);
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
private async confirmReject(): Promise<boolean> {
  const ref = this.dialog.open(ConfirmDialogComponent, {
    panelClass: 'ui-confirm-dialog',
    backdropClass: 'ui-confirm-backdrop',
    data: {
      title: 'דחיית בקשה',
      message: 'האם את/ה בטוח/ה שברצונך לדחות את הבקשה?',
    },
  });

  return !!(await firstValueFrom(ref.afterClosed()));
}
private async confirmApprove(): Promise<boolean> {
  const ref = this.dialog.open(ConfirmDialogComponent, {
    panelClass: 'ui-confirm-dialog',
    backdropClass: 'ui-confirm-backdrop',
    data: {
      title: 'אישור בקשה',
      message: 'האם את/ה בטוח/ה שברצונך לאשר את הבקשה?',
    },
  });

  return !!(await firstValueFrom(ref.afterClosed()));
}
private async loadInstructorName() {
  const idNumber = this.request?.instructorId; // אצלך זה id_number
  if (!idNumber) {
    this.instructorName.set('—');
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('instructors')
      .select('first_name,last_name,id_number')
      .eq('id_number', idNumber)
      .maybeSingle();

    if (error) throw error;

    const full =
      `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();

    this.instructorName.set(full || data?.id_number || 'לא נמצא');
  } catch (e) {
    console.error('loadInstructorName failed', e);
    this.instructorName.set('שגיאה בטעינה');
  }
}

get startWeekdayName(): string {
  const d = this.parseDateOnly(this.startDate);
  if (!d) return '—';

  // יום בשבוע בעברית (ראשון..שבת)
  const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return names[d.getDay()];
}

private parseDateOnly(value: string): Date | null {
  if (!value || value === '—') return null;

  // אם זה כבר YYYY-MM-DD (הכי נפוץ אצלך)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const da = Number(m[3]);
    const dt = new Date(y, mo, da); // לוקאלי, בלי timezone בעיות
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // fallback למקרים אחרים
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
private async loadLessonTypeFromAvailability() {
  const instructorId = this.request?.instructorId; // id_number
  const dateStr = this.startDate;                  // YYYY-MM-DD
  const t = this.requestedStartTime;               // "15:30"

  if (!instructorId || !dateStr || dateStr === '—' || !t || t === '—') {
    this.ridingTypeName.set('—');
    this.lessonTypeMode.set(null);
    return;
  }

  const d = this.parseDateOnly(dateStr);
  if (!d) {
    this.ridingTypeName.set('—');
    this.lessonTypeMode.set(null);
    return;
  }

  // שימי לב: אצלך day_of_week הוא 0..6, וב-JS getDay() גם 0..6 (ראשון=0)
  const dow = d.getDay();

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    // מחפשים טווח שבו start_time <= t < end_time
    // לוקחים את ה-slot "הכי ספציפי" (start_time הכי מאוחר שמתאים) כדי להימנע מחפיפות
    const { data, error } = await db
      .from('instructor_weekly_availability')
      .select(`
        start_time,
        end_time,
        lesson_type_mode,
        riding_types:lesson_ridding_type ( name )
      `)
      .eq('instructor_id_number', instructorId)
      .eq('day_of_week', dow)
      .lte('start_time', t)
      .gt('end_time', t) // end_time > t  (כלומר t בתוך הטווח)
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const name = (data as any)?.riding_types?.name ?? null;
    this.ridingTypeName.set(name ?? 'לא נמצא');
    this.lessonTypeMode.set((data as any)?.lesson_type_mode ?? null);
  } catch (e) {
    console.error('loadLessonTypeFromAvailability failed', e);
    this.ridingTypeName.set('שגיאה בטעינה');
    this.lessonTypeMode.set(null);
  }
}
private async loadExistingParticipants() {
  const instructorId = this.request?.instructorId;
  const startTime = this.requestedStartTime;
  const ridingTypeId = this.p?.riding_type_id;

  const dayName = this.startWeekdayName; // כבר חישבת בעברית

  if (!instructorId || !startTime || !dayName) {
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();
console.log('participants args', {
  instructorId: this.request?.instructorId,
  startDate: this.startDate,
  dayName: this.startWeekdayName,
  startTime: this.requestedStartTime,
  ridingTypeId: this.p?.riding_type_id,
});
    const { data, error } = await db.rpc(
      'get_existing_lesson_participants',
      {
        p_instructor_id: instructorId,
        p_day_of_week: dayName,
        p_start_time: startTime,
        p_riding_type_id: ridingTypeId ?? null,
      }
    );

if (Array.isArray(data)) {
  
}

    if (error) throw error;
    if (!data || !data.length) return;

    this.existingParticipants.set(data);


    this.participantsCapacity.set({
      current: data[0].current_count,
      max: data[0].max_participants,
    });

  } catch (e) {
    console.error('loadExistingParticipants failed', e);
    this.existingParticipants.set([]);
    this.participantsCapacity.set(null);
  }
}
calcAge(birthDate: string | null): string {
  if (!birthDate) return '—';
  const b = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age.toString();
}
private async getMaxParticipantsForRidingType(ridingTypeId: string | null | undefined): Promise<number> {
  // ברירת מחדל: פרטי
  if (!ridingTypeId) return 1;

  await ensureTenantContextReady();
  const db = dbTenant();

  const { data, error } = await db
    .from('riding_types')
    .select('max_participants, active')
    .eq('id', ridingTypeId)
    .maybeSingle();

  if (error) throw error;

  // אם לא נמצא / לא פעיל / null -> 1
  const max = data?.active === false ? null : data?.max_participants;
  const n = Number(max);

  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}
get approveTooltip(): string | null {
  const st = this.childStatus();

  if (st === 'Deleted') {
    return 'ילד זה נמחק ולכן לא ניתן לאשר לו את הזמנת הסדרה';
  }

  if (st === 'Deletion Scheduled') {
    const d = this.formatDateOnly(this.childScheduledDeletionAt());
    return d
      ? `שימו לב: הילד עתיד להימחק בתאריך ${d}`
      : 'שימו לב: הילד עתיד להימחק';
  }

  return null;
}

}

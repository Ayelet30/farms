

import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';

import { SeriesRequestsService } from '../../services/series-requests.service';
import { getCurrentUserData } from '../../services/supabaseClient.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { getAuth } from 'firebase/auth';
import { MatIconModule } from '@angular/material/icon';

// חשוב: זה הטיפוס שאת מעבירה מהדף הראשי
import type { UiRequest } from '../../Types/detailes.model';
import { MatButtonModule } from '@angular/material/button';
type RejectArgs = { source: 'user' | 'system'; reason?: string };

const SERIES_DENY_MESSAGES: Record<string, string> = {
  anchor_start_date_in_past: 'אי אפשר לאשר סדרה: תאריך תחילת הסדרה כבר עבר.',
  anchor_capacity_reached: 'אי אפשר לאשר סדרה: כבר קיימים שיעורים בסלוט הזה (הקיבולת מלאה).',
  anchor_falls_on_farm_day_off: 'אי אפשר לאשר סדרה: תאריך תחילת הסדרה נופל על חופש חווה.',
  anchor_instructor_unavailable: 'אי אפשר לאשר סדרה: המדריך לא זמין בתאריך תחילת הסדרה.',
  time_conflict_capacity_reached: 'אי אפשר לאשר סדרה: יש קונפליקט/קיבולת מלאה באחד המפגשים.',
};
@Component({
  selector: 'app-secretarial-series-requests',
  standalone: true,
  imports: [CommonModule, FormsModule , MatDialogModule , MatSnackBarModule, MatTooltipModule , MatButtonModule , MatIconModule],
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
  req = () => this.request;
@Input() bulkMode?: boolean;
requestedEndTime = signal<string | null>(null);

// המשתתפים עם טווח חפיפה
existingParticipants = signal<any[]>([]); // כבר יש לך
participantsCapacity = signal<{ current: number; max: number } | null>(null); // כבר יש לך

ridingTypeName = signal<string>('טוען...');
lessonTypeMode = signal<string | null>(null);
childFullName = signal<string>('טוען...');
childGovId = signal<string | null>(null);
private tenantSvc = inject(SupabaseTenantService);

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

// void this.loadLessonTypeFromAvailability();
this.existingParticipants.set([]);
this.participantsCapacity.set(null);

// void this.loadExistingParticipants();
void this.loadLessonTypeFromAvailability().then(() => this.loadExistingParticipants());

void this.loadChildStatus();
this.childFullName.set('טוען...');
this.childGovId.set(null);
void this.loadChildName();

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
// ===== Child status (from children table) =====
childStatus = signal<string | null>(null);
childDeletionRequestedAt = signal<string | null>(null);
childScheduledDeletionAt = signal<string | null>(null);

canApprove = signal<boolean>(true); // יתעדכן לפי סטטוס
ridingTypeId = signal<string | null>(null);

async approve() {
  return this.approveSelected();
}

async reject(args?: RejectArgs) {
  if (args?.reason != null) this.note = args.reason; // לוקח מה-Bulk
  return this.rejectSelected();
}

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
  const reqId = this.request?.id; // ✅ guard token
  const childId = this.request?.childId;

  const safeSet = (st: string | null, delReqAt: string | null, schedDelAt: string | null, canApprove: boolean) => {
    if (this.request?.id !== reqId) return;
    this.childStatus.set(st);
    this.childDeletionRequestedAt.set(delReqAt);
    this.childScheduledDeletionAt.set(schedDelAt);
    this.canApprove.set(canApprove);
  };

  if (!reqId || !childId) {
    safeSet(null, null, null, true);
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

    if (this.request?.id !== reqId) return;

    const st = (data as any)?.status ?? null;
    const delReqAt = (data as any)?.deletion_requested_at ?? null;
    const schedDelAt = (data as any)?.scheduled_deletion_at ?? null;

    safeSet(st, delReqAt, schedDelAt, st !== 'Deleted');
  } catch (e) {
    console.error('loadChildStatus failed', e);
    // במקרה תקלה – ניזהר ולא נאפשר אישור עד שהכל ברור
    safeSet('לא ידוע', null, null, false);
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
  const reqId = this.request?.id; // ✅ guard token
  const id = this.p?.payment_plan_id;

  const safeSet = (value: string) => {
    if (this.request?.id !== reqId) return;
    this.paymentPlanName.set(value);
  };

  if (!reqId || !id) {
    safeSet('—');
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

    if (this.request?.id !== reqId) return;

    safeSet(data?.name ?? 'לא נמצא');
  } catch (e) {
    console.error('loadPaymentPlanName failed', e);
    safeSet('שגיאה בטעינה');
  }
}

static async isValidRequset(row: UiRequest): Promise<{ ok: boolean; reason?: string }> {
  const p: any = row?.payload ?? {};
  const start = row?.fromDate ?? p.series_start_date ?? p.start_date ?? null;
  if (!start) return { ok: true };

  const dt = SecretarialSeriesRequestsComponent.combineDateTime(start, '00:00');
  if (dt.getTime() < Date.now()) {
    return { ok: false, reason: 'עבר מועד תחילת הסדרה' };
  }
  return { ok: true };
}

async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
  return await SecretarialSeriesRequestsComponent.isValidRequset(this.request);
}

async approveSelected() {
  // ✅ מניעת קריאה כפולה (לחיצה כפולה / submit)
  if (this.loading()) return;
  this.loading.set(true);

  this.clearMessages();
  if (!this.request) {
    this.loading.set(false);
    return;
  }

  // ✅ תמיד לטעון סטטוס לפני החלטה (לא להסתמך על null)
  await this.loadChildStatus();

  // ✅ חסימה קשיחה אם הילד Deleted
  if (this.childStatus() === 'Deleted') {
    const msg =
      this.childStatusBannerText ??
      'ילד זה נמחק ולכן לא ניתן לאשר לו את הזמנת הסדרה';

    this.errorMsg.set(msg);
    this.snack.open(msg, 'סגור', {
      duration: 3500,
      panelClass: ['snack-reject'],
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });

    this.loading.set(false);
    return;
  }

  // ✅ כל שאר הסטטוסים שלא מאפשרים
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

    this.loading.set(false);
    return;
  }


  try {

    const uid = await this.resolveDeciderUid();
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');

    await ensureTenantContextReady();
    const db = dbTenant();

    const p: any = this.request.payload ?? {};
const instructorIdNumber = this.request.instructorId; // מה-row בטבלה
if (!instructorIdNumber) throw new Error('חסר instructor_id_number בבקשה');

const instructorUid = await this.getInstructorUidByIdNumber(instructorIdNumber);
if (!instructorUid) throw new Error('למדריך אין uid במערכת');
const isOpenEnded = !!p.is_open_ended;
const ridingTypeId =
  p.riding_type_id ??
  this.ridingTypeId() ??
  null;

const maxParticipants =
  await this.getMaxParticipantsForRidingType(ridingTypeId);
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

      p_riding_type_id: ridingTypeId ?? null,
      p_origin: "secretary",
    };
    
console.log('RIDING TYPE DEBUG', {
  fromPayload: p.riding_type_id,
  fromAvailability: this.ridingTypeId(),
  used: ridingTypeId,
  maxParticipants,
});


    const { data, error } = await db.rpc('create_series_with_validation', params);
    if (error) throw error;

    const first = Array.isArray(data) ? data[0] : data;

    if (!first?.ok) {
  const reason = String(first?.deny_reason ?? '');
  const msg =
    SERIES_DENY_MESSAGES[reason] ??
    `אי אפשר לאשר את הסדרה: ${reason || 'סיבה לא ידועה'}`;

  this.errorMsg.set(msg);
  this.error.emit(msg);
  this.onError?.({ requestId: this.request.id, message: msg, raw: first });

  this.snack.open(msg, 'סגור', {
    duration: 5000,
    panelClass: ['snack-reject'],
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
  });

  return;
}

await ensureTenantContextReady();

// ✅ עדכון סטטוס הבקשה רק אם עדיין PENDING
const sec_uid = getAuth().currentUser?.uid;
if (!uid) throw new Error('No logged-in user');

// ✅ עדכון סטטוס הבקשה רק אם עדיין PENDING
const { data: upd, error: updErr } = await dbTenant()
  .from('secretarial_requests')
  .update({
    status: 'APPROVED',
    decided_by_uid: sec_uid,
    decision_note: this.note || null,
    decided_at: new Date().toISOString(),
  })
  .eq('id', this.request.id)
  .eq('status', 'PENDING')
  .select('id,status')
  .maybeSingle();

if (updErr) throw updErr;

if (!upd) {
  throw new Error('הבקשה כבר לא במצב ממתין (ייתכן שכבר עודכנה).');
}

    // ✅ אם הצליח – פה יש לך lesson_id / approval_id וכו’
    // אבל שימי לב: create_series_with_validation לא מעדכנת סטטוס של secretarial_requests!
    // אם את רוצה שהבקשה תיעלם – חייבים update לטבלה או RPC נוסף.
    // כרגע רק נעדכן UI
    const payload = { requestId: this.request.id, newStatus: 'APPROVED' as const };
     if (!this.bulkMode) {
  this.snack.open('הבקשה אושרה בהצלחה', 'סגור', {
    duration: 2500,
    panelClass: ['snack-success'],
    direction: 'rtl',
  });
}

    this.approved.emit(payload);
    this.onApproved?.(payload);
    const lessonId = first?.lesson_id ?? null;

// שליחת מייל לא תחסום את האישור אם נכשלת
try {
  await this.sendSeriesApprovedEmail(this.request.id, lessonId);
} catch (e) {
  console.warn('sendSeriesApprovedEmail failed', e);
  if (!this.bulkMode) {
  this.snack.open('הסדרה אושרה, אך שליחת המייל נכשלה', 'סגור', {
    duration: 3500,
    panelClass: ['snack-reject'],
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
  });
}
}


  } catch (e: any) {
    const msg = e?.message ?? 'שגיאה באישור';
  

    this.error.emit(msg);
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
this.errorMsg.set(msg);
  } finally {
    this.loading.set(false);
  }
}

canDecide(): boolean {
  return this.request?.status === 'PENDING';
}


async rejectSelected() {
  this.clearMessages();

  if (!this.request?.id) return;
  
  try {
    this.loading.set(true);

    const uid = await this.resolveDeciderUid();
    if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');


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
    if (!this.bulkMode) {
  this.snack.open('הבקשה נדחתה בהצלחה', 'סגור', {
    duration: 2500,
    panelClass: ['snack-reject'],
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
  });
}


    this.rejected.emit(payload);
    this.onRejected?.(payload);
try {
  await this.sendSeriesRejectedEmail(this.request.id);
} catch (e) {
  console.warn('sendSeriesRejectedEmail failed', e);
  if (!this.bulkMode) {
  this.snack.open('הבקשה נדחתה, אך שליחת המייל נכשלה', 'סגור', {
    duration: 3500,
    panelClass: ['snack-reject'],
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
  });
}
}

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

private async loadInstructorName() {
  const reqId = this.request?.id; // ✅ guard token
  const idNumber = this.request?.instructorId; // אצלך זה id_number

  const safeSet = (value: string) => {
    if (this.request?.id !== reqId) return;
    this.instructorName.set(value);
  };

  if (!reqId || !idNumber) {
    safeSet('—');
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

    if (this.request?.id !== reqId) return;

    const full = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();
    safeSet(full || data?.id_number || 'לא נמצא');
  } catch (e) {
    console.error('loadInstructorName failed', e);
    safeSet('שגיאה בטעינה');
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
private static combineDateTime(dateStr: string, timeStr?: string | null): Date {
  const d = dateStr?.slice(0, 10);
  const t = (timeStr ?? '00:00').slice(0, 5);
  return new Date(`${d}T${t}:00`);
}
private async loadLessonTypeFromAvailability() {
  const reqId = this.request?.id; // ✅ guard token
  const instructorId = this.request?.instructorId; // id_number
  const dateStr = this.startDate;                  // YYYY-MM-DD
  const t = this.requestedStartTime;               // "15:30"

  const safeReset = () => {
    if (this.request?.id !== reqId) return;
    this.ridingTypeName.set('—');
    this.lessonTypeMode.set(null);
    this.ridingTypeId.set(null);
    this.requestedEndTime.set(null);
  };

  if (!reqId || !instructorId || !dateStr || dateStr === '—' || !t || t === '—') {
    safeReset();
    return;
  }

  const d = this.parseDateOnly(dateStr);
  if (!d) {
    safeReset();
    return;
  }

  const dow = d.getDay(); // 0..6 (ראשון=0)

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('instructor_weekly_availability')
      .select(`
        start_time,
        end_time,
        lesson_type_mode,
        riding_types:lesson_ridding_type ( id, name )
      `)
      .eq('instructor_id_number', instructorId)
      .eq('day_of_week', dow)
      .lte('start_time', t)
      .gt('end_time', t) // end_time > t
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (this.request?.id !== reqId) return;

    const endTime = (data as any)?.end_time ?? null;
    this.requestedEndTime.set(endTime);

    const rtId =
      (data as any)?.riding_types?.id ??
      (data as any)?.riding_type_id ??
      null;

    this.ridingTypeId.set(rtId);

    const name = (data as any)?.riding_types?.name ?? null;
    this.ridingTypeName.set(name ?? 'לא נמצא');
    this.lessonTypeMode.set((data as any)?.lesson_type_mode ?? null);
  } catch (e) {
    console.error('loadLessonTypeFromAvailability failed', e);
    if (this.request?.id !== reqId) return;
    this.ridingTypeName.set('שגיאה בטעינה');
    this.lessonTypeMode.set(null);
    this.ridingTypeId.set(null);
    this.requestedEndTime.set(null);
  }
}

private async loadExistingParticipants() {
  const reqId = this.request?.id; // ✅ guard token
  const instructorId = this.request?.instructorId;          // id_number אצלך
  const dayName = this.startWeekdayName;                    // "ראשון" וכו'
  const startDate = this.request?.fromDate;                 // YYYY-MM-DD
  const startTime = this.requestedStartTime;                // "15:30"
  const endTime = this.requestedEndTime();                  // "16:15:00" / "16:15"
  const requestChildId = this.request?.childId ?? null;

  const ridingTypeId =
    this.p?.riding_type_id ??
    this.ridingTypeId() ??
    null;

  const safeClear = () => {
    if (this.request?.id !== reqId) return;
    this.existingParticipants.set([]);
    this.participantsCapacity.set(null);
  };

  if (!reqId || !instructorId || !dayName || !startDate || startDate === '—' || !startTime || startTime === '—') {
    safeClear();
    return;
  }

  // אם אין end_time עדיין (עוד לא נטען availability) – לא נציג חפיפות כדי לא להטעות
  if (!endTime) {
    safeClear();
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    // normalize שעה לפורמט time ב-Postgres ("HH:MM:SS")
    const normTime = (t: string | null) => {
      const s = (t ?? '').trim();
      if (!s) return null;
      return s.length === 5 ? `${s}:00` : s;
    };

    const params = {
      p_instructor_id: instructorId,
      p_day_of_week: dayName,
      p_start_time: normTime(startTime),
      p_end_time: normTime(endTime),
      p_riding_type_id: ridingTypeId,
      p_series_start_date: startDate,

      p_is_open_ended: !!this.p?.is_open_ended,
      p_repeat_weeks: this.p?.is_open_ended ? null : Number(this.p?.repeat_weeks ?? 0),
      p_series_search_horizon_days: Number(this.p?.series_search_horizon_days ?? 90),

      p_skipped_farm_dates: (this.p?.skipped_farm_dates ?? []) as string[],
      p_skipped_instructor_dates: (this.p?.skipped_instructor_dates ?? []) as string[],

      // אופציונלי אם הוספת בפונקציה DB: להחריג את הילד המבקש
      // p_request_child_id: requestChildId,
    };

    const { data, error } = await db.rpc('get_series_overlap_participants', params);
    if (error) throw error;

    // ✅ אם הבקשה התחלפה בזמן ההמתנה — לא נוגעים ב-state
    if (this.request?.id !== reqId) return;

    const rows = Array.isArray(data) ? data : [];
    this.existingParticipants.set(rows);

    // קיבולת + current
    if (rows.length) {
      this.participantsCapacity.set({
        current: rows.length,
        max: rows[0].max_participants ?? 1,
      });
    } else {
      this.participantsCapacity.set(null);
    }
  } catch (e) {
    console.error('loadExistingParticipants (overlap) failed', e);
    safeClear();
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
    return d ? `שימו לב: הילד עתיד להימחק בתאריך ${d}` : 'שימו לב: הילד עתיד להימחק';
  }

  // אופציונלי: גם לממתין לאישור מחיקה
  if (st === 'Pending Deletion Approval') {
    return 'שימו לב: הילד ממתין לאישור מחיקה';
  }

  return null;
}
private async loadChildName() {
  const reqId = this.request?.id; // ✅ guard token
  const childId = this.request?.childId; // child_uuid

  const safeSet = (fullName: string, govId: string | null) => {
    if (this.request?.id !== reqId) return;
    this.childFullName.set(fullName);
    this.childGovId.set(govId);
  };

  if (!reqId || !childId) {
    safeSet('—', null);
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('children')
      .select('first_name, last_name, gov_id')
      .eq('child_uuid', childId)
      .maybeSingle();

    if (error) throw error;

    if (this.request?.id !== reqId) return;

    const fullName = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();
    safeSet(fullName || 'לא נמצא', data?.gov_id ?? null);
  } catch (e) {
    console.error('loadChildName failed', e);
    safeSet('שגיאה בטעינה', null);
  }
}

private async sendSeriesApprovedEmail(requestId: string, lessonId: string | null) {
  await this.tenantSvc.ensureTenantContextReady();
  const tenant = this.tenantSvc.requireTenant();

  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifySeriesApproved';

  const user = getAuth().currentUser;
  if (!user) throw new Error('המשתמש לא מחובר');
  const token = await user.getIdToken();

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      tenantSchema: tenant.schema,
      tenantId: tenant.id,
      requestId,
      lessonId,
    }),
  });

  const raw = await resp.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}

  if (!resp.ok || !json?.ok) {
    throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
  }
}
private async sendSeriesRejectedEmail(requestId: string) {
  await this.tenantSvc.ensureTenantContextReady();
  const tenant = this.tenantSvc.requireTenant();

  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifySeriesRejected';

  const user = getAuth().currentUser;
  if (!user) throw new Error('המשתמש לא מחובר');
  const token = await user.getIdToken();

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      tenantSchema: tenant.schema,
      tenantId: tenant.id,
      requestId,
    }),
  });

  const raw = await resp.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}

  if (!resp.ok || !json?.ok) {
    throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
  }
}


}

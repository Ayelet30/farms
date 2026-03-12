import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';

import { getAuth } from 'firebase/auth';

import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';
import {
  getCurrentUserData,
  requireTenant,
} from '../../services/supabaseClient.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { RequestValidationService } from '../../services/request-validation.service';

import type { UiRequest } from '../../Types/detailes.model';

type RejectArgs = {
  source: 'user' | 'system';
  reason?: string;
};

const SINGLE_LESSON_DENY_MESSAGES: Record<string, string> = {
  lesson_date_in_past: 'אי אפשר לאשר שיעור בודד: תאריך השיעור כבר עבר.',
  capacity_reached: 'אי אפשר לאשר שיעור בודד: הקיבולת מלאה.',
  falls_on_farm_day_off: 'אי אפשר לאשר שיעור בודד: התאריך נופל על חופש חווה.',
  instructor_unavailable: 'אי אפשר לאשר שיעור בודד: המדריך לא זמין בתאריך זה.',
  time_conflict: 'אי אפשר לאשר שיעור בודד: קיים קונפליקט זמן.',
};

@Component({
  selector: 'app-request-single-lesson-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './request-single-lesson-details.component.html',
  styleUrls: ['./request-single-lesson-details.component.scss'],
})
export class RequestSingleLessonDetailsComponent {
  private snack = inject(MatSnackBar);
  private validator = inject(RequestValidationService);
  private tenantSvc = inject(SupabaseTenantService);

  private _request!: UiRequest;

  req = () => this.request;

  @Input() bulkMode?: boolean;

  @Input({ required: true })
  set request(v: UiRequest) {
    this._request = v;

    this.note = '';
    this.clearMessages();
    this.loading.set(false);
    this.busy.set(false);
    this.action.set(null);

    this.instructorName.set('טוען...');
    this.childFullName.set('טוען...');
    this.childGovId.set(null);
    this.ridingTypeName.set('טוען...');
    this.lessonTypeMode.set(null);
    this.paymentPlanName.set('טוען...');
    this.requestedEndTime.set(null);
    this.existingParticipants.set([]);
    this.participantsCapacity.set(null);

    void this.loadInstructorName();
    void this.loadChildName();
    void this.loadChildStatus();
    void this.loadPaymentPlanName();
    void this.loadLessonTypeFromAvailability().then(() => this.loadExistingParticipants());
  }

  get request(): UiRequest {
    return this._request;
  }

  @Input() decidedByUid?: string | null;

  @Input() onApproved?: (e: {
    requestId: string;
    newStatus: 'APPROVED';
    message?: string;
    meta?: any;
  }) => void;

  @Input() onRejected?: (e: {
    requestId: string;
    newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM';
    message?: string;
    meta?: any;
  }) => void;

  @Input() onError?: (e: any) => void;

  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{
    requestId: string;
    newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM';
  }>();
  @Output() error = new EventEmitter<string>();

  loading = signal(false);
  busy = signal(false);
  action = signal<'approve' | 'reject' | null>(null);

  successMsg = signal<string | null>(null);
  errorMsg = signal<string | null>(null);
  bulkWarning: string | null = null;

  instructorName = signal<string>('טוען...');
  childFullName = signal<string>('טוען...');
  childGovId = signal<string | null>(null);
  ridingTypeName = signal<string>('טוען...');
  lessonTypeMode = signal<string | null>(null);
  paymentPlanName = signal<string>('טוען...');
  requestedEndTime = signal<string | null>(null);

  existingParticipants = signal<any[]>([]);
  participantsCapacity = signal<{ current: number; max: number } | null>(null);

  childStatus = signal<string | null>(null);
  childDeletionRequestedAt = signal<string | null>(null);
  childScheduledDeletionAt = signal<string | null>(null);
  canApprove = signal<boolean>(true);

  ridingTypeId = signal<string | null>(null);

  note = '';

  busyText = computed(() => {
    switch (this.action()) {
      case 'approve':
        return 'הבקשה בתהליך אישור…';
      case 'reject':
        return 'הבקשה בתהליך דחייה…';
      default:
        return 'מעבד…';
    }
  });

  get p(): any {
    return this.request?.payload ?? {};
  }

  get lessonDate(): string {
    return this.request?.fromDate ?? this.p?.lesson_date ?? this.p?.requested_date ?? '—';
  }

  get requestedStartTime(): string {
    return this.p?.requested_start_time ?? this.p?.start_time ?? this.p?.time ?? '—';
  }

  get requestedEndTimeFromRequest(): string {
    return this.p?.requested_end_time ?? this.p?.end_time ?? this.requestedEndTime() ?? '—';
  }

  get referralUrl(): string {
    return this.p?.referral_url ?? this.p?.payment_docs_url ?? '';
  }

  get paymentSource(): string {
    return this.p?.payment_source ?? this.p?.paymentSource ?? '—';
  }

  get healthFund(): string {
    return this.p?.health_fund ?? '—';
  }

  get approvalNumber(): string {
    return this.p?.approval_number ?? '—';
  }

  get totalLessons(): string | number {
    return this.p?.total_lessons ?? '—';
  }

  get singleLessonTypeLabel(): string {
    return this.p?.lesson_type ?? 'שיעור בודד';
  }

  async ngOnInit() {}

  async approve() {
    return this.approveSelected();
  }

  async reject(args?: RejectArgs) {
    if (args?.reason != null) this.note = args.reason;
    return this.rejectSelected();
  }

  canDecide(): boolean {
    return this.request?.status === 'PENDING';
  }

  private clearMessages() {
    this.successMsg.set(null);
    this.errorMsg.set(null);
    this.bulkWarning = null;
  }

  private statusToHebrew(status: string | null): string {
    switch (status) {
      case 'Active':
        return 'פעיל';
      case 'Pending Addition Approval':
        return 'ממתין לאישור הוספה';
      case 'Pending Deletion Approval':
        return 'ממתין לאישור מחיקה';
      case 'Deletion Scheduled':
        return 'מחיקה מתוכננת';
      case 'Deleted':
        return 'נמחק';
      default:
        return status ? status : 'לא ידוע';
    }
  }

  private formatDateOnly(iso: string | null): string | null {
    if (!iso) return null;
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
      const when =
        this.formatDateOnly(this.childScheduledDeletionAt()) ??
        this.formatDateOnly(this.childDeletionRequestedAt());

      return `ילד זה אינו פעיל (סטטוס: ${stHe})${when ? ` • נמחק בתאריך: ${when}` : ''}`;
    }

    return `ילד זה אינו פעיל (סטטוס: ${stHe})`;
  }

  get approveTooltip(): string | null {
    const st = this.childStatus();

    if (st === 'Deleted') {
      return 'ילד זה נמחק ולכן לא ניתן לאשר לו את הזמנת השיעור';
    }

    if (st === 'Deletion Scheduled') {
      const d = this.formatDateOnly(this.childScheduledDeletionAt());
      return d
        ? `שימו לב: הילד עתיד להימחק בתאריך ${d}`
        : 'שימו לב: הילד עתיד להימחק';
    }

    if (st === 'Pending Deletion Approval') {
      return 'שימו לב: הילד ממתין לאישור מחיקה';
    }

    return null;
  }

  get lessonWeekdayName(): string {
    const d = this.parseDateOnly(this.lessonDate);
    if (!d) return '—';
    const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    return names[d.getDay()];
  }

  private parseDateOnly(value: string): Date | null {
    if (!value || value === '—') return null;

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const da = Number(m[3]);
      const dt = new Date(y, mo, da);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }

    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  private static combineDateTime(dateStr: string, timeStr?: string | null): Date {
    const d = dateStr?.slice(0, 10);
    const t = (timeStr ?? '00:00').slice(0, 5);
    return new Date(`${d}T${t}:00`);
  }

  static async isValidRequset(row: UiRequest): Promise<{ ok: boolean; reason?: string }> {
    const p: any = row?.payload ?? {};
    const date = row?.fromDate ?? p.lesson_date ?? p.requested_date ?? null;
    const time = p.requested_start_time ?? p.start_time ?? p.time ?? '00:00';

    if (!date) return { ok: true };

    const dt = RequestSingleLessonDetailsComponent.combineDateTime(date, time);
    if (dt.getTime() < Date.now()) {
      return { ok: false, reason: 'עבר מועד השיעור המבוקש' };
    }

    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestSingleLessonDetailsComponent.isValidRequset(this.request);
  }

  private async resolveDeciderUid(): Promise<string | null> {
    if (this.decidedByUid) return this.decidedByUid;
    const uid = (await getCurrentUserData())?.uid ?? null;
    return uid;
  }

  private async rejectBySystem(reason: string): Promise<void> {
    if (!this.request?.id) return;

    const tenantSchema = requireTenant().schema;
    const decidedByUid = getAuth().currentUser?.uid ?? null;

    const idToken = await getAuth().currentUser?.getIdToken();
    if (!idToken) throw new Error('No Firebase token');

    const resp = await fetch(
      'https://us-central1-bereshit-ac5d8.cloudfunctions.net/autoRejectRequestAndNotify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tenantSchema,
          requestId: this.request.id,
          reason,
          decidedByUid,
        }),
      }
    );

    const text = await resp.text();
    let json: any = null;

    try {
      json = JSON.parse(text);
    } catch {}

    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || `autoRejectRequestAndNotify failed: ${resp.status}`);
    }
  }

  private async loadChildStatus() {
    const reqId = this.request?.id;
    const childId = this.request?.childId;

    const safeSet = (
      st: string | null,
      delReqAt: string | null,
      schedDelAt: string | null,
      canApprove: boolean
    ) => {
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
      safeSet('לא ידוע', null, null, false);
    }
  }

  private async loadChildName() {
    const reqId = this.request?.id;
    const childId = this.request?.childId;

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

  private async loadInstructorName() {
    const reqId = this.request?.id;
    const idNumber = this.request?.instructorId;

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

  private async loadPaymentPlanName() {
    const reqId = this.request?.id;
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

  private async loadLessonTypeFromAvailability() {
    const reqId = this.request?.id;
    const instructorId = this.request?.instructorId;
    const dateStr = this.lessonDate;
    const t = this.requestedStartTime;

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

    const dow = d.getDay();

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const { data, error } = await db
        .from('instructor_weekly_availability')
        .select(`
          start_time,
          end_time,
          lesson_type_mode,
          riding_types:lesson_ridding_type (
            id,
            name
          )
        `)
        .eq('instructor_id_number', instructorId)
        .eq('day_of_week', dow)
        .lte('start_time', t)
        .gt('end_time', t)
        .order('start_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (this.request?.id !== reqId) return;

      const endTime = (data as any)?.end_time ?? null;
      this.requestedEndTime.set(endTime);

      const rtId = (data as any)?.riding_types?.id ?? (data as any)?.riding_type_id ?? null;
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
    const reqId = this.request?.id;
    const instructorId = this.request?.instructorId;
    const lessonDate = this.lessonDate;
    const startTime = this.requestedStartTime;
    const endTime = this.requestedEndTimeFromRequest;
    const ridingTypeId = this.p?.riding_type_id ?? this.ridingTypeId() ?? null;

    const safeClear = () => {
      if (this.request?.id !== reqId) return;
      this.existingParticipants.set([]);
      this.participantsCapacity.set(null);
    };

    if (
      !reqId ||
      !instructorId ||
      !lessonDate ||
      lessonDate === '—' ||
      !startTime ||
      startTime === '—' ||
      !endTime ||
      endTime === '—'
    ) {
      safeClear();
      return;
    }

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const normTime = (t: string | null) => {
        const s = (t ?? '').trim();
        if (!s) return null;
        return s.length === 5 ? `${s}:00` : s;
      };

      const params = {
        p_instructor_id: instructorId,
        p_lesson_date: lessonDate,
        p_start_time: normTime(startTime),
        p_end_time: normTime(endTime),
        p_riding_type_id: ridingTypeId,
      };

      const { data, error } = await db.rpc('get_single_lesson_overlap_participants', params);

      if (error) throw error;
      if (this.request?.id !== reqId) return;

      const rows = Array.isArray(data) ? data : [];
      this.existingParticipants.set(rows);

      if (rows.length) {
        this.participantsCapacity.set({
          current: rows.length,
          max: rows[0].max_participants ?? 1,
        });
      } else {
        this.participantsCapacity.set(null);
      }
    } catch (e) {
      console.error('loadExistingParticipants failed', e);
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

  private async getMaxParticipantsForRidingType(
    ridingTypeId: string | null | undefined
  ): Promise<number> {
    if (!ridingTypeId) return 1;

    await ensureTenantContextReady();
    const db = dbTenant();

    const { data, error } = await db
      .from('riding_types')
      .select('max_participants, is_active')
      .eq('id', ridingTypeId)
      .maybeSingle();

    if (error) throw error;

    const max = data?.is_active === false ? null : data?.max_participants;
    const n = Number(max);

    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.floor(n);
  }

  async approveSelected() {
    if (this.loading()) return;

    this.action.set('approve');
    this.busy.set(true);
    this.loading.set(true);
    this.clearMessages();

    if (!this.request) {
      this.loading.set(false);
      return;
    }

    await this.loadChildStatus();

    if (this.childStatus() === 'Deleted') {
      const msg =
        this.childStatusBannerText ?? 'ילד זה נמחק ולכן לא ניתן לאשר לו את הזמנת השיעור';
      this.errorMsg.set(msg);

      this.snack.open(msg, 'סגור', {
        duration: 3500,
        panelClass: ['snack-reject'],
        direction: 'rtl',
        horizontalPosition: 'center',
        verticalPosition: 'top',
      });

      this.loading.set(false);
      this.busy.set(false);
      this.action.set(null);
      return;
    }

    if (!this.canApprove()) {
      const msg = this.childStatusBannerText ?? 'לא ניתן לאשר שיעור לילד שאינו פעיל';
      this.errorMsg.set(msg);

      this.snack.open('לא ניתן לאשר: הילד אינו פעיל', 'סגור', {
        duration: 2500,
        panelClass: ['snack-reject'],
        direction: 'rtl',
        horizontalPosition: 'center',
        verticalPosition: 'top',
      });

      this.loading.set(false);
      this.busy.set(false);
      this.action.set(null);
      return;
    }

    const v = await this.validator.validate(this.request, 'approve');
    if (!v.ok) {
      await this.rejectBySystem(v.reason);
      this.loading.set(false);
      this.busy.set(false);
      this.action.set(null);
      return;
    }

    try {
      const uid = await this.resolveDeciderUid();
      if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');

      await ensureTenantContextReady();
      const db = dbTenant();

      const p: any = this.request.payload ?? {};
      const instructorIdNumber = this.request.instructorId;
      if (!instructorIdNumber) throw new Error('חסר instructor_id_number בבקשה');

      const instructorUid = await this.getInstructorUidByIdNumber(instructorIdNumber);
      if (!instructorUid) throw new Error('למדריך אין uid במערכת');

      const ridingTypeId = p.riding_type_id ?? this.ridingTypeId() ?? null;
      const maxParticipants = await this.getMaxParticipantsForRidingType(ridingTypeId);

      const normalizeTime = (t: string) => {
        const s = (t ?? '').trim();
        if (!s) return null;
        return s.length === 5 ? `${s}:00` : s;
      };

      const params = {
        p_child_id: this.request.childId ?? null,
        p_instructor_id_number: instructorIdNumber,
        p_instructor_uid: instructorUid,
        p_lesson_date: this.lessonDate ?? null,
        p_start_time: normalizeTime(this.requestedStartTime),
        p_end_time: normalizeTime(this.requestedEndTimeFromRequest),
        p_max_participants: maxParticipants,
        p_payment_source: p.payment_source ?? null,
        p_existing_approval_id: null,
        p_payment_plan_id: p.payment_plan_id ?? null,
        p_health_fund: p.health_fund ?? null,
        p_approval_number: p.approval_number ?? null,
        p_total_lessons: p.total_lessons ?? null,
        p_referral_url: p.referral_url ?? null,
        p_payment_docs_url: p.referral_url ?? p.payment_docs_url ?? null,
        p_riding_type_id: ridingTypeId ?? null,
        p_origin: 'secretary',
      };
console.log('single lesson params', {
  lessonDate: this.lessonDate,
  start: normalizeTime(this.requestedStartTime),
  end: normalizeTime(this.requestedEndTimeFromRequest),
  instructorIdNumber,
  ridingTypeId,
  maxParticipants,
  payload: p,
});
      const { data, error } = await db.rpc('create_single_lesson_with_validation', params);
      if (error) throw error;

      const first = Array.isArray(data) ? data[0] : data;

      if (!first?.ok) {
        const reasonKey = String(first?.deny_reason ?? '');
        const msg =
          SINGLE_LESSON_DENY_MESSAGES[reasonKey] ??
          `אי אפשר לאשר את השיעור: ${reasonKey || 'סיבה לא ידועה'}`;

        await this.rejectBySystem(msg);
        this.loading.set(false);
        this.busy.set(false);
        this.action.set(null);
        return;
      }

      const secUid = getAuth().currentUser?.uid;
      if (!secUid) throw new Error('No logged-in user');

      const { data: upd, error: updErr } = await dbTenant()
        .from('secretarial_requests')
        .update({
          status: 'APPROVED',
          decided_by_uid: secUid,
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

      const payload = {
        requestId: this.request.id,
        newStatus: 'APPROVED' as const,
      };

      this.approved.emit(payload);
      this.onApproved?.(payload);

      const lessonId = first?.lesson_id ?? null;

      try {
        const mailRes = await this.sendSingleLessonApprovedEmail(this.request.id, lessonId);
        const warn = (mailRes?.warning ?? '').toString().trim();

        if (warn) {
          this.bulkWarning = warn;
          if (!this.bulkMode) {
            this.snack.open(warn, 'סגור', {
              duration: 3500,
              panelClass: ['snack-warn'],
              direction: 'rtl',
              horizontalPosition: 'center',
              verticalPosition: 'top',
            });
          }
        }
      } catch (e) {
        const warn = 'השיעור אושר, אך שליחת המייל נכשלה';
        this.bulkWarning = warn;
        console.warn('sendSingleLessonApprovedEmail failed', e);

        if (!this.bulkMode) {
          this.snack.open(warn, 'סגור', {
            duration: 3500,
            panelClass: ['snack-warn'],
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
      this.action.set(null);
      this.busy.set(false);
      this.loading.set(false);
    }
  }

  async rejectSelected() {
    if (this.loading()) return;

    this.action.set('reject');
    this.busy.set(true);
    this.loading.set(true);
    this.clearMessages();

    if (!this.request?.id) return;

    const v = await this.validator.validate(this.request, 'reject');
    if (!v.ok) {
      await this.rejectBySystem(v.reason);
      this.loading.set(false);
      this.busy.set(false);
      this.action.set(null);
      return;
    }

    try {
      const uid = await this.resolveDeciderUid();
      if (!uid) throw new Error('לא נמצא משתמש מאשר (uid)');

      await ensureTenantContextReady();
      const db = dbTenant();

      const note = this.note.trim();

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

      const payload = {
        requestId: this.request.id,
        newStatus: 'REJECTED' as const,
      };

      this.rejected.emit(payload);
      this.onRejected?.(payload);

      try {
        const mailRes = await this.sendSingleLessonRejectedEmail(this.request.id);
        const warn = (mailRes?.warning ?? '').toString().trim();

        if (warn) {
          this.bulkWarning = warn;
          if (!this.bulkMode) {
            this.snack.open(warn, 'סגור', {
              duration: 3500,
              panelClass: ['snack-warn'],
              direction: 'rtl',
              horizontalPosition: 'center',
              verticalPosition: 'top',
            });
          }
        }
      } catch (e) {
        const warn = 'הבקשה נדחתה, אך שליחת המייל נכשלה';
        this.bulkWarning = warn;
        console.warn('sendSingleLessonRejectedEmail failed', e);

        if (!this.bulkMode) {
          this.snack.open(warn, 'סגור', {
            duration: 3500,
            panelClass: ['snack-warn'],
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
      this.action.set(null);
      this.busy.set(false);
    }
  }

  private async sendSingleLessonApprovedEmail(
    requestId: string,
    lessonId: string | null
  ): Promise<any> {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifySingleLessonApproved';
    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');

    const token = await user.getIdToken();

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

    try {
      json = JSON.parse(raw);
    } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }

    return json;
  }

  private async sendSingleLessonRejectedEmail(requestId: string): Promise<any> {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();

  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifySingleLessonRejected';
    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');

    const token = await user.getIdToken();

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantSchema: tenant.schema,
        tenantId: tenant.id,
        requestId,
      }),
    });

    const raw = await resp.text();
    let json: any = null;

    try {
      json = JSON.parse(raw);
    } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }

    return json;
  }
}
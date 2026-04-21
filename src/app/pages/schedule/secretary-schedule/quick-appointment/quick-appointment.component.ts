import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { dbTenant, supabase } from '../../../../services/supabaseClient.service';

type BookingMode = 'series' | 'single' | 'makeup' | 'occupancy' | 'special';
type SeriesMode = 'fixed' | 'open';

type ChildRow = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  birth_date?: string | null;
  gender?: string | null;
  scheduled_deletion_at?: string | null;
  status?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
};

type InstructorRow = {
  id_number: string;
  uid: string | null;
  first_name: string | null;
  last_name: string | null;
  gender?: string | null;
  about?: string | null;
  certificate?: string | null;
  min_age_years_male?: number | null;
  max_age_years_male?: number | null;
  min_age_years_female?: number | null;
  max_age_years_female?: number | null;
  taught_child_genders?: string[] | null;
};

type PaymentPlan = {
  id: string;
  name: string;
  lesson_price: number | null;
  subsidy_amount: number | null;
  customer_amount: number | null;
  require_docs_at_booking: boolean;
  required_docs: string[] | null;
  funding_source_id: string | null;
};

type ExistingParticipant = {
  child_uuid: string;
  first_name: string | null;
  last_name: string | null;
  gender?: string | null;
  birth_date?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
  together_from?: string | null;
  together_to?: string | null;
  overlap_count?: number | null;
};

type QuickSlotInfo = {
  ok: boolean;
  reason: string | null;
  riding_type_id: string | null;
  riding_type_name: string | null;
  lesson_type_mode: string | null;
  min_participants: number | null;
  max_participants: number;
  current_participants: number;
  remaining_capacity: number;
  existing_participants: ExistingParticipant[];
};

type RidingTypeRow = {
  id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  min_participants?: number | null;
  max_participants?: number | null;
};

type MakeupCandidate = {
  lesson_occ_exception_id: string;
  lesson_id: string;
  occur_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string | null;
  status: string;
  instructor_name: string;
};

type OccupancyCandidate = {
  lesson_occ_exception_id: string;
  lesson_id: string;
  occur_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string | null;
  instructor_name?: string | null;
  status: string;
};

type CreateSeriesWithValidationResult = {
  ok: boolean;
  deny_reason: string | null;
  lesson_id: string | null;
  approval_id: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  skipped_farm_days_off: string[] | null;
  skipped_instructor_unavailability: string[] | null;
};

@Component({
  selector: 'app-quick-appointment',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule],
  templateUrl: './quick-appointment.component.html',
  styleUrls: ['./quick-appointment.component.scss'],
})
export class QuickAppointmentComponent implements OnInit {
  @Input({ required: true }) date = '';
  @Input({ required: true }) startTime = '';
  @Input({ required: true }) endTime = '';
  @Input({ required: true }) instructorId = '';
  @Input() instructorName = '';

  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  private snack = inject(MatSnackBar);

  referralFile: File | null = null;
referralUrl: string | null = null;
referralUploadError: string | null = null;

  loading = false;
  loadingSlotInfo = false;
  slotInfoError: string | null = null;

  children: ChildRow[] = [];
  instructors: InstructorRow[] = [];
  paymentPlans: PaymentPlan[] = [];
  slotInfo: QuickSlotInfo | null = null;

  activeRidingTypes: RidingTypeRow[] = [];
  inactiveRidingTypes: RidingTypeRow[] = [];

  bookingMode: BookingMode = 'single';
  seriesMode: SeriesMode = 'fixed';
  repeatWeeks: number | null = 8;

  selectedChildId: string | null = null;
  selectedPaymentPlanId: string | null = null;
  selectedSpecialRidingTypeId: string | null = null;

  makeupCandidates: MakeupCandidate[] = [];
  selectedMakeupCandidate: MakeupCandidate | null = null;
  loadingMakeup = false;
  makeupError: string | null = null;

  occupancyCandidates: OccupancyCandidate[] = [];
  selectedOccupancyCandidate: OccupancyCandidate | null = null;
  loadingOccupancy = false;
  occupancyError: string | null = null;

  get selectedChild(): ChildRow | undefined {
    return this.children.find(c => c.child_uuid === this.selectedChildId);
  }

  get selectedInstructor(): InstructorRow | undefined {
    return this.instructors.find(i => String(i.id_number) === String(this.instructorId));
  }

  get selectedPaymentPlan(): PaymentPlan | null {
    return this.paymentPlans.find(p => p.id === this.selectedPaymentPlanId) ?? null;
  }

  get selectedSpecialRidingType(): RidingTypeRow | undefined {
    return this.inactiveRidingTypes.find(r => r.id === this.selectedSpecialRidingTypeId);
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadChildren(),
      this.loadInstructors(),
      this.loadPaymentPlans(),
      this.loadRidingTypes(),
    ]);

    await this.loadSlotInfo();
  }

  childSearchTerm = '';

get filteredChildren(): ChildRow[] {
  const term = this.childSearchTerm.trim().toLowerCase();

  if (!term) {
    return this.children;
  }

  return this.children.filter(child => {
    const fullName = `${child.first_name ?? ''} ${child.last_name ?? ''}`.trim().toLowerCase();
    return fullName.includes(term);
  });
}

clearChildSelection(): void {
  this.selectedChildId = null;
  this.childSearchTerm = '';
}

  private showError(msg: string): void {
    this.snack.open(msg, 'סגור', { duration: 4500 });
  }

  private showSuccess(msg: string): void {
    this.snack.open(msg, 'סגור', { duration: 2500 });
  }

  calcAge(birthDate?: string | null): string {
    if (!birthDate) return '';
    const d = new Date(birthDate);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
    return years > 0 ? String(years) : '';
  }

  private isChildDeletedSoon(child?: ChildRow): boolean {
    if (!child?.scheduled_deletion_at) return false;
    const d = new Date(child.scheduled_deletion_at);
    return !isNaN(d.getTime()) && d.getTime() <= Date.now();
  }

  private isEligibleForInstructor(
    child?: ChildRow,
    instructor?: InstructorRow
  ): { ok: boolean; reason?: string } {
    if (!child || !instructor) {
      return { ok: false, reason: 'חסרים נתוני ילד או מדריך' };
    }

    const age = child.birth_date ? Number(this.calcAge(child.birth_date)) : null;
    const gender = String(child.gender ?? '').trim();

    if (age != null && !Number.isNaN(age)) {
      if (gender === 'זכר') {
        if (instructor.min_age_years_male != null && age < instructor.min_age_years_male) {
          return { ok: false, reason: 'גיל הילד נמוך מטווח המדריך' };
        }
        if (instructor.max_age_years_male != null && age > instructor.max_age_years_male) {
          return { ok: false, reason: 'גיל הילד גבוה מטווח המדריך' };
        }
      }

      if (gender === 'נקבה') {
        if (instructor.min_age_years_female != null && age < instructor.min_age_years_female) {
          return { ok: false, reason: 'גיל הילדה נמוך מטווח המדריך' };
        }
        if (instructor.max_age_years_female != null && age > instructor.max_age_years_female) {
          return { ok: false, reason: 'גיל הילדה גבוה מטווח המדריך' };
        }
      }
    }

    if (
      Array.isArray(instructor.taught_child_genders) &&
      instructor.taught_child_genders.length &&
      gender
    ) {
      if (!instructor.taught_child_genders.includes(gender as any)) {
        return { ok: false, reason: 'המדריך אינו מתאים למין הילד/ה לפי ההגדרות' };
      }
    }

    return { ok: true };
  }

  async loadChildren(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('children')
      .select(`
        child_uuid,
        first_name,
        last_name,
        birth_date,
        gender,
        scheduled_deletion_at,
        status,
        medical_notes,
        behavior_notes
      `)
      .in('status', ['Active', 'Deletion Scheduled', 'Pending Deletion Approval']);

    if (error) {
      console.error(error);
      this.showError('שגיאה בטעינת ילדים');
      return;
    }

    this.children = (data ?? []) as ChildRow[];
  }

  async loadInstructors(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('instructors')
      .select(`
        id_number,
        uid,
        first_name,
        last_name,
        gender,
        about,
        certificate,
        min_age_years_male,
        max_age_years_male,
        min_age_years_female,
        max_age_years_female,
        taught_child_genders
      `)
      .eq('status', 'Active');

    if (error) {
      console.error(error);
      this.showError('שגיאה בטעינת מדריכים');
      return;
    }

    this.instructors = (data ?? []) as InstructorRow[];
  }

  async loadPaymentPlans(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('payment_plans')
      .select(`
        id,
        name,
        lesson_price,
        subsidy_amount,
        customer_amount,
        require_docs_at_booking,
        required_docs,
        funding_source_id
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error(error);
      this.showError('שגיאה בטעינת מסלולי תשלום');
      return;
    }

    this.paymentPlans = (data ?? []) as PaymentPlan[];
  }

  async loadRidingTypes(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('riding_types')
      .select('id, name, code, is_active, min_participants, max_participants')
      .order('name', { ascending: true });

    if (error) {
      console.error(error);
      this.showError('שגיאה בטעינת סוגי שיעור');
      return;
    }

    const rows = (data ?? []) as RidingTypeRow[];
    this.activeRidingTypes = rows.filter(r => !!r.is_active);
    this.inactiveRidingTypes = rows.filter(r => !r.is_active);
  }

  async loadSlotInfo(): Promise<void> {
    if (!this.instructorId || !this.date || !this.startTime) {
      this.slotInfoError = 'חסרים נתוני סלוט';
      return;
    }

    this.loadingSlotInfo = true;
    this.slotInfoError = null;

    try {
      const { data, error } = await dbTenant().rpc('get_quick_booking_slot_info', {
        p_instructor_id_number: this.instructorId,
        p_date: this.date,
        p_start_time: this.startTime,
        p_end_time: this.endTime || null,
      });

      if (error) {
        console.error(error);
        this.slotInfoError = 'לא ניתן לטעון את פרטי הסלוט';
        return;
      }

      this.slotInfo = data as QuickSlotInfo;

      if (!this.slotInfo?.ok) {
        this.slotInfoError = this.slotInfo?.reason || 'לא נמצאה זמינות מתאימה';
      }
    } finally {
      this.loadingSlotInfo = false;
    }
  }

  async onBookingModeChange(): Promise<void> {
    this.makeupError = null;
    this.occupancyError = null;
    this.selectedMakeupCandidate = null;
    this.selectedOccupancyCandidate = null;
    this.makeupCandidates = [];
    this.occupancyCandidates = [];

    if (!this.selectedChildId) return;

    if (this.bookingMode === 'makeup') {
      await this.loadMakeupCandidates();
    }

    if (this.bookingMode === 'occupancy') {
      await this.loadOccupancyCandidates();
    }
  }

  async onChildChange(): Promise<void> {
    if (!this.selectedChildId) return;

    if (this.bookingMode === 'makeup') {
      await this.loadMakeupCandidates();
    }

    if (this.bookingMode === 'occupancy') {
      await this.loadOccupancyCandidates();
    }
  }

  private getSelectedInstructorUidOrThrow(): string {
    const uid = this.selectedInstructor?.uid ?? null;
    if (!uid) throw new Error('לא נמצא instructor_uid למדריך שנבחר');
    return uid;
  }

  private getSeriesParams(): { p_is_open_ended: boolean; p_repeat_weeks: number } {
    if (this.bookingMode === 'single') {
      return {
        p_is_open_ended: false,
        p_repeat_weeks: 1,
      };
    }

    if (this.bookingMode === 'series') {
      if (this.seriesMode === 'open') {
        return {
          p_is_open_ended: true,
          p_repeat_weeks: 1,
        };
      }

      const weeks = Number(this.repeatWeeks || 0);
      if (!weeks || weeks < 1) {
        throw new Error('יש לבחור כמות מפגשים תקינה');
      }

      return {
        p_is_open_ended: false,
        p_repeat_weeks: weeks,
      };
    }

    return {
      p_is_open_ended: false,
      p_repeat_weeks: 1,
    };
  }

  private getEffectiveRidingTypeId(): string | null {
    if (this.bookingMode === 'special') {
      return this.selectedSpecialRidingTypeId ?? null;
    }
    return this.slotInfo?.riding_type_id ?? null;
  }

  private getEffectiveMaxParticipants(): number {
    if (this.bookingMode === 'special') {
      return this.selectedSpecialRidingType?.max_participants ?? 1;
    }
    return this.slotInfo?.max_participants ?? 1;
  }

  private async createViaSeriesValidation(params: {
    startDate: string;
    startTime: string;
    instructorId: string;
    instructorUid: string;
    ridingTypeId: string;
    paymentPlanId: string;
    isOpenEnded: boolean;
    repeatWeeks: number;
    origin?: string;
    maxParticipants: number;
    referralUrl?: string | null;
  }): Promise<CreateSeriesWithValidationResult | null> {
    const { data, error } = await dbTenant().rpc('create_series_with_validation', {
      p_child_id: this.selectedChildId,
      p_instructor_id_number: params.instructorId,
      p_instructor_uid: params.instructorUid,
      p_series_start_date: params.startDate,
      p_start_time: params.startTime,
      p_riding_type_id: params.ridingTypeId,
      p_payment_plan_id: params.paymentPlanId,
    p_payment_source: 'private',
    p_is_open_ended: params.isOpenEnded,
    p_repeat_weeks: params.repeatWeeks,
    p_series_search_horizon_days: null,
    p_existing_approval_id: null,
    p_referral_url: params.referralUrl ?? null,
    p_payment_docs_url: null,
      p_health_fund: null,
      p_approval_number: null,
      p_total_lessons: null,
      p_origin: params.origin ?? 'secretary',
      p_max_participants: params.maxParticipants,
    });

    if (error) {
      console.error(error);
      throw new Error('שגיאה ביצירת השיעור/סדרה');
    }

    return (Array.isArray(data) ? data[0] : data) as CreateSeriesWithValidationResult | null;
  }

  async loadMakeupCandidates(): Promise<void> {
    if (!this.selectedChildId) return;

    this.loadingMakeup = true;
    this.makeupError = null;

    try {
      const { data, error } = await dbTenant().rpc('get_quick_makeup_candidates', {
        p_child_id: this.selectedChildId,
      });

      if (error) {
        console.error(error);
        this.makeupError = 'שגיאה בטעינת שיעורים שניתן להשלים';
        return;
      }

      this.makeupCandidates = (data ?? []) as MakeupCandidate[];
    } finally {
      this.loadingMakeup = false;
    }
  }

  async loadOccupancyCandidates(): Promise<void> {
    if (!this.selectedChildId) return;

    this.loadingOccupancy = true;
    this.occupancyError = null;

    try {
      const { data, error } = await dbTenant().rpc('get_quick_occupancy_candidates', {
        p_child_id: this.selectedChildId,
      });

      if (error) {
        console.error(error);
        this.occupancyError = 'שגיאה בטעינת שיעורים למילוי מקום';
        return;
      }

      this.occupancyCandidates = (data ?? []) as OccupancyCandidate[];
    } finally {
      this.loadingOccupancy = false;
    }
  }

  private validateCommon(): void {
    if (!this.selectedChildId) {
      throw new Error('יש לבחור ילד/ה');
    }

    if (!this.instructorId) {
      throw new Error('לא נבחר מדריך');
    }

    if (
  this.bookingMode !== 'makeup' &&
  this.bookingMode !== 'occupancy' &&
  this.selectedPaymentPlan?.require_docs_at_booking &&
  !this.referralFile
) {
  throw new Error('למסלול התשלום שנבחר חייבים לצרף הפניה');
}

if (
  this.bookingMode !== 'makeup' &&
  this.bookingMode !== 'occupancy' &&
  !this.selectedPaymentPlanId
) {
  throw new Error('יש לבחור מסלול תשלום');
}

    const child = this.selectedChild;
    const instructor = this.selectedInstructor;

    if (this.isChildDeletedSoon(child)) {
      throw new Error('לא ניתן לזמן שיעור לילד/ה שמחיקה שלו/ה כבר מתוכננת');
    }

    const eligibility = this.isEligibleForInstructor(child, instructor);
    if (!eligibility.ok) {
      throw new Error(eligibility.reason || 'הילד/ה לא מתאים/ה למדריך');
    }
  }

  async save(): Promise<void> {
    this.loading = true;

    try {
      this.validateCommon();

      let referralUrl: string | null = null;

if (
  this.bookingMode !== 'makeup' &&
  this.bookingMode !== 'occupancy' &&
  this.selectedChildId
) {
  referralUrl = await this.uploadReferralIfNeeded(this.selectedChildId);
}

      if (this.bookingMode === 'single' || this.bookingMode === 'series' || this.bookingMode === 'special') {
        const instructorUid = this.getSelectedInstructorUidOrThrow();
        const ridingTypeId = this.getEffectiveRidingTypeId();

        if (!ridingTypeId) {
          throw new Error('לא נמצא סוג שיעור עבור הסלוט');
        }

        const seriesParams = this.getSeriesParams();

        const res = await this.createViaSeriesValidation({
          startDate: this.date,
          startTime: this.startTime,
          instructorId: this.instructorId,
          instructorUid,
          ridingTypeId,
          paymentPlanId: this.selectedPaymentPlanId!,
          isOpenEnded: seriesParams.p_is_open_ended,
          repeatWeeks: seriesParams.p_repeat_weeks,
          origin: 'secretary',
          referralUrl,
          maxParticipants: this.getEffectiveMaxParticipants(),
        });

        if (!res?.ok) {
          throw new Error(res?.deny_reason || 'לא ניתן ליצור שיעור/סדרה');
        }

        this.showSuccess(
          this.bookingMode === 'single'
            ? 'השיעור הבודד נוצר בהצלחה'
            : this.bookingMode === 'special'
            ? 'השיעור נוצר בהצלחה'
            : 'הסדרה נוצרה בהצלחה'
        );
        this.referralFile = null;
this.referralUploadError = null;
this.referralUrl = null;
        this.saved.emit();
        return;
      }

      if (this.bookingMode === 'makeup') {
        if (!this.selectedMakeupCandidate) {
          throw new Error('יש לבחור שיעור להשלמה');
        }

        const instructorUid = this.getSelectedInstructorUidOrThrow();
        const ridingTypeId = this.slotInfo?.riding_type_id;

        if (!ridingTypeId) {
          throw new Error('לא נמצא סוג שיעור עבור החור הנוכחי');
        }

        const res = await this.createViaSeriesValidation({
          startDate: this.date,
          startTime: this.startTime,
          instructorId: this.instructorId,
          instructorUid,
          ridingTypeId,
          paymentPlanId: this.selectedPaymentPlanId!,
          isOpenEnded: false,
          repeatWeeks: 1,
          origin: 'secretary',
          maxParticipants: this.slotInfo?.max_participants ?? 1,
            referralUrl,
        });

        if (!res?.ok) {
          throw new Error(res?.deny_reason || 'לא ניתן ליצור שיעור השלמה');
        }

        this.showSuccess('שיעור ההשלמה נוצר בהצלחה');
        this.referralFile = null;
this.referralUploadError = null;
this.referralUrl = null;
        this.saved.emit();
        return;
      }

      if (this.bookingMode === 'occupancy') {
        if (!this.selectedOccupancyCandidate) {
          throw new Error('יש לבחור שיעור למילוי מקום');
        }

        const instructorUid = this.getSelectedInstructorUidOrThrow();
        const ridingTypeId = this.slotInfo?.riding_type_id;

        if (!ridingTypeId) {
          throw new Error('לא נמצא סוג שיעור עבור החור הנוכחי');
        }

        const res = await this.createViaSeriesValidation({
          startDate: this.date,
          startTime: this.startTime,
          instructorId: this.instructorId,
          instructorUid,
          ridingTypeId,
          paymentPlanId: this.selectedPaymentPlanId!,
          isOpenEnded: false,
          repeatWeeks: 1,
          origin: 'secretary',
          maxParticipants: this.slotInfo?.max_participants ?? 1,
              referralUrl,
        });

        if (!res?.ok) {
          throw new Error(res?.deny_reason || 'לא ניתן ליצור שיעור מילוי מקום');
        }

        this.showSuccess('שיעור מילוי המקום נוצר בהצלחה');
        this.referralFile = null;
this.referralUploadError = null;
this.referralUrl = null;
        this.saved.emit();
        return;
      }

      throw new Error('מצב זימון לא נתמך');
    } catch (err: any) {
      console.error(err);
      this.showError(err?.message || 'שגיאה בשמירה');
    } finally {
      this.loading = false;
    }
  }

  onPaymentPlanChange(): void {
  this.referralUploadError = null;

  if (!this.selectedPaymentPlan?.require_docs_at_booking) {
    this.referralFile = null;
    this.referralUrl = null;
  }
}

onReferralFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  this.referralUploadError = null;
  this.referralFile = null;

  if (!file) {
    return;
  }

  const allowedMimeTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/heic',
    'image/heif',
  ];

  const isMimeAllowed = allowedMimeTypes.includes(file.type);
  const isExtensionAllowed = /\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(file.name);

  if (!isMimeAllowed && !isExtensionAllowed) {
    this.referralUploadError = 'ניתן להעלות רק PDF או תמונה';
    return;
  }

  const maxSizeBytes = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSizeBytes) {
    this.referralUploadError = 'הקובץ גדול מדי. ניתן להעלות עד 10MB';
    return;
  }

  this.referralFile = file;
}

private async uploadReferralIfNeeded(childId: string): Promise<string | null> {
  if (!this.referralFile) {
    this.referralUrl = null;
    return null;
  }

  try {
    const ext = this.referralFile.name.split('.').pop() || 'bin';
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
    const filePath = `referrals/${childId}/${Date.now()}.${safeExt}`;

    const { error: uploadError } = await supabase!
      .storage
      .from('referrals')
      .upload(filePath, this.referralFile, {
        upsert: false,
      });

    if (uploadError) {
      console.error('referral upload error', uploadError);
      throw new Error('שגיאה בהעלאת מסמך ההפניה');
    }

    const { data: publicData } = supabase!
      .storage
      .from('referrals')
      .getPublicUrl(filePath);

    const url = publicData?.publicUrl ?? null;
    this.referralUrl = url;
    return url;
  } catch (error) {
    console.error('referral upload exception', error);
    throw error;
  }
}
}
import { Component, Input, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, fetchMyChildren } from '../services/supabaseClient.service';
import { AppointmentMode, AppointmentTab, ChildRow, CurrentUser , InstructorRow } from '../Types/detailes.model';
import { CurrentUserService } from '../core/auth/current-user.service';
import { ActivatedRoute } from '@angular/router';
import { SELECTION_LIST } from '@angular/material/list';

interface InstructorDbRow {
  uid: string | null;
  first_name: string | null;
  last_name: string | null;
  accepts_makeup_others: boolean;
  gender: string | null;             // מין המדריך עצמו (גם כנראה "זכר"/"נקבה")
  certificate: string | null;
  about: string | null;
  education: string | null;
  phone: string | null;
  min_age_years: number | null;
  max_age_years: number | null;
  taught_child_genders: string[] | null; // ⬅️ "זכר"/"נקבה"
}




interface ApprovalBalance {
  approval_id: string;
  child_id: string;
  health_fund: string | null;
  approval_number: string | null;
  total_lessons: number;
  used_lessons_calc: number;
  remaining_lessons: number;
}

interface RecurringSlot {
  lesson_date: string;   // YYYY-MM-DD
  start_time: string;    // HH:MM:SS
  end_time: string;      // HH:MM:SS
  instructor_id: string; // text
}

interface MakeupSlot {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  remaining_capacity: number;
}
interface MakeupCandidate {
  lesson_id: string;
  occur_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string | null;
  status: string;
}
type ChildWithProfile = ChildRow & {
  gender?: string | null;       // "זכר" / "נקבה"
  birth_date?: string | null;
};
type InstructorWithConstraints = InstructorRow & {
  min_age_years?: number | null;
  max_age_years?: number | null;
  taught_child_genders?: string[] | null;
};

@Component({
  selector: 'app-appointment-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './appointment-scheduler.component.html',
  styleUrls: ['./appointment-scheduler.component.scss'],
})
export class AppointmentSchedulerComponent implements OnInit {

needApprove: boolean = false;
selectedChildId: string | null = null;
instructors: InstructorWithConstraints[] = [];
selectedInstructorId: string | null = null;
loadingInstructors = false;
showInstructorDetails = true;
noInstructorPreference = false;        



children: ChildWithProfile[] = [];

  // מצב כללי
  selectedTab: AppointmentTab = 'series';

  // ---- נתוני אישורים (קופה/פרטי) ----
  approvals: ApprovalBalance[] = [];
  selectedApprovalId: string | null = null;
  // ---- שיעורים שניתן להשלים (ביטולים לפי הגדרות חווה) ----
  makeupCandidates: MakeupCandidate[] = [];
  loadingMakeupCandidates = false;

  private readonly CHILD_SELECT =
  'child_uuid, first_name, last_name, instructor_id';

  get selectedApproval(): ApprovalBalance | undefined {
    return this.approvals.find(a => a.approval_id === this.selectedApprovalId);
  }
get selectedInstructor(): InstructorWithConstraints | undefined {
  return this.instructors.find(
    ins => ins.instructor_uid === this.selectedInstructorId
  );
}


onNoInstructorPreferenceChange(): void {
  if (this.noInstructorPreference) {
    // אם אין העדפה – מנקים מדריך ומסתירים כרטיס
    this.selectedInstructorId = null;
    this.showInstructorDetails = false;
  }
}

  // ---- סדרת טיפולים ----
  daysOfWeek = [
    { value: 0, label: 'ראשון' },
    { value: 1, label: 'שני' },
    { value: 2, label: 'שלישי' },
    { value: 3, label: 'רביעי' },
    { value: 4, label: 'חמישי' },
  ];

  seriesDayOfWeek: number | null = null;
  seriesStartTime = '16:00'; // קלט בצורת HH:MM
  paymentSourceForSeries: 'health_fund' | 'private' = 'health_fund';

  recurringSlots: RecurringSlot[] = [];
  loadingSeries = false;
  seriesError: string | null = null;
  seriesCreatedMessage: string | null = null;

  // ---- שיעור השלמה ----
  makeupFromDate: string | null = null; // YYYY-MM-DD
  makeupToDate: string | null = null;
  makeupSlots: MakeupSlot[] = [];
  loadingMakeup = false;
  makeupError: string | null = null;
  makeupCreatedMessage: string | null = null;
  user: CurrentUser | null = null;

  constructor(
  private currentUser: CurrentUserService,
  private route: ActivatedRoute
) {
  this.user = this.currentUser.current;
}

  async ngOnInit(): Promise<void> {
  // 1. קריאת פרמטרים מה־URL
  const qp = this.route.snapshot.queryParamMap;

  const needApproveParam = qp.get('needApprove');
  this.needApprove = needApproveParam === 'true';

  const qpChildId = qp.get('childId');
  if (qpChildId) {
    this.selectedChildId = qpChildId;    // ⬅⬅ שומרים את הילד שעבר בניווט
  }

  //await this.loadInstructors();

  // 2. תמיד טוענים ילדים פעילים מהשרת (RLS יטפל בהורה/מזכירה)
  await this.loadChildrenFromCurrentUser();
}
onInstructorChange() {
  if (this.selectedInstructorId === 'any') {
    this.showInstructorDetails = false; // לא מציגים כרטיס מדריך
  } else {
    this.showInstructorDetails = true;  // כן מציגים כרטיס מדריך
  }
}
private calcAgeYears(birthDateStr: string): number | null {
  if (!birthDateStr) return null;

  // birthDateStr מגיע מה־DB בפורמט YYYY-MM-DD
  const birth = new Date(birthDateStr + 'T00:00:00');
  if (isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  
  const monthDiff = today.getMonth() - birth.getMonth();
  const dayDiff = today.getDate() - birth.getDate();

  // אם טרם הגענו ליום ההולדת השנה – להוריד שנה
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--;
  }

  return age;
}

private async loadChildrenFromCurrentUser(): Promise<void> {
  if (!this.user) return;

  const supa = dbTenant();

  const { data, error } = await supa
    .from('children')
    .select('child_uuid, first_name, last_name, instructor_id, status, gender, birth_date')
    .eq('status', 'Active')
    .order('first_name', { ascending: true });

  if (error) {
    console.error('loadChildrenFromCurrentUser error', error);
    return;
  }

  this.children = (data ?? []) as ChildWithProfile[];

  // אם עבר childId בניווט והוא קיים ברשימת הילדים הפעילים:
  if (this.selectedChildId && this.children.some(c => c.child_uuid === this.selectedChildId)) {
    await this.onChildChange();
  } else if (!this.selectedChildId && this.children.length === 1) {
    this.selectedChildId = this.children[0].child_uuid;
    await this.onChildChange();
  }
}

private async loadInstructorsForChild(childId: string): Promise<void> {
  this.loadingInstructors = true;
  this.instructors = [];

  const child = this.children.find(c => c.child_uuid === childId);
  if (!child) {
    this.loadingInstructors = false;
    return;
  }

  const childGender = child.gender ?? null;        // "זכר"/"נקבה"
  const childAgeYears = child.birth_date ? this.calcAgeYears(child.birth_date) : null;

  const supa = dbTenant();

  const { data, error } = await supa
    .from('instructors')
    .select(`
      uid,
      first_name,
      last_name,
      gender,
      certificate,
      about,
      education,
      phone,
      accepts_makeup_others,
      min_age_years,
      max_age_years,
      taught_child_genders
    `)
    .eq('accepts_makeup_others', true)
    .not('uid', 'is', null)
    .order('first_name', { ascending: true }) as {
      data: InstructorDbRow[] | null;
      error: any;
    };

  if (error) {
    console.error('loadInstructorsForChild error', error);
    this.loadingInstructors = false;
    return;
  }

  const filtered = (data ?? []).filter(ins => {
    if (!ins.uid) return false;

    // סינון לפי גיל
    if (childAgeYears != null) {
      if (ins.min_age_years != null && childAgeYears < ins.min_age_years) return false;
      if (ins.max_age_years != null && childAgeYears > ins.max_age_years) return false;
    }

    // סינון לפי מין הילד: "זכר"/"נקבה"
    if (childGender && ins.taught_child_genders && ins.taught_child_genders.length > 0) {
      if (!ins.taught_child_genders.includes(childGender)) return false;
    }

    // אם taught_child_genders ריק/NULL – נניח שהמדריך מתאים לכולם
    return true;
  });

  this.instructors = filtered.map(ins => ({
    instructor_uid: ins.uid!,
    full_name: `${ins.first_name ?? ''} ${ins.last_name ?? ''}`.trim(),
    gender: ins.gender,                    // יוצג כרגיל בכרטיס
    certificate: ins.certificate,
    about: ins.about,
    education: ins.education,
    phone: ins.phone,
    min_age_years: ins.min_age_years,
    max_age_years: ins.max_age_years,
    taught_child_genders: ins.taught_child_genders,
  }));

  this.loadingInstructors = false;
}

  // =========================================
  //  שינוי ילד – טוען אישורים ומנקה מצבים
  // =========================================
  async onChildChange(): Promise<void> {
  this.seriesError = null;
  this.makeupError = null;
  this.seriesCreatedMessage = null;
  this.makeupCreatedMessage = null;
  this.recurringSlots = [];
  this.makeupSlots = [];
  this.approvals = [];
  this.selectedApprovalId = null;

  // איפוס בחירת מדריך בכל פעם שמחליפים ילד
  this.selectedInstructorId = null;
  this.showInstructorDetails = false;
  this.noInstructorPreference = false;

  if (!this.selectedChildId) {
    this.instructors = [];
    return;
  }

  // ⬅️ כאן נטען מדריכים מתאימים לילד שנבחר
  await this.loadInstructorsForChild(this.selectedChildId);

  const supa = dbTenant();
  const { data, error } = await supa
    .from('v_child_approval_balances')
    .select('*')
    .eq('child_id', this.selectedChildId)
    .order('remaining_lessons', { ascending: false });

  if (error) {
    console.error(error);
    this.seriesError = 'שגיאה בטעינת אישורי טיפול';
    return;
  }

  this.approvals = data ?? [];
  if (this.approvals.length > 0) {
    this.selectedApprovalId = this.approvals[0].approval_id;
  }

  await this.loadMakeupCandidatesForChild();
}

  private async loadMakeupCandidatesForChild(): Promise<void> {
    if (!this.selectedChildId) return;

    this.loadingMakeupCandidates = true;
    this.makeupCandidates = [];
    this.makeupError = null;

    try {
      const { data, error } = await dbTenant().rpc(
        'get_child_makeup_candidates',
        { _child_id: this.selectedChildId }
      );

      if (error) {
        console.error('get_child_makeup_candidates error', error);
        this.makeupError = 'שגיאה בטעינת שיעורים שניתן להשלים';
        return;
      }

      this.makeupCandidates = (data ?? []) as MakeupCandidate[];
    } finally {
      this.loadingMakeupCandidates = false;
    }
  }

  // =========================================
  //   חיפוש סדרות זמינות (find_recurring_slots)
  // =========================================
 async searchRecurringSlots(): Promise<void> {
  this.seriesError = null;
  this.seriesCreatedMessage = null;
  this.recurringSlots = [];

  if (!this.selectedChildId || !this.selectedApprovalId || this.seriesDayOfWeek === null) {
    this.seriesError = 'יש לבחור ילד, אישור ויום בשבוע';
    return;
  }

  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    this.seriesError = 'יש לבחור מדריך או לסמן שאין העדפה';
    return;
  }

  const startTime = this.seriesStartTime.includes(':')
    ? this.seriesStartTime + ':00'
    : this.seriesStartTime; // לוודא HH:MM:SS

 const instructorParam =
  this.selectedInstructorId === 'any'
    ? null
    : this.selectedInstructorId;


    this.loadingSeries = true;
   try {
    const { data, error } = await dbTenant().rpc('find_recurring_slots', {
  p_child_id: this.selectedChildId,
  p_approval_id: this.selectedApprovalId,
  p_day_of_week: this.seriesDayOfWeek,
  p_start_time: startTime,
  p_instructor_id: instructorParam
});


      if (error) {
        console.error(error);
        this.seriesError = 'שגיאה בחיפוש סדרות זמינות';
        return;
      }

      this.recurringSlots = (data ?? []) as RecurringSlot[];
    } finally {
      this.loadingSeries = false;
    }
  }

  // יצירת סדרה בפועל – insert ל-lessons (occurrences נוצרים מה-view)
  async createSeriesFromSlot(slot: RecurringSlot): Promise<void> {
    if (!this.selectedChildId) return;

    const approval = this.selectedApproval;
    if (!approval && this.paymentSourceForSeries === 'health_fund') {
      this.seriesError = 'לא נבחר אישור טיפול';
      return;
    }

    // כמה שיעורים לשבץ – לפי יתרה באישור, או 1 כפרטי אם אין אישור
    const repeatWeeks =
      this.paymentSourceForSeries === 'health_fund' && approval
        ? Math.max(1, approval.remaining_lessons)
        : 12; // ברירת מחדל – 12 שבועות (אפשר לשנות למשתנה בטופס)

    const anchorWeekStart = this.calcAnchorWeekStart(slot.lesson_date);
    const dayLabel = this.dayOfWeekLabel(this.seriesDayOfWeek!);

    const { data, error } = await dbTenant()
      .from('lessons')
      .insert({
        child_id: this.selectedChildId,
instructor_id:
  this.selectedInstructorId === 'any'
    ? slot.instructor_id
    : this.selectedInstructorId,
        lesson_type: 'רגיל',
        status: 'אושר',
        day_of_week: dayLabel,
        start_time: slot.start_time,
        end_time: slot.end_time,
        repeat_weeks: repeatWeeks,
        anchor_week_start: anchorWeekStart,
        appointment_kind: 'therapy_series',
        approval_id:
          this.paymentSourceForSeries === 'health_fund' && approval
            ? approval.approval_id
            : null,
        origin: this.user!.role === 'parent' ? 'parent' : 'secretary',
        is_tentative: false,
        capacity: 1,
        current_booked: 1,
        payment_source:
          this.paymentSourceForSeries === 'health_fund' && approval
            ? 'health_fund'
            : 'private',
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      this.seriesError = 'שגיאה ביצירת הסדרה';
      return;
    }

    this.seriesCreatedMessage = 'הסדרה נוצרה בהצלחה';
    // אפשר לעדכן האישורים מה־view
    await this.onChildChange();
  }

  // =========================================
  //   חיפוש חורים להשלמות (find_makeup_slots)
  // =========================================
  async searchMakeupSlots(): Promise<void> {
    this.makeupError = null;
    this.makeupCreatedMessage = null;
    this.makeupSlots = [];

 if (!this.selectedChildId || !this.makeupFromDate || !this.makeupToDate) {
    this.makeupError = 'יש לבחור ילד וטווח תאריכים';
    return;
  }

  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    this.makeupError = 'יש לבחור מדריך או לסמן שאין העדפה';
    return;
  }

 const instructorParam =
  this.selectedInstructorId === 'any'
    ? null
    : this.selectedInstructorId;

    this.loadingMakeup = true;
    try {
    const { data, error } = await dbTenant().rpc('find_makeup_slots', {
  p_child_id: this.selectedChildId,
  p_from_date: this.makeupFromDate,
  p_to_date: this.makeupToDate,
  p_instructor_id: instructorParam
});



      if (error) {
        console.error(error);
        this.makeupError = 'שגיאה בחיפוש חורים להשלמה';
        return;
      }

      this.makeupSlots = (data ?? []) as MakeupSlot[];
    } finally {
      this.loadingMakeup = false;
    }
  }

  // יצירת שיעור השלמה – יוצר lesson יחיד (repeat_weeks = 1)
  async bookMakeupSlot(slot: MakeupSlot): Promise<void> {
    if (!this.selectedChildId) return;

    const dayLabel = this.dayOfWeekLabelFromDate(slot.occur_date);
    const anchorWeekStart = this.calcAnchorWeekStart(slot.occur_date);

    const { data, error } = await dbTenant()
      .from('lessons')
      .insert({
        child_id: this.selectedChildId,
instructor_id:
  this.selectedInstructorId === 'any'
    ? slot.instructor_id
    : this.selectedInstructorId,
        lesson_type: 'השלמה',
        status: 'אושר',
        day_of_week: dayLabel,
        start_time: slot.start_time,
        end_time: slot.end_time,
        repeat_weeks: 1,
        anchor_week_start: anchorWeekStart,
        appointment_kind: 'therapy_makeup',
        // אם יש אישור פעיל – אפשר לבחור אחד approvals ולהצמיד אותו:
        approval_id: this.selectedApproval?.approval_id ?? null,
        origin: this.user!.role === 'parent' ? 'parent' : 'secretary',
        is_tentative: false,
        capacity: 1,
        current_booked: 1,
        payment_source: this.selectedApproval ? 'health_fund' : 'private',
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      this.makeupError = 'שגיאה ביצירת שיעור ההשלמה';
      return;
    }

    this.makeupCreatedMessage = 'שיעור ההשלמה נוצר בהצלחה';
    await this.onChildChange();
  }

  // =========================================
  //           עזרי תאריכים / ימים
  // =========================================
  private dayOfWeekLabel(value: number): string {
    return this.daysOfWeek.find(d => d.value === value)?.label ?? '';
  }

  private dayOfWeekLabelFromDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getUTCDay(); // 0-6
    return this.dayOfWeekLabel(dow);
  }

  /**
   * anchor_week_start = יום ראשון של השבוע של lesson_date
   */
  private calcAnchorWeekStart(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getUTCDay(); // 0=Sunday
    const sunday = new Date(d);
    sunday.setUTCDate(d.getUTCDate() - dow); // לחזור לראשון
    const yyyy = sunday.getUTCFullYear();
    const mm = String(sunday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(sunday.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

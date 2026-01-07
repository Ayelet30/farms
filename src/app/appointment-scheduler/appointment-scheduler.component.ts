import { Component, Input, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, fetchMyChildren , supabase } from '../services/supabaseClient.service';
import { AppointmentMode, AppointmentTab, ChildRow, CurrentUser , InstructorRow } from '../Types/detailes.model';
import { CurrentUserService } from '../core/auth/current-user.service';
import { ActivatedRoute } from '@angular/router';
import { SELECTION_LIST } from '@angular/material/list';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ViewChild, TemplateRef } from '@angular/core';
//import { console } from 'inspector';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';



interface PaymentPlan {
  id: string;
  name: string;
  lesson_price: number | null;
  subsidy_amount: number | null;
  customer_amount: number | null;
  require_docs_at_booking: boolean;
  required_docs: string[] | null;
  funding_source_id: string | null;
}

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
    id_number: string;         

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
export type ISODate = string;

export interface RecurringSlotWithSkips {
  lesson_date: ISODate;
  start_time: string;
  end_time: string;
  instructor_id: string | null;         // ← חשוב!
  instructor_name?: string;             // ← לא null (או תעשי גם null)
skipped_farm_days_off: ISODate[];
skipped_instructor_unavailability: ISODate[];
}

// interface RecurringSlot {
//   lesson_date: string;   // YYYY-MM-DD
//   start_time: string;    // HH:MM:SS
//   end_time: string;      // HH:MM:SS
//   instructor_id: string; // text
//   instructor_name?: string | null; 

// }

interface MakeupSlot {
 // lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  remaining_capacity: number;

  riding_type_id?: string | null;
  riding_type_code?: string | null;
  riding_type_name?: string | null;
  max_participants?: number | null;

  instructor_name?: string | null; 
  // lesson_type_mode?: 'double_only' | 'both' | 'double or both' | 'break' | null;



}
interface MakeupCandidate {
  lesson_occ_exception_id: string;   // ⬅ id מהטבלה lesson_occurrence_exceptions
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
  instructor_id?: string | null;       // 👈 ה-id_number מה-DB
  min_age_years?: number | null;
  max_age_years?: number | null;
  taught_child_genders?: string[] | null;
};
interface SeriesCalendarDay {
  date: string;        // 'YYYY-MM-DD'
  label: number | null; // מספר היום בחודש או null לריבוע ריק
  isCurrentMonth: boolean;
  hasSlots: boolean;   // האם יש לפחות סדרה אחת שיכולה להתחיל בתאריך זה
}
interface OccupancyCandidate {
  lesson_occ_exception_id: string;
  lesson_id: string;
  occur_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string | null;   // 👈 חשוב!
  instructor_name?: string | null;
  status: string;
}


@Component({
  selector: 'app-appointment-scheduler',
  standalone: true,
  imports: [CommonModule,
    FormsModule,
    MatSelectModule,
    MatInputModule , 
    MatTooltipModule,
    MatButtonModule,
    MatDialogModule,
  MatSnackBarModule],
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


displayedMakeupLessonsCount: number | null = null;

children: ChildWithProfile[] = [];

  // מצב כללי
  selectedTab: AppointmentTab = 'series';

  // ---- נתוני אישורים (קופה/פרטי) ----
  approvals: ApprovalBalance[] = [];
  selectedApprovalId: string | null = null;
  // ---- שיעורים שניתן להשלים (ביטולים לפי הגדרות חווה) ----
  makeupCandidates: MakeupCandidate[] = [];
  loadingMakeupCandidates = false;
  selectedMakeupCandidate: MakeupCandidate | null = null;
candidateSlots: MakeupSlot[] = [];
loadingCandidateSlots = false;
candidateSlotsError: string | null = null;
  makeupSearchFromDate: string | null = null;
  makeupSearchToDate: string | null = null;
 seriesLessonCount: number | null = null;

seriesLessonCountOptions: number[] = Array.from({ length: 50 }, (_, i) => i + 1);
// קלנדר לסדרה
currentCalendarYear: number = new Date().getFullYear();
currentCalendarMonth: number = new Date().getMonth(); // 0-11
seriesCalendarDays: SeriesCalendarDay[] = [];

// תאריכים → איזו רשימת סלוטים יש בכל יום
calendarSlotsByDate: Record<string, RecurringSlotWithSkips[]> = {};

// בחירת יום בקלנדר
selectedSeriesDate: string | null = null;
selectedSeriesDaySlots: RecurringSlotWithSkips[] = [];

occupancyCandidates: OccupancyCandidate[] = [];
loadingOccupancyCandidates = false;
occupancyError: string | null = null;
// בחירה של שיעור שנפתח למילוי מקום
selectedOccupancyCandidate: OccupancyCandidate | null = null;

// סלוטים פנויים עבור מילוי מקום
occupancySlots: MakeupSlot[] = [];
loadingOccupancySlots = false;
occupancySlotsError: string | null = null;
selectedOccupancySlot: MakeupSlot | null = null;

isOpenEndedSeries = false;
seriesSearchHorizonDays = 90; // fallback

get hasSeriesCountOrOpenEnded(): boolean {
  return this.isOpenEndedSeries || !!this.seriesLessonCount;
}
// שיעורי מילוי מקום

occupancyCreatedMessage: string | null = null;

@ViewChild('confirmOccupancyDialog') confirmOccupancyDialog!: TemplateRef<any>;

occupancyConfirmData = {
  newDate: '',
  newStart: '',
  newEnd: '',
  newInstructorName: '',
  oldDate: '',
  oldStart: '',
  oldEnd: '',
  oldInstructorName: ''
};

  @ViewChild('confirmMakeupDialog') confirmMakeupDialog!: TemplateRef<any>;
  @ViewChild('childSelect') childSelect!: MatSelect;
  @ViewChild('instructorSelect') instructorSelect!: MatSelect;

  paymentPlans: PaymentPlan[] = [];
  selectedPaymentPlanId: string | null = null;

get selectedPaymentPlan(): PaymentPlan | null {
  return this.paymentPlans.find(p => p.id === this.selectedPaymentPlanId) ?? null;
}




confirmData = {
  newDate: '',
  newStart: '',
  newEnd: '',
  oldDate: '',
  oldStart: '',
  oldEnd: '',
};

referralFile: File | null = null;
referralUploadError: string | null = null;



seriesConfirmData = {
  startDate: '',
  endDate: '',
  dayLabel: '',
  startTime: '',
  endTime: '',
  instructorName: ''
};
filteredChildren: ChildWithProfile[] = [];
childSearchTerm: string = '';

filteredInstructors: InstructorWithConstraints[] = [];
instructorSearchTerm: string = '';
// שומרים את הרשימות המקוריות מה-DB
private makeupCandidatesAll: MakeupCandidate[] = [];
private occupancyCandidatesAll: OccupancyCandidate[] = [];



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
  { value: 5, label: 'שישי' },
  { value: 6, label: 'שבת' },
];
  seriesDayOfWeek: number | null = null;
  seriesStartTime = '16:00'; // קלט בצורת HH:MM
paymentSourceForSeries: 'health_fund' | 'private' | null = null;

  recurringSlots: RecurringSlotWithSkips[] = [];
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
  hoursBeforeCancel: number | null = null;


  constructor(
  private currentUser: CurrentUserService,
  private route: ActivatedRoute,
  private dialog: MatDialog, 
  private snackBar: MatSnackBar


  
)
 {
  this.user = this.currentUser.current;
}
// ברירת מחדל למקרה קצה
timeRangeOccupancyRateDays = 30;

  async ngOnInit(): Promise<void> {
  // 1. קריאת פרמטרים מה־URL
  const qp = this.route.snapshot.queryParamMap;
    await this.loadFarmSettings();
    await this.loadPaymentPlans();


  const needApproveParam = qp.get('needApprove');
  this.needApprove = needApproveParam === 'true';

  const qpChildId = qp.get('childId');
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

if (qpChildId && isUuid(qpChildId)) {
  this.selectedChildId = qpChildId;
}

  //await this.loadInstructors();

  // 2. תמיד טוענים ילדים פעילים מהשרת (RLS יטפל בהורה/מזכירה)
  await this.loadChildrenFromCurrentUser();
    this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);

}

private async loadPaymentPlans(): Promise<void> {
  const supa = dbTenant();
  const { data, error } = await supa
    .from('payment_plans')
    .select('id, name, lesson_price, subsidy_amount, customer_amount, require_docs_at_booking, required_docs, funding_source_id')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('loadPaymentPlans error', error);
    return;
  }

  this.paymentPlans = (data ?? []) as PaymentPlan[];
}



async openHolesForCandidate(c: MakeupCandidate): Promise<void> {
  if (!this.selectedChildId) {
    this.candidateSlotsError = 'יש לבחור ילד';
    return;
  }

  this.selectedMakeupCandidate = c;
  this.candidateSlots = [];
  this.candidateSlotsError = null;

  // אם עוד לא נבחר מדריך ידנית – ברירת מחדל: המדריך של השיעור המקורי
  // if (!this.selectedInstructorId && c.instructor_id) {
  //   this.selectedInstructorId = c.instructor_id;
  // }

  // טווח חיפוש לחורים (אפשר לשנות לימים אחרים אם תרצי)
  this.makeupSearchFromDate = c.occur_date;
this.makeupSearchFromDate = c.occur_date;
this.makeupSearchToDate = this.addDays(
  c.occur_date,
  this.timeRangeOccupancyRateDays
);

  await this.loadCandidateSlots();
}
private async loadCandidateSlots(): Promise<void> {
  if (!this.makeupSearchFromDate || !this.makeupSearchToDate) {
    return;
  }

  // ממירים מהערך של ה-select (uid או id_number) ל-id_number אמיתי מה-DB
  let instructorParam: string | null = null;

if (this.selectedInstructorId && this.selectedInstructorId !== 'any') {
  const sel = this.instructors.find(
    i => i.instructor_uid === this.selectedInstructorId
  );
  instructorParam = sel?.instructor_id ?? null;  // זה ה-id_number (טקסט)
}

  this.loadingCandidateSlots = true;
  this.candidateSlotsError = null;

  try {
    const { data, error } = await dbTenant().rpc('find_makeup_slots_for_lesson_by_id_number', {
  p_instructor_id: instructorParam,
  p_from_date: this.makeupSearchFromDate,
  p_to_date: this.makeupSearchToDate,
});





    if (error) {
      console.error('find_makeup_slots_for_lesson error', error);
      this.candidateSlots = [];
      this.candidateSlotsError = 'שגיאה בחיפוש חורים להשלמה לשיעור זה';
      return;
    }

    let slots = (data ?? []) as MakeupSlot[];

    if (this.displayedMakeupLessonsCount != null && this.displayedMakeupLessonsCount > 0) {
      slots = slots.slice(0, this.displayedMakeupLessonsCount);
    }

    this.candidateSlots = slots;

    if (!this.candidateSlots.length) {
      this.candidateSlotsError = 'לא נמצאו חורים למדריך זה';
    }
  } finally {
    this.loadingCandidateSlots = false;
  }
}
private getSelectedInstructorIdNumberOrNull(): string | null {
  if (!this.selectedInstructorId || this.selectedInstructorId === 'any') return null;

  const sel = this.instructors.find(i => i.instructor_uid === this.selectedInstructorId);
  return sel?.instructor_id ?? null; // id_number
}
private applyInstructorFilterToLists(): void {
  const idNumber = this.getSelectedInstructorIdNumberOrNull();

  // ✅ פילטר רק על "שיעורים שניתן להשלים" (makeupCandidates)
  this.makeupCandidates = idNumber
    ? this.makeupCandidatesAll.filter(c => c.instructor_id === idNumber)
    : [...this.makeupCandidatesAll];

  // ✅ בלי פילטר בכלל על "שיעורים שמחפשים מילוי מקום"
  this.occupancyCandidates = [...this.occupancyCandidatesAll];

  // אם המועמד שנבחר ב-makeup לא קיים אחרי סינון -> לנקות
  if (
    this.selectedMakeupCandidate &&
    !this.makeupCandidates.some(x => this.sameCandidate(x, this.selectedMakeupCandidate!))
  ) {
    this.selectedMakeupCandidate = null;
    this.candidateSlots = [];
    this.candidateSlotsError = null;
  }

  // פה לא חייבים לנקות selectedOccupancyCandidate בגלל שינוי פילטר,
  // כי אין פילטר על הרשימה הזו.
}

onSeriesUnlimitedChange(): void {
  if (this.isOpenEndedSeries
) {
    this.seriesLessonCount = null; // אין כמות
  }
  // לאפס תוצאות קודמות
  this.recurringSlots = [];
  this.calendarSlotsByDate = {};
  this.seriesCalendarDays = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.seriesError = null;

  // אם יש ילד + מדריך/any (או noInstructorPreference) -> להריץ חיפוש
  if (this.selectedChildId && (this.noInstructorPreference || this.selectedInstructorId)) {
    this.searchRecurringSlots();
  }
}

private async loadFarmSettings(): Promise<void> {
  const supa = dbTenant();

  const { data, error } = await supa
    .from('farm_settings')
    .select('displayed_makeup_lessons_count , hours_before_cancel_lesson , time_range_occupancy_rate_days , series_search_horizon_days')
    .limit(1)
    .single();

  if (error) {
    console.error('loadFarmSettings error', error);
    return;
  }

  this.displayedMakeupLessonsCount = data?.displayed_makeup_lessons_count ?? null;
    this.hoursBeforeCancel = data?.hours_before_cancel_lesson ?? null;
    this.timeRangeOccupancyRateDays =
  data?.time_range_occupancy_rate_days ?? 30;
  this.seriesSearchHorizonDays = data?.series_search_horizon_days ?? 90;



}

generateLessonSlots(start: string, end: string): { from: string, to: string }[] {
  const slots = [];

  // חיתוך לפורמט HH:MM (שימוש ב-5 התווים הראשונים)
  const startHHMM = start.substring(0, 5); // "08:00"
  const endHHMM   = end.substring(0, 5);   // "12:00"

  let current = new Date(`1970-01-01T${startHHMM}:00`);
  const finish = new Date(`1970-01-01T${endHHMM}:00`);

  while (current < finish) {
    const next = new Date(current.getTime() + 60 * 60 * 1000); // שעה קדימה

    if (next > finish) break; // לא לייצר סלוט מעבר לטווח

    slots.push({
      from: current.toTimeString().substring(0, 5),
      to:   next.toTimeString().substring(0, 5),
    });

    current = next;
  }

  return slots;
}

async onInstructorChange() {
   this.clearUiHint('instructor');
  this.clearUiHint('tab');        // כי tabsLocked תלוי במדריך
  this.clearUiHint('seriesCount'); // כי זה תלוי במדריך
  this.clearUiHint('payment');     // כי זה תלוי במדריך
  this.showInstructorDetails = this.selectedInstructorId !== 'any';

  // ✅ זה ישפיע רק על makeupCandidates (ולא על occupancyCandidates)
  this.applyInstructorFilterToLists();

  // ✅ אם אני בתוך טאב makeup ויש מועמד נבחר – לרענן חורים לפי מדריך
  if (this.selectedMakeupCandidate && this.makeupSearchFromDate && this.makeupSearchToDate) {
    await this.loadCandidateSlots();
  }

  // ✅ אם אני בתוך טאב occupancy ויש מועמד נבחר – לרענן את השיעורים שאפשר לקבוע לפי מדריך
  if (this.selectedTab === 'occupancy' && this.selectedOccupancyCandidate) {
    await this.openOccupancySlotsForCandidate(this.selectedOccupancyCandidate);
  }

  // סדרות נשאר כרגיל
  if (
    this.selectedTab === 'series' &&
    this.seriesLessonCount &&
    this.selectedChildId &&
    this.children.some(c => c.child_uuid === this.selectedChildId)
  ) {
    await this.searchRecurringSlots();
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
  this.filteredChildren = [...this.children];
this.childSearchTerm = '';


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
      id_number,
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
  instructor_uid: ins.uid!,                           // מה שה-select משתמש בו
  instructor_id: ins.id_number,                       // 👈 id_number לטובת הקריאה ל-DB
  full_name: `${ins.first_name ?? ''} ${ins.last_name ?? ''}`.trim(),
  gender: ins.gender,
  certificate: ins.certificate,
  about: ins.about,
  education: ins.education,
  phone: ins.phone,
  min_age_years: ins.min_age_years,
  max_age_years: ins.max_age_years,
  taught_child_genders: ins.taught_child_genders,
}));
this.filteredInstructors = [...this.instructors];
this.instructorSearchTerm = '';


  this.loadingInstructors = false;
}
selectFirstChildFromSearch(event: any): void {
  event.preventDefault();
  event.stopPropagation();

  // אם אין תוצאות – לא עושים כלום
  if (!this.filteredChildren.length) {
    return;
  }

  const first = this.filteredChildren[0];

  // לבחור את הילד הראשון
  this.selectedChildId = first.child_uuid;

  // לאפס את שורת החיפוש ולהחזיר את כל הילדים
  this.childSearchTerm = '';
  this.filterChildren();

  // לסגור את הדרופ-דאון אם יש רפרנס
  if (this.childSelect) {
    this.childSelect.close();
  }

  // להריץ את כל הלוגיקה של שינוי ילד
  this.onChildChange();
}
selectFirstInstructorFromSearch(event: any): void {
  // לא לגלול / לא לסגור את הדרופ-דאון
  if (event?.preventDefault) {
    event.preventDefault();
  }
  if (event?.stopPropagation) {
    event.stopPropagation();
  }

  if (!this.filteredInstructors.length) {
    return;
  }

  const first = this.filteredInstructors[0];

  // בוחרים את המדריך הראשון מהרשימה המסוננת
  this.selectedInstructorId = first.instructor_uid;

  // סוגרים את הדרופ-דאון
  if (this.instructorSelect) {
    this.instructorSelect.close();
  }

  // מאפסים את שורת החיפוש ומחזירים את כל הרשימה
  this.instructorSearchTerm = '';
  this.filteredInstructors = [...this.instructors];

  // מריצים את הלוגיקה הרגילה של שינוי מדריך
  this.onInstructorChange();
}

async onChildSelected(): Promise<void> {
  // איפוס שורת החיפוש אחרי בחירה
  this.childSearchTerm = '';
  this.filteredChildren = [...this.children];

  // הלוגיקה הקיימת שלך
  await this.onChildChange();
}

  // =========================================
  //  שינוי ילד – טוען אישורים ומנקה מצבים
  // =========================================
 async onChildChange(): Promise<void> {
  // איפוס הודעות ומצבים ישנים
  this.clearUiHint('child');
  this.clearUiHint('instructor');
  this.clearUiHint('tab');
  this.clearUiHint('seriesCount');
  this.clearUiHint('payment');

  // איפוס נתונים של סדרות
  this.recurringSlots = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.calendarSlotsByDate = {};
  this.seriesCalendarDays = [];

  // איפוס נתוני השלמות
  this.makeupSlots = [];
  this.makeupCandidates = [];
  this.selectedMakeupCandidate = null;
  this.candidateSlots = [];
  this.candidateSlotsError = null;

  // איפוס אישורים (למרות שעכשיו לא משתמשים – שלא יישאר זבל ישן)
  this.approvals = [];
  this.selectedApprovalId = null;

  // איפוס בחירת מדריך בכל פעם שמחליפים ילד
  this.selectedInstructorId = null;
  this.showInstructorDetails = false;
  this.noInstructorPreference = false;

  // אם אין ילד – מנקים רשימת מדריכים ויוצאים
  if (!this.selectedChildId) {
    this.instructors = [];
    return;
  }

  // טוענים מדריכים מתאימים לילד שנבחר
  await this.loadInstructorsForChild(this.selectedChildId);

  // טוענים שיעורים שניתן להשלים עבור הילד
  await this.loadMakeupCandidatesForChild();
await this.loadOccupancyCandidatesForChild();   // 👈 חדש


  // בונים מחדש קלנדר לסדרות עבור החודש הנוכחי (ריק עד שהורה ילחץ "חפש סדרות זמינות")
  this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);
}
filterChildren(): void {
  const term = this.childSearchTerm.trim().toLowerCase();
  if (!term) {
    this.filteredChildren = [...this.children];
    return;
  }

  this.filteredChildren = this.children.filter(c =>
    `${c.first_name ?? ''} ${c.last_name ?? ''}`
      .toLowerCase()
      .includes(term)
  );
}

filterInstructors(): void {
  const term = this.instructorSearchTerm.trim().toLowerCase();
  if (!term) {
    this.filteredInstructors = [...this.instructors];
    return;
  }

  this.filteredInstructors = this.instructors.filter(ins =>
    `${ins.full_name ?? ''}`.toLowerCase().includes(term)
  );
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

     this.makeupCandidatesAll = (data ?? []) as MakeupCandidate[];  
this.applyInstructorFilterToLists();                     


    } finally {
      this.loadingMakeupCandidates = false;
    }
  }
private async loadOccupancyCandidatesForChild(): Promise<void> {
  if (!this.selectedChildId) return;

  this.loadingOccupancyCandidates = true;
  this.occupancyError = null;
  this.occupancyCandidates = [];

  try {
    const { data, error } = await dbTenant().rpc(
      'get_child_occupancy_candidates',
      { _child_id: this.selectedChildId }
    );

    
    if (error) {
      console.error('get_child_occupancy_candidates error', error);
      this.occupancyError = 'שגיאה בטעינת שיעורים למילוי מקום';
      return;
    }

    const raw = (data ?? []) as OccupancyCandidate[];

// העשרה בשם מדריך (כמו שיש לך)
const enriched = raw.map(o => {
  const ins = this.instructors.find(i =>
    i.instructor_id === o.instructor_id || i.instructor_uid === o.instructor_id
  );

  return { ...o, instructor_name: ins?.full_name ?? null };
});

this.occupancyCandidatesAll = enriched;
this.applyInstructorFilterToLists();

  } finally {
    this.loadingOccupancyCandidates = false;
  }
}
getInstructorNameById(id: string | null | undefined): string {
  if (!id) return '';
  const ins = this.instructors.find(i =>
    i.instructor_id === id || i.instructor_uid === id
  );
  return ins?.full_name ?? id; // fallback: ת"ז אם לא נמצא
}
showAvailableOccupancyLessons(o: OccupancyCandidate) {
  // navigation / dialog logic here
}

  // =========================================
  //   חיפוש סדרות זמינות (find_recurring_slots)
  // =========================================
async searchRecurringSlots(): Promise<void> {
  this.seriesError = null;
  this.seriesCreatedMessage = null;
  this.recurringSlots = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.calendarSlotsByDate = {};

  // ✅ מוצאים את הילד לפי child_uuid אמיתי מתוך this.children
  const child = this.children.find(c => c.child_uuid === this.selectedChildId);

  if (!this.selectedChildId || !child) {
    console.error('❌ selectedChildId is not a valid child_uuid:', this.selectedChildId, this.children);
    this.seriesError = 'יש לבחור ילד מתוך הרשימה';
    return;
  }

  if (!this.isOpenEndedSeries && !this.seriesLessonCount) {
  this.seriesError = 'יש לבחור כמות שיעורים בסדרה';
  return;
}


  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    this.seriesError = 'יש לבחור מדריך או לסמן שאין העדפה';
    return;
  }

  // ממירים ל-id_number אמיתי של המדריך
  let instructorParam: string | null = null;
  if (this.selectedInstructorId && this.selectedInstructorId !== 'any') {
    const sel = this.instructors.find(
      i =>
        i.instructor_uid === this.selectedInstructorId ||
        i.instructor_id  === this.selectedInstructorId
    );
    instructorParam = sel?.instructor_id ?? null;
  }

  const today = new Date();
  const fromDate = today.toISOString().slice(0, 10);
  // ✅ רגיל: 3 חודשים קדימה | ללא הגבלה: לפי series_search_horizon_days
  let toDate: string;
  if (this.isOpenEndedSeries) {
    const to = new Date();
    to.setDate(to.getDate() + (this.seriesSearchHorizonDays ?? 90));
    toDate = to.toISOString().slice(0, 10);
  } else {
    const to = new Date();
    to.setMonth(to.getMonth() + 3);
    toDate = to.toISOString().slice(0, 10);
  }
  const payload = {
    p_child_id: child.child_uuid,         
    p_lesson_count: this.seriesLessonCount,
    p_instructor_id_number: instructorParam,
    p_from_date: fromDate,
    p_to_date: toDate,
  };



  this.loadingSeries = true;

try {
  let data: any[] | null = null;
  let error: any = null;

  if (this.isOpenEndedSeries) {
    // 🔹 קריאה לפונקציה החדשה מה-DB
    const payloadUnlimited = {
      p_child_id: child.child_uuid,
      p_instructor_id_number: instructorParam,
      p_from_date: fromDate,
    };

    ({ data, error } = await dbTenant().rpc(
      'find_open_ended_series_slots_with_skips',
      payloadUnlimited
    ));
  } else {
    // 🔹 קריאה לפונקציה הישנה (עם כמות שיעורים)
    const payloadRegular = {
      p_child_id: child.child_uuid,
      p_lesson_count: this.seriesLessonCount,
      p_instructor_id_number: instructorParam,
      p_from_date: fromDate,
      p_to_date: toDate,
    };

    ({ data, error } = await dbTenant().rpc(
      'find_series_slots_with_skips',
      payloadRegular
    ));
  }

  if (error) {
    console.error(error);
    this.seriesError = 'שגיאה בחיפוש סדרות זמינות';
    return;
  }
  const raw = (data ?? []) as RecurringSlotWithSkips[];


// קודם ממיינים לפי תאריך ואז שעה ואז מדריך,
// כדי שה"ראשון בזמן" לכל תבנית יהיה באמת הראשון.
const sorted = [...raw].sort((a, b) => {
  const cmpDate = a.lesson_date.localeCompare(b.lesson_date);
  if (cmpDate !== 0) return cmpDate;

  const cmpTime = a.start_time.localeCompare(b.start_time);
  if (cmpTime !== 0) return cmpTime;

  return (a.instructor_id || '').localeCompare(b.instructor_id || '');
});

// כאן נשמור תבניות שכבר ראינו:
// key = instructor_id | weekday(0–6) | HH:MM
const seenPatterns = new Set<string>();
const filtered: RecurringSlotWithSkips[] = [];

for (const s of sorted) {
  const d = new Date(s.lesson_date + 'T00:00:00');
  const weekday = d.getDay();                  // 0=ראשון ... 6=שבת
  const startHHMM = s.start_time.substring(0, 5); // "11:00" מתוך "11:00:00"

  const patternKey = `${s.instructor_id}|${weekday}|${startHHMM}`;

  // אם כבר היה לפני זה אותו מדריך / אותו יום בשבוע / אותה שעה → מדלגים
  if (seenPatterns.has(patternKey)) {
    continue;
  }

  // אחרת – זו הפעם הראשונה לתבנית הזו → מוסיפים
  seenPatterns.add(patternKey);
  filtered.push(s);
}

this.recurringSlots = filtered.map(s => {
  const ins = this.instructors.find(i =>
    i.instructor_id === s.instructor_id ||
    i.instructor_uid === s.instructor_id
  );

  return {
    ...s,
    instructor_name: ins?.full_name ?? (s.instructor_id ?? undefined),
    // אם את רוצה תמיד מחרוזת:
    // instructor_name: ins?.full_name ?? (s.instructor_id ?? 'לא ידוע'),
  };
});

this.mapRecurringSlotsToCalendar();

    if (!this.recurringSlots.length) {
      this.seriesError = 'לא נמצאו זמנים מתאימים לסדרה בזמן הקרוב, נא לפנות למזכירות';
      return;
    }

    // קפיצה ליום הראשון הפנוי
    const first = [...this.recurringSlots].sort((a, b) =>
      a.lesson_date.localeCompare(b.lesson_date)
    )[0];

    if (first) {
      const d = new Date(first.lesson_date + 'T00:00:00');
      this.currentCalendarYear = d.getFullYear();
      this.currentCalendarMonth = d.getMonth();

      this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);

      this.selectedSeriesDate = first.lesson_date;
      this.selectedSeriesDaySlots =
        this.calendarSlotsByDate[first.lesson_date] ?? [];
    }
  } finally {
    this.loadingSeries = false;
  }
}

onSeriesLessonCountChange(val: number | null): void {
    this.clearUiHint('seriesCount');

  this.seriesLessonCount = val;

  // איפוס תצוגה קודמת
  this.recurringSlots = [];
  this.calendarSlotsByDate = {};
  this.seriesCalendarDays = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.seriesError = null;

  if (!val) {
    return;
  }

  // אם עדיין אין ילד נבחר – נחכה
  if (
    !this.selectedChildId ||
    !this.children.some(c => c.child_uuid === this.selectedChildId)
  ) {
    return;
  }

  // אם חייבים מדריך ולא נבחר – נחכה
  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    return;
  }

  // הכול מוכן – נריץ חיפוש
  this.searchRecurringSlots();
}

  // יצירת סדרה בפועל – insert ל-lessons (occurrences נוצרים מה-view)
  // יצירת סדרה בפועל – insert ל-lessons (occurrences נוצרים מה-view)
async createSeriesFromSlot(slot: RecurringSlotWithSkips ): Promise<void> {
  if (!this.selectedChildId) return;

  if (!this.seriesLessonCount) {
    this.seriesError = 'יש לבחור כמות שיעורים בסדרה לפני קביעת הסדרה';
    return;
  }

  // גם למזכירה חייב להיות מסלול תשלום
  if (!this.selectedPaymentPlanId) {
    this.seriesError = 'יש לבחור מסלול תשלום';
    return;
  }

  const approval = this.selectedApproval;
  if (!approval && this.paymentSourceForSeries === 'health_fund') {
    this.seriesError = 'לא נבחר אישור טיפול';
    return;
  }

  const baseCount = this.seriesLessonCount;

  const repeatWeeks =
    this.paymentSourceForSeries === 'health_fund' && approval
      ? Math.min(baseCount, Math.max(1, approval.remaining_lessons))
      : baseCount;

  // ⬅ יום ראשון של השבוע לפי תאריך השיעור הראשון
  const anchorWeekStart = this.calcAnchorWeekStart(slot.lesson_date);

  // ⬅ יום בשבוע מחושב מהתאריך (לא מ-seriesDayOfWeek הריק)
  const dayLabel = this.dayOfWeekLabelFromDate(slot.lesson_date);

  // ⬅ לוודא שאנחנו מכניסים id_number לפי ה־FK ולא uid
  let instructorIdNumber: string | null = null;

  if (this.selectedInstructorId && this.selectedInstructorId !== 'any') {
    const selected = this.instructors.find(i =>
      i.instructor_uid === this.selectedInstructorId ||
      i.instructor_id  === this.selectedInstructorId
    );
    instructorIdNumber = selected?.instructor_id ?? slot.instructor_id;
  } else {
    // "כל המדריכים" או לא נבחר – נשען על מה שחוזר מה-RPC
    instructorIdNumber = slot.instructor_id;
  }

  const { data, error } = await dbTenant()
    .from('lessons')
    .insert({
      child_id: this.selectedChildId,
      instructor_id: instructorIdNumber,
      lesson_type: 'סידרה',
      status: 'אושר',
      day_of_week: dayLabel,                // ⬅ עכשיו ערך תקין: "ראשון"/"שני"...
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

      // ⬅ ניו מסלול תשלום
      payment_plan_id: this.selectedPaymentPlanId,
      // payment_docs_url: ... // נוסיף כשנסגור לוגיקת העלאה גם למזכירה
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    this.seriesError = 'שגיאה ביצירת הסדרה';
    return;
  }
this.showSuccessToast('הסדרה נוצרה בהצלחה ✔️');
await this.onChildChange();

}


onReferralFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  this.referralUploadError = null;
  this.referralFile = null;

  if (!file) {
    return;
  }

  // בדיקת גודל (נניח עד 5MB)
  const maxSizeMb = 5;
  if (file.size > maxSizeMb * 1024 * 1024) {
    this.referralUploadError = `הקובץ גדול מדי (מעל ${maxSizeMb}MB)`;
    return;
  }

  // אפשר להוסיף כאן בדיקת סוג קובץ אם תרצי (pdf / image)
  this.referralFile = file;
}

   // =========================================
  //   חיפוש חורים להשלמות (find_makeup_slots)
  // =========================================

  // יצירת שיעור השלמה – יוצר lesson יחיד (repeat_weeks = 1)
  async bookMakeupSlot(slot: MakeupSlot): Promise<void> {
  if (!this.selectedChildId) return;

  const dayLabel = this.dayOfWeekLabelFromDate(slot.occur_date);
  const anchorWeekStart = this.calcAnchorWeekStart(slot.occur_date);

  // נחליט מה ה-id_number שנכניס לשיעור
  const instructorIdNumber =
    this.selectedInstructorId === 'any'
      ? slot.instructor_id
      : (
          this.instructors.find(i =>
            i.instructor_uid === this.selectedInstructorId || // uid
            i.instructor_id  === this.selectedInstructorId    // במקרה שכבר ת"ז
          )?.instructor_id ?? slot.instructor_id              // fallback
        );

  console.log('📌 booking makeup with instructorIdNumber:', instructorIdNumber);

  const { data, error } = await dbTenant()
    .from('lessons')
    .insert({
      child_id: this.selectedChildId,
      instructor_id: instructorIdNumber,  // ← שורה מתוקנת
      lesson_type: 'השלמה',
      status: 'אושר',
      day_of_week: dayLabel,
      start_time: slot.start_time,
      end_time: slot.end_time,
      repeat_weeks: 1,
      anchor_week_start: anchorWeekStart,
      appointment_kind: 'therapy_makeup',
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

async onMakeupSlotChosen(slot: MakeupSlot): Promise<void> {
  if (this.isSecretary) {
    // מזכירה – קובעת שיעור מיד
    await this.bookMakeupSlot(slot);
  } else {
    // הורה – שולח בקשה למזכירה (הפונקציה הקיימת שלך)
    await this.requestMakeupFromSecretary(slot);
  }
}

// בקשת שיעור השלמה מהמזכירה – מכניס גם ל-secretarial_requests וגם ל-lessons
async requestMakeupFromSecretary(slot: MakeupSlot): Promise<void> {
  if (!this.selectedChildId || !this.user || !this.selectedMakeupCandidate) {
    this.makeupError = 'חסר ילד או שיעור מקור להשלמה';
    return;
  }

  // מידע חדש
  this.confirmData.newDate  = slot.occur_date;
  this.confirmData.newStart = slot.start_time.substring(0, 5);
  this.confirmData.newEnd   = slot.end_time.substring(0, 5);

  // מידע של השיעור המקורי (הביטל/שאפשר להשלים אותו)
  this.confirmData.oldDate  = this.selectedMakeupCandidate.occur_date;
  this.confirmData.oldStart = this.selectedMakeupCandidate.start_time.substring(0, 5);
  this.confirmData.oldEnd   = this.selectedMakeupCandidate.end_time.substring(0, 5);

  // פתיחת דיאלוג אישור
  const dialogRef = this.dialog.open(this.confirmMakeupDialog, {
    width: '380px',
    disableClose: true,
    data: {},
  });

  dialogRef.afterClosed().subscribe(async confirmed => {
    if (!confirmed) return;

    this.makeupError = null;
    this.makeupCreatedMessage = null;

    const supa = dbTenant();

    // 👇 זה אמור להיות ה-UID של השיעור מתוך lesson_occurrence_exceptions (id)
    const lessonOccId = this.selectedMakeupCandidate!.lesson_id;

    // קודם נכניס בקשה למזכירה
    const payload = {
      requested_start_time: slot.start_time,
      requested_end_time: slot.end_time,

    };

    const { error: reqError } = await supa
      .from('secretarial_requests')
      .insert({
        request_type: 'MAKEUP_LESSON',
        requested_by_uid: String(this.user!.uid),
        requested_by_role: 'parent',
        child_id: this.selectedChildId,
        instructor_id: slot.instructor_id,
        lesson_occ_id: lessonOccId,
        from_date: slot.occur_date,
        to_date: slot.occur_date,
        payload,
      });

    if (reqError) {
      console.error(reqError);
      this.makeupError = 'שגיאה בשליחת הבקשה למזכירה';
      return;
    }

const excId = this.selectedMakeupCandidate!.lesson_occ_exception_id;

const { error: updErr } = await supa
  .from('lesson_occurrence_exceptions')
  .update({ status: 'נשלחה בקשה להשלמה' })
  .eq('id', excId);

if (updErr) {
  console.error('lesson_occurrence_exceptions update error (MAKEUP)', updErr);
}

    // יום בשבוע לפי תאריך ההשלמה
    const dayLabel = this.dayOfWeekLabelFromDate(slot.occur_date);

    // בחירת ת"ז מדריך: אם נבחר מדריך ספציפי – לקחת ממנו את ה-id_number,
    // אם לא – להשתמש ב-id שמגיע מה-slot (כמו מה-RPC)
    const instructorIdNumber =
      this.selectedInstructorId === 'any'
        ? slot.instructor_id
        : (
            this.instructors.find(i =>
              i.instructor_uid === this.selectedInstructorId ||  // uid
              i.instructor_id  === this.selectedInstructorId     // כבר ת"ז
            )?.instructor_id ?? slot.instructor_id               // fallback
          );

    // לפי הדרישה שלך: anchor_week_start = תאריך השיעור עצמו
    const anchorDate = slot.occur_date;
const baseLessonUid = this.selectedMakeupCandidate!.lesson_occ_exception_id ?? null;

    // const { error: lessonError } = await supa
    //   .from('lessons')
    //   .insert({
    //     lesson_type: 'השלמה',              // ⬅️ lesson_type = השלמה
    //     day_of_week: dayLabel,             // ⬅️ יום בשבוע מהתאריך
    //     start_time: slot.start_time,
    //     end_time: slot.end_time,
    //     instructor_id: instructorIdNumber, // ⬅️ ת"ז של המדריך
    //     status: 'ממתין לאישור',           // ⬅️ בהתאם ל-CHECK בטבלה
    //     child_id: this.selectedChildId,    // ⬅️ ה-UUID של הילד
    //     repeat_weeks: 1,                   // ⬅️ תמיד 1
    //     anchor_week_start: anchorDate,     // ⬅️ תאריך השיעור השלמה
    //     appointment_kind: 'therapy_makeup',// ⬅️ סוג התור
    //     origin: 'parent',                  // ⬅️ מקור: הורה
    //     base_lesson_uid: baseLessonUid,      // ⬅️ קישור ל-lesson_occurrence_exceptions.id
    //     capacity: 1,
    //     current_booked: 1,
    //     payment_source: 'private',         // אם תרצי – אפשר לשנות ללוגיקה של קופה/פרטי
    //   });

    // if (lessonError) {
    //   console.error(lessonError);
    //   this.makeupError = 'שגיאה בשמירת שיעור ההשלמה במערכת';
    //   return;
    // }

    this.makeupCreatedMessage =
      'בקשת ההשלמה נשלחה למזכירה ✔️';
this.makeupCandidates = this.makeupCandidates.filter(x => !this.sameCandidate(x, this.selectedMakeupCandidate!));
this.selectedMakeupCandidate = null;
this.candidateSlots = [];

    // רענון הנתונים למסך (שיעורים שניתן להשלים, חורים, וכו')
    await this.onChildChange();
  });
}

get isSecretary(): boolean {
  return this.user?.role === 'secretary';
}

async onSeriesSlotChosen(slot: RecurringSlotWithSkips , dialogTpl: TemplateRef<any>): Promise<void> {
  if (this.isSecretary) {
    // מזכירה – קובעת מיד, בלי בקשה
    await this.createSeriesFromSlot(slot);
  } else {
    // הורה – בקשה למזכירה כרגיל
    await this.requestSeriesFromSecretary(slot, dialogTpl);
  }
}


async requestSeriesFromSecretary(slot: RecurringSlotWithSkips , dialogTpl: TemplateRef<any>): Promise<void> {
   if (!this.selectedChildId || !this.user) {
    this.seriesError = 'חסר ילד או משתמש מחובר';
    return;
  }

  if (!this.isOpenEndedSeries && !this.seriesLessonCount) {
  this.seriesError = 'חסר מספר שיעורים בסדרה';
  return;
}

  if (!this.selectedPaymentPlanId) {
    this.seriesError = 'יש לבחור מסלול תשלום';
    return;
  }

  const plan = this.selectedPaymentPlan!;
  if (plan.require_docs_at_booking && !this.referralFile) {
    this.seriesError = 'למסלול שנבחר נדרש מסמך מצורף';
    return;
  }

  // ---- חישוב תאריכים ----
  console.log('CLICKED slot', {
  lesson_date: slot.lesson_date,
  start: slot.start_time,
  end: slot.end_time,
  instr: slot.instructor_id,
  skippedFarm: slot.skipped_farm_days_off,
  skippedInstr: slot.skipped_instructor_unavailability,
});

  console.log('slot keys:', Object.keys(slot as any));
console.log('slot raw:', slot);

console.log('skipped farm:', (slot as any)?.skipped_farm_days_off);
console.log('skipped instr:', (slot as any)?.skipped_instructor_unavailability);

const startDate = slot.lesson_date;

let endDate: string;

if (this.isOpenEndedSeries) {
  // בדיאלוג אין צורך "עד תאריך", אבל אם את רוצה עדיין להציג "טווח בדיקה"
  const endD = new Date(startDate + 'T00:00:00');
  endD.setDate(endD.getDate() + this.seriesSearchHorizonDays);
  endDate = this.formatLocalDate(endD);
} else {
  const skipsCount =
    (slot.skipped_farm_days_off?.length ?? 0) +
    (slot.skipped_instructor_unavailability?.length ?? 0);

  const totalWeeksForward = (this.seriesLessonCount! - 1) + skipsCount;

  const endD = new Date(startDate + 'T00:00:00');
  endD.setDate(endD.getDate() + totalWeeksForward * 7);
  endDate = this.formatLocalDate(endD);
}
// ---- פרטי מדריך ----
let instructorIdNumber: string | null = null;
let instructorName = '';

if (this.selectedInstructorId && this.selectedInstructorId !== 'any') {
  // נבחר מדריך ספציפי בדרופדאון
  const selected = this.instructors.find(
    i =>
      i.instructor_uid === this.selectedInstructorId ||
      i.instructor_id === this.selectedInstructorId
  );

  instructorIdNumber = selected?.instructor_id ?? slot.instructor_id ?? null;
  instructorName = selected?.full_name ?? '';
} else {
  // "כל המדריכים" / לא נבחר ספציפית – השם צריך להגיע מה-slot.instructor_id (שהוא id_number)
  instructorIdNumber = slot.instructor_id ?? null;

  const ins = this.instructors.find(i => i.instructor_id === instructorIdNumber);
  instructorName = ins?.full_name ?? 'ללא העדפה';
}


  const dayLabel = this.getSlotDayLabel(startDate);
  const startTime = slot.start_time.substring(0, 5);
  const endTime = slot.end_time.substring(0, 5);

  this.seriesConfirmData = {
    startDate,
    endDate,
    dayLabel,
    startTime,
    endTime,
    instructorName
  };

  const dialogRef = this.dialog.open(dialogTpl, {
    width: '380px',
    disableClose: true,
    data: {},
  });

  dialogRef.afterClosed().subscribe(async confirmed => {
    if (!confirmed) return;

    this.seriesError = null;

    const supa = dbTenant();

   let referralUrl: string | null = null;

if (this.referralFile) {
  try {
    const ext = this.referralFile.name.split('.').pop() || 'bin';
    const filePath = `referrals/${this.selectedChildId}/${Date.now()}.${ext}`;

    // ⬅ כאן משתמשים ב-supabase ולא ב-dbTenant()
    const { data: uploadData, error: uploadError } = await supabase!
      .storage
      .from('referrals')
      .upload(filePath, this.referralFile);

    if (uploadError) {
      console.error('referral upload error', uploadError);
      this.seriesError = 'שגיאה בהעלאת המסמך. אפשר לנסות שוב או להמשיך ללא מסמך.';
    } else {
      const { data: publicData } = supabase!
        .storage
        .from('referrals')
        .getPublicUrl(filePath);

      referralUrl = publicData?.publicUrl ?? null;
    }
  } catch (e) {
    console.error('referral upload exception', e);
    this.seriesError = 'שגיאה בהעלאת המסמך. אפשר לנסות שוב או להמשיך ללא מסמך.';
  }
}
   

  const payload: any = {
  requested_start_time: startTime,
  // requested_end_time: endTime,
  is_open_ended: this.isOpenEndedSeries,
  series_search_horizon_days: this.seriesSearchHorizonDays,

  skipped_farm_dates: (slot.skipped_farm_days_off ?? []).map(String),
  skipped_instructor_dates: (slot.skipped_instructor_unavailability ?? []).map(String),
};


    if (referralUrl) {
      payload.referral_url = referralUrl;
    }

  const { error } = await supa
  .from('secretarial_requests')
  .insert({
    request_type: 'NEW_SERIES',
    status: 'PENDING',
    requested_by_uid: String(this.user!.uid),
    requested_by_role: 'parent',
    child_id: this.selectedChildId,
    instructor_id: instructorIdNumber,
    from_date: startDate,
    to_date: endDate,
    payload
  });
if (error) {
  console.error(error);
  this.seriesError = 'שגיאה בשליחת בקשת הסדרה';
  this.showErrorToast(this.seriesError);
  return;
}

// מרעננים
await this.onChildChange();

// מנקים קובץ
this.referralFile = null;

// הודעת הצלחה “נראית”
this.showSuccessToast('בקשתך נשלחה למזכירה ✔️');

this.selectedTab = 'series';

  
  });
}

  // =========================================
  //           עזרי תאריכים / ימים
  // =========================================
  private dayOfWeekLabel(value: number): string {
    return this.daysOfWeek.find(d => d.value === value)?.label ?? '';
  }

  dayOfWeekLabelFromDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0–6 לפי הזמן המקומי
  return this.dayOfWeekLabel(dow);
}
getSlotDayLabel(dateStr: string): string {
  return this.dayOfWeekLabelFromDate(dateStr);
}
private formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
    private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
private buildSeriesCalendar(year: number, month: number): void {
  const firstDay = new Date(year, month, 1);
  const firstDow = firstDay.getDay(); // 0=Sunday ... 6=Saturday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: SeriesCalendarDay[] = [];

  // ריבועים ריקים לפני היום הראשון של החודש
  for (let i = 0; i < firstDow; i++) {
    days.push({
      date: '',
      label: null,
      isCurrentMonth: false,
      hasSlots: false,
    });
  }

  // הימים עצמם
  for (let day = 1; day <= daysInMonth; day++) {
    const yyyy = String(year);
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    days.push({
      date: dateStr,
      label: day,
      isCurrentMonth: true,
      hasSlots: !!this.calendarSlotsByDate[dateStr]?.length,
    });
  }

  this.seriesCalendarDays = days;
}
private mapRecurringSlotsToCalendar(): void {
  this.calendarSlotsByDate = {};

  for (const slot of this.recurringSlots) {
    const date = slot.lesson_date; // YYYY-MM-DD
    if (!this.calendarSlotsByDate[date]) {
      this.calendarSlotsByDate[date] = [];
    }
    this.calendarSlotsByDate[date].push(slot);
  }

  // אחרי שמיפינו מחדש – לבנות את הקלנדר לחודש הנוכחי
  this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);
}
goToPrevMonth(): void {
  if (this.currentCalendarMonth === 0) {
    this.currentCalendarMonth = 11;
    this.currentCalendarYear -= 1;
  } else {
    this.currentCalendarMonth -= 1;
  }
  this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);
}

goToNextMonth(): void {
  if (this.currentCalendarMonth === 11) {
    this.currentCalendarMonth = 0;
    this.currentCalendarYear += 1;
  } else {
    this.currentCalendarMonth += 1;
  }
  this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);
}
onSeriesCalendarDayClick(day: SeriesCalendarDay): void {
  if (!day.isCurrentMonth || !day.date || !day.hasSlots) return;

  this.selectedSeriesDate = day.date;
  this.selectedSeriesDaySlots = this.calendarSlotsByDate[day.date] ?? [];
}
get canChooseSeriesCount(): boolean {
  // חייבים ילד
  if (!this.selectedChildId) return false;

  // אם חייבים מדריך ואין העדפה כלל – חובה שייבחר מדריך
  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    return false;
  }

  // אחרת מותר לבחור כמות שיעורים
  return true;
}
get canRequestSeries(): boolean {
  if (!this.selectedChildId) return false;
  if (!this.hasSeriesCountOrOpenEnded) return false;
  if (!this.selectedPaymentPlanId) return false;

  if (this.selectedPaymentPlan?.require_docs_at_booking && !this.referralFile) {
    return false;
  }
  return true;
}



getLessonTypeLabel(slot: MakeupSlot): string {
    return slot.riding_type_name ?? 'שיעור';

  // switch (slot.lesson_type_mode) {
  //   case 'both':
  //     return 'זוגי'
  //   case 'double or both':
  //     return 'זוגי';
  //   default:
  //     return 'יחיד';
  // }
}
// private async loadOccupancySlotsForCandidate(
//   cand: OccupancyCandidate
// ): Promise<void> {
//   this.loadingOccupancySlots = true;
//   this.occupancySlotsError = null;
//   this.occupancySlots = [];
//   this.selectedOccupancySlot = null;

//   try {
//     // טווח חיפוש – אפשר לשנות, לדוגמה 30 ימים קדימה
//     const fromDate = cand.occur_date;
//     const toDate = this.addDays(cand.occur_date, 30);

//     const { data, error } = await dbTenant().rpc(
//       'find_makeup_slots_for_lesson_by_id_number',
//       {
//         p_instructor_id: cand.instructor_id, // id_number של המדריך
//         p_from_date: fromDate,
//         p_to_date: toDate,
//       }
//     );
//     if (error) {
//       console.error('find_makeup_slots_for_lesson_by_id_number error', error);
//       this.occupancySlotsError = 'שגיאה בחיפוש שיעורים למילוי מקום';
//       return;
//     }

//     let slots = (data ?? []) as MakeupSlot[];

//     // אם את רוצה להגביל לכמות מקסימלית כמו ב־displayedMakeupLessonsCount:
//     if (
//       this.displayedMakeupLessonsCount != null &&
//       this.displayedMakeupLessonsCount > 0
//     ) {
//       slots = slots.slice(0, this.displayedMakeupLessonsCount);
//     }

//     this.occupancySlots = slots;
// const rangeDays = this.timeRangeOccupancyRateDays ?? 30;

//     if (!this.occupancySlots.length) {
// this.occupancySlotsError =
//   `לא נמצאו שיעורים פנויים למילוי מקום בטווח של ${rangeDays} ימים ` +
//   `מתאריך השיעור המקורי.`;
//     }
//   } finally {
//     this.loadingOccupancySlots = false;
//   }
// }
async openOccupancySlotsForCandidate(c: OccupancyCandidate): Promise<void> {
    console.log('[openOccupancySlotsForCandidate] clicked', c);

  if (!this.selectedChildId) {
    this.occupancyError = 'יש לבחור ילד';
    return;
  }

  this.selectedOccupancyCandidate = c;
  this.occupancySlots = [];
  this.occupancySlotsError = null;
  this.occupancyError = null;

 const lessonDate = c.occur_date;

const from = this.startOfWeekSunday(lessonDate);          // ראשון של אותו שבוע
const dow  = this.getDowSunday0(lessonDate);              // 0=ראשון ... 6=שבת
const to   = this.addDays(from, 7 + dow);                 // אותו יום בשבוע הבא


const instructorParam = this.getSelectedInstructorIdNumberOrNull();
// null => "כל המדריכים", לא null => המדריך שנבחר בדרופדאון

  this.loadingOccupancySlots = true;
  try {
    const { data, error } = await dbTenant().rpc(
      'find_makeup_slots_week_to_week',
      {
        p_instructor_id: instructorParam,
        p_lesson_date: c.occur_date,

      }
    );
const rangeDays = this.timeRangeOccupancyRateDays ?? 30;

  
    if (error) {
      console.error('find_makeup_slots_week_to_week error (occupancy)', error);
      this.occupancySlotsError =    `לא נמצאו שיעורים פנויים למילוי מקום בטווח השבועי (מיום ראשון של אותו שבוע ועד אותו יום בשבוע הבא).`;
      return;
    }

    let slots = (data ?? []) as MakeupSlot[];

    if (this.displayedMakeupLessonsCount != null && this.displayedMakeupLessonsCount > 0) {
      slots = slots.slice(0, this.displayedMakeupLessonsCount);
    }

    this.occupancySlots = slots;

    if (!this.occupancySlots.length) {
this.occupancySlotsError =
  `לא נמצאו שיעורים פנויים למילוי מקום בטווח של ${rangeDays} ימים ` +
  `מתאריך השיעור המקורי.`;
    }
  } finally {
    this.loadingOccupancySlots = false;
  }
}
private sameCandidate(a: { lesson_id: string; occur_date: string }, b: { lesson_id: string; occur_date: string }) {
  return a.lesson_id === b.lesson_id && a.occur_date === b.occur_date;
}
private toDateOnly(d: string | Date): Date {
  // אם מגיע מה-DB כ-YYYY-MM-DD – זה הכי בטוח
  return (d instanceof Date) ? new Date(d.getFullYear(), d.getMonth(), d.getDate())
                            : new Date(d + 'T00:00:00');
}

// 0=Sunday ... 6=Saturday
private getDowSunday0(d: string | Date): number {
  return this.toDateOnly(d).getDay();
}

private startOfWeekSunday(d: string | Date): string {
  const dt = this.toDateOnly(d);
  const dow = dt.getDay(); // 0=Sun
  dt.setDate(dt.getDate() - dow); // חזרה ליום ראשון
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD
}

// private addDays(dateStr: string, days: number): string {
//   const dt = new Date(dateStr + 'T00:00:00');
//   dt.setDate(dt.getDate() + days);
//   return dt.toISOString().slice(0, 10);
// }


selectOccupancySlot(slot: MakeupSlot): void {
  this.selectedOccupancySlot = slot;
}
async selectAndRequestOccupancySlot(slot: MakeupSlot): Promise<void> {
  if (!this.selectedChildId || !this.user || !this.selectedOccupancyCandidate) {
    this.occupancyError = 'חסר ילד או שיעור מילוי מקום שנבחר';
    return;
  }

  // נתוני השיעור החדש (מילוי מקום)
  this.occupancyConfirmData.newDate  = slot.occur_date;
  this.occupancyConfirmData.newStart = slot.start_time.substring(0, 5);
  this.occupancyConfirmData.newEnd   = slot.end_time.substring(0, 5);
  this.occupancyConfirmData.newInstructorName =
    slot.instructor_name || this.selectedInstructor?.full_name || slot.instructor_id;

  // נתוני השיעור המקורי שבוטל – מתוך ה-candidate שנבחר
  const orig = this.selectedOccupancyCandidate;
// נניח שיש לך:
const c = this.selectedOccupancyCandidate!;

// שם המדריך הישן (זה שביטל את השיעור)
const oldInstructorName =
  c.instructor_name ||               // אם יש שם מלא
  c.instructor_id  ||               // אחרת ניפול לת"ז
  '';

// שם המדריך החדש (של שיעור המילוי מקום)
const newInstructorName =
  slot.instructor_name ||           // אם חישבנו שם מלא ב-RPC
  slot.instructor_id  ||           // fallback לת"ז
  '';

this.occupancyConfirmData.oldInstructorName = oldInstructorName;
this.occupancyConfirmData.newInstructorName = newInstructorName;

  this.occupancyConfirmData.oldDate  = orig.occur_date;
  this.occupancyConfirmData.oldStart = orig.start_time.substring(0, 5);
  this.occupancyConfirmData.oldEnd   = orig.end_time.substring(0, 5);
  
  const dialogRef = this.dialog.open(this.confirmOccupancyDialog, {
    width: '380px',
    disableClose: true,
    data: {},
  });

  dialogRef.afterClosed().subscribe(async confirmed => {
    if (!confirmed) return;

    this.occupancyError = null;
    this.occupancyCreatedMessage = null;

    const supa = dbTenant();

    // ה-UID של השיעור המקורי אותו משלימים (מתוך ה-view)
    const lessonOccId = this.selectedOccupancyCandidate!.lesson_id;
    // אם ה-view מחזיר lesson_occ_exception_id שאת רוצה להשתמש בו, תחליפי כאן.

    const payload = {
      requested_start_time: slot.start_time,
      requested_end_time: slot.end_time,
    };

    const { error } = await supa
      .from('secretarial_requests')
      .insert({
        request_type: 'FILL_IN',
        status: 'PENDING',
        requested_by_uid: String(this.user!.uid),
        requested_by_role: 'parent',
        child_id: this.selectedChildId,
        instructor_id: slot.instructor_id,      // המדריך של השיעור החדש
        lesson_occ_id: lessonOccId,             // השיעור המקורי (view)
        from_date: slot.occur_date,
        to_date: slot.occur_date,
        payload,
      });

    if (error) {
      console.error('FILL_IN request error', error);
      this.occupancyError = 'שגיאה בשליחת בקשת מילוי מקום למזכירה';
      return;
    }
const excId = this.selectedOccupancyCandidate!.lesson_occ_exception_id;

const { error: updErr } = await supa
  .from('lesson_occurrence_exceptions')
  .update({ status: 'נשלחה בקשה למילוי מקום' })
  .eq('id', excId);

if (updErr) {
  console.error('lesson_occurrence_exceptions update error (FILL_IN)', updErr);
  // לא חייבים להפיל הכל – אבל כן להציג הודעה אם תרצי
}

    this.occupancyCreatedMessage =
      'בקשת מילוי המקום נשלחה למזכירה ✔️';
      this.occupancyCandidates = this.occupancyCandidates.filter(x => !this.sameCandidate(x, this.selectedOccupancyCandidate!));
this.selectedOccupancyCandidate = null;
this.occupancySlots = [];


    // אם את רוצה – לרענן את השיעורים שמחפשים מילוי מקום
    //await this.onChildChange();
  });
}

async requestOccupancyFromSecretary(slot: any): Promise<void> {
  const { error } = await dbTenant().rpc('request_occupancy_lesson', {
    p_child_id: this.selectedChildId,
    p_instructor_id: slot.instructor_id,
    p_occur_date: slot.occur_date,
    p_start_time: slot.start_time,
    p_end_time: slot.end_time
  });

  if (error) {
    console.error('request_occupancy_lesson error:', error);
    throw error;
  }
}

uiHint: Record<string, string | null> = {};
private uiHintTimers: Record<string, any> = {};

showUiHint(key: string, msg: string, ms = 3500) {
  if (this.uiHintTimers[key]) clearTimeout(this.uiHintTimers[key]);
  this.uiHint[key] = msg;
  this.uiHintTimers[key] = setTimeout(() => {
    this.uiHint[key] = null;
    delete this.uiHintTimers[key];
  }, ms);
}
clearUiHint(key: string) {
  if (this.uiHintTimers[key]) {
    clearTimeout(this.uiHintTimers[key]);
    delete this.uiHintTimers[key];
  }
  this.uiHint[key] = null;
}

get missingChildMsg() {
  return 'יש לבחור ילד/ה קודם';
}

get missingInstructorMsg() {
  return !this.selectedChildId ? 'יש לבחור ילד/ה לפני בחירת מדריך' : '';
}


get missingSeriesCountMsg() {
  if (!this.selectedChildId) return 'יש לבחור ילד/ה לפני בחירת כמות שיעורים';
  if (!this.selectedInstructorId) return 'יש לבחור מדריך לפני בחירת כמות שיעורים';
  return '';
}

get missingPaymentPlanMsg() {
  if (!this.selectedChildId) return 'יש לבחור ילד/ה לפני בחירת מסלול תשלום';
  if (!this.selectedInstructorId) return 'יש לבחור מדריך לפני בחירת מסלול תשלום';
  if (!this.hasSeriesCountOrOpenEnded) return 'יש לבחור כמות שיעורים או לסמן "ללא הגבלה" לפני מסלול תשלום';
  return '';
}



get paymentLocked(): boolean {
  return !this.selectedChildId || !this.selectedInstructorId || !this.hasSeriesCountOrOpenEnded;
}


get tabsLocked(): boolean {
  return !this.selectedChildId || !this.selectedInstructorId;
}

get missingTabMsg(): string {
  if (!this.selectedChildId) return 'יש לבחור ילד/ה לפני בחירת טאב';
  if (!this.selectedInstructorId) return 'יש לבחור מדריך (או "כל המדריכים") לפני בחירת טאב';
  return '';
}

onTabClick(tab: 'series' | 'makeup' | 'occupancy') {
  if (this.tabsLocked) {
    this.showUiHint('tab', this.missingTabMsg);
    return;
  }
    this.clearUiHint('tab');

  this.selectedTab = tab;
}
onOpenEndedSeriesToggle(checked: boolean): void {
  this.isOpenEndedSeries = checked;

  // אם בחרו "ללא הגבלה" – לא צריך מספר
  if (checked) {
    this.seriesLessonCount = null;
  }

  // איפוס תצוגה קודמת
  this.recurringSlots = [];
  this.calendarSlotsByDate = {};
  this.seriesCalendarDays = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.seriesError = null;

  // אם הכל מוכן – תריצי חיפוש (לפונקציה המתאימה)
  if (this.selectedChildId && (this.noInstructorPreference || this.selectedInstructorId)) {
    this.searchRecurringSlots();
  }
}

onUnlimitedSeriesToggle(): void {
    this.clearUiHint('seriesCount');

  // אם סימנו ללא הגבלה – מבטלים כמות
  if (this.isOpenEndedSeries) {
    this.seriesLessonCount = null;
  }

  // איפוס תצוגה
  this.recurringSlots = [];
  this.calendarSlotsByDate = {};
  this.seriesCalendarDays = [];
  this.selectedSeriesDate = null;
  this.selectedSeriesDaySlots = [];
  this.seriesError = null;

  // אם יש תנאים בסיסיים – להריץ חיפוש
  if (
    this.selectedChildId &&
    (this.noInstructorPreference || this.selectedInstructorId) // יש מדריך או אין העדפה
  ) {
    this.searchRecurringSlots();
  }
}
private isSameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * dateStr: 'YYYY-MM-DD'
 * startTime: 'HH:mm' או 'HH:mm:ss'
 * מחזיר true אם זה "היום" והשעה כבר עברה/שווה לעכשיו
 */
isPastSeriesSlot(dateStr: string, startTime: string): boolean {
  if (!dateStr || !startTime) return false;

  const now = new Date();

  // בונים תאריך לוקאלי (לא UTC)
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const [hh, mi] = startTime.slice(0, 5).split(':').map(Number);

  const slotStart = new Date(yy, mm - 1, dd, hh, mi, 0, 0);

  // אם זה לא היום — לא חוסמים
  if (!this.isSameLocalDate(slotStart, now)) return false;

  // אם זה היום — חוסמים כל מה ש<= עכשיו
  return slotStart.getTime() <= now.getTime();
}
private showSuccessToast(message: string) {
  this.snackBar.open(message, 'סגירה', {
    duration: 4500,
    verticalPosition: 'top',
    horizontalPosition: 'center',
    direction: 'rtl',
    panelClass: ['appt-snackbar-success'],
  });
}

private showErrorToast(message: string) {
  this.snackBar.open(message, 'סגירה', {
    duration: 5500,
    verticalPosition: 'top',
    horizontalPosition: 'center',
    direction: 'rtl',
    panelClass: ['appt-snackbar-error'],
  });
}
onPaymentPlanChange(planId: string | null) {
    this.clearUiHint('payment');

  this.selectedPaymentPlanId = planId;

  const plan = this.paymentPlans.find(p => p.id === planId);

  if (!plan?.require_docs_at_booking) {
    // ❗ מנקים קובץ כי הוא לא רלוונטי יותר
    this.referralFile = null;
    this.referralUploadError = null;
  }
}


}

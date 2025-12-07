import { Component, Input, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, fetchMyChildren , supabase } from '../services/supabaseClient.service';
import { AppointmentMode, AppointmentTab, ChildRow, CurrentUser , InstructorRow } from '../Types/detailes.model';
import { CurrentUserService } from '../core/auth/current-user.service';
import { ActivatedRoute } from '@angular/router';
import { SELECTION_LIST } from '@angular/material/list';
import { MatDialog } from '@angular/material/dialog';
import { ViewChild, TemplateRef } from '@angular/core';
//import { console } from 'inspector';


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

interface RecurringSlot {
  lesson_date: string;   // YYYY-MM-DD
  start_time: string;    // HH:MM:SS
  end_time: string;      // HH:MM:SS
  instructor_id: string; // text
  instructor_name?: string | null; 

}

interface MakeupSlot {
 // lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  remaining_capacity: number;
  instructor_name?: string | null; 

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
calendarSlotsByDate: Record<string, RecurringSlot[]> = {};

// בחירת יום בקלנדר
selectedSeriesDate: string | null = null;
selectedSeriesDaySlots: RecurringSlot[] = [];


  @ViewChild('confirmMakeupDialog') confirmMakeupDialog!: TemplateRef<any>;

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
  private route: ActivatedRoute,
    private dialog: MatDialog

  
)
 {
  this.user = this.currentUser.current;
}

  async ngOnInit(): Promise<void> {
  // 1. קריאת פרמטרים מה־URL
  const qp = this.route.snapshot.queryParamMap;
    await this.loadFarmSettings();


  const needApproveParam = qp.get('needApprove');
  this.needApprove = needApproveParam === 'true';

  const qpChildId = qp.get('childId');
  if (qpChildId) {
    this.selectedChildId = qpChildId;    // ⬅⬅ שומרים את הילד שעבר בניווט
  }

  //await this.loadInstructors();

  // 2. תמיד טוענים ילדים פעילים מהשרת (RLS יטפל בהורה/מזכירה)
  await this.loadChildrenFromCurrentUser();
    this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);

}

// async openHolesForCandidate(c: MakeupCandidate): Promise<void> {
//   if (!this.selectedChildId) {
//     this.candidateSlotsError = 'יש לבחור ילד';
//     return;
//   }

//   this.selectedMakeupCandidate = c;
//   this.candidateSlots = [];
//   this.candidateSlotsError = null;

//   // קביעה איזה מדריך לשלוח:
//   let instructorParam: string | null = null;

//   if (this.selectedInstructorId) {
//     if (this.selectedInstructorId === 'any') {
//       instructorParam = null; // כל המדריכים המתאימים
//     } else {
//       instructorParam = this.selectedInstructorId; // מדריך ספציפי
//     }
//   } else if (c.instructor_id) {
//     instructorParam = c.instructor_id; // ברירת מחדל: המדריך של השיעור המקורי
//   }

//   this.loadingCandidateSlots = true;
//     try {
//     const { data, error } = await dbTenant().rpc('find_makeup_slots_for_lesson', {
//       p_child_id: this.selectedChildId,
//       p_lesson_id: c.lesson_id,
//       p_occur_date: c.occur_date,
//       p_instructor_id: instructorParam
//     });

//     if (error) {
//       console.error('find_makeup_slots_for_lesson error', error);
//       this.candidateSlotsError = 'שגיאה בחיפוש חורים להשלמה לשיעור זה';
//       return;
//     }

//     const rawSlots = (data ?? []) as MakeupSlot[];

//     // מייצרים שיעורים של שעה מתוך כל חור
//     const expanded: MakeupSlot[] = [];

//     for (const hole of rawSlots) {
//       const oneHourSlots = this.generateLessonSlots(hole.start_time, hole.end_time);

//       for (const s of oneHourSlots) {
//         expanded.push({
//           ...hole,
//           start_time: s.from + ':00', // "08:00:00"
//           end_time:   s.to   + ':00', // "09:00:00"
//         });
//       }
//     }

//     // חיתוך לפי הגדרת החווה displayed_makeup_lessons_count
//     let finalSlots = expanded;

//     if (this.displayedMakeupLessonsCount != null && this.displayedMakeupLessonsCount > 0) {
//       finalSlots = expanded.slice(0, this.displayedMakeupLessonsCount);
//     }

//     this.candidateSlots = finalSlots;

//   } finally {
//     this.loadingCandidateSlots = false;
//   }

// }
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
  this.makeupSearchToDate = this.addDays(c.occur_date, 30); // לדוגמה: 30 יום קדימה

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


  console.log('🔍 find_makeup_slots_for_lesson params:', {
    p_instructor_id: instructorParam,
    p_from_date: this.makeupSearchFromDate,
    p_to_date: this.makeupSearchToDate,
  });

  this.loadingCandidateSlots = true;
  this.candidateSlotsError = null;

  try {
    const { data, error } = await dbTenant().rpc('find_makeup_slots_for_lesson_by_id_number', {
  p_instructor_id: instructorParam,
  p_from_date: this.makeupSearchFromDate,
  p_to_date: this.makeupSearchToDate,
});




    console.log('🔍 find_makeup_slots_for_lesson result:', { error, rows: data?.length });

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


private async loadFarmSettings(): Promise<void> {
  const supa = dbTenant();

  const { data, error } = await supa
    .from('farm_settings')
    .select('displayed_makeup_lessons_count')
    .limit(1)
    .single();

  if (error) {
    console.error('loadFarmSettings error', error);
    return;
  }

  this.displayedMakeupLessonsCount = data?.displayed_makeup_lessons_count ?? null;
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
  this.showInstructorDetails = this.selectedInstructorId !== 'any';

  // אם כבר נבחר שיעור להשלמה – נטען מחדש את החורים עבור המדריך החדש
  if (this.selectedMakeupCandidate && this.makeupSearchFromDate && this.makeupSearchToDate) {
    await this.loadCandidateSlots();
  }
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


  this.loadingInstructors = false;
}

  // =========================================
  //  שינוי ילד – טוען אישורים ומנקה מצבים
  // =========================================
 async onChildChange(): Promise<void> {
  // איפוס הודעות ומצבים ישנים
  this.seriesError = null;
  this.makeupError = null;
  this.seriesCreatedMessage = null;
  this.makeupCreatedMessage = null;

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

  // בונים מחדש קלנדר לסדרות עבור החודש הנוכחי (ריק עד שהורה ילחץ "חפש סדרות זמינות")
  this.buildSeriesCalendar(this.currentCalendarYear, this.currentCalendarMonth);
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
console.log('🔍 get_child_makeup_candidates RPC:', {
      child: this.selectedChildId,
      error,
      rows: data?.length,
      sample: data?.[0]
    });

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

  if (!this.seriesLessonCount) {
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
  const to = new Date();
  to.setMonth(to.getMonth() + 3); // 3 חודשים קדימה
  const toDate = to.toISOString().slice(0, 10);

  const payload = {
    p_child_id: child.child_uuid,         
    p_lesson_count: this.seriesLessonCount,
    p_instructor_id_number: instructorParam,
    p_from_date: fromDate,
    p_to_date: toDate,
  };

console.log('🟣 payload types:', {
  p_child_id: payload.p_child_id,
  p_lesson_count: payload.p_lesson_count,
  p_instructor_id_number: payload.p_instructor_id_number,
  p_from_date: payload.p_from_date,
  p_to_date: payload.p_to_date,
});


  this.loadingSeries = true;
  try {
    const { data, error } = await dbTenant().rpc('find_series_starts', payload);


    if (error) {
      this.seriesError = 'שגיאה בחיפוש סדרות זמינות';
      return;
    }

   
const raw = (data ?? []) as RecurringSlot[];

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
const filtered: RecurringSlot[] = [];

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
    i.instructor_id === s.instructor_id ||  // ת"ז
    i.instructor_uid === s.instructor_id    // ליתר ביטחון
  );

  return {
    ...s,
    instructor_name: ins?.full_name ?? s.instructor_id, // אם לא נמצא – נשאיר ת"ז
  };
});
this.mapRecurringSlotsToCalendar();

    if (!this.recurringSlots.length) {
      this.seriesError = 'לא נמצאו זמנים מתאימים לסדרה בטווח הקרוב';
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
    console.log('⏳ seriesLessonCount selected but no valid child yet');
    return;
  }

  // אם חייבים מדריך ולא נבחר – נחכה
  if (!this.noInstructorPreference && !this.selectedInstructorId) {
    console.log('⏳ seriesLessonCount selected but no instructor yet');
    return;
  }

  // הכול מוכן – נריץ חיפוש
  this.searchRecurringSlots();
}

  // יצירת סדרה בפועל – insert ל-lessons (occurrences נוצרים מה-view)
  async createSeriesFromSlot(slot: RecurringSlot): Promise<void> {
   if (!this.selectedChildId) return;

  if (!this.seriesLessonCount) {
    this.seriesError = 'יש לבחור כמות שיעורים בסדרה לפני קביעת הסדרה';
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
//   async bookMakeupSlot(slot: MakeupSlot): Promise<void> {
//   if (!this.selectedChildId) return;

//   const dayLabel = this.dayOfWeekLabelFromDate(slot.occur_date);
//   const anchorWeekStart = this.calcAnchorWeekStart(slot.occur_date);

//   // נחליט מה ה-id_number שנכניס לשיעור
//   const instructorIdNumber =
//     this.selectedInstructorId === 'any'
//       ? slot.instructor_id
//       : (
//           this.instructors.find(i =>
//             i.instructor_uid === this.selectedInstructorId || // uid
//             i.instructor_id  === this.selectedInstructorId    // במקרה שכבר ת"ז
//           )?.instructor_id ?? slot.instructor_id              // fallback
//         );

//   console.log('📌 booking makeup with instructorIdNumber:', instructorIdNumber);

//   const { data, error } = await dbTenant()
//     .from('lessons')
//     .insert({
//       child_id: this.selectedChildId,
//       instructor_id: instructorIdNumber,  // ← שורה מתוקנת
//       lesson_type: 'השלמה',
//       status: 'אושר',
//       day_of_week: dayLabel,
//       start_time: slot.start_time,
//       end_time: slot.end_time,
//       repeat_weeks: 1,
//       anchor_week_start: anchorWeekStart,
//       appointment_kind: 'therapy_makeup',
//       approval_id: this.selectedApproval?.approval_id ?? null,
//       origin: this.user!.role === 'parent' ? 'parent' : 'secretary',
//       is_tentative: false,
//       capacity: 1,
//       current_booked: 1,
//       payment_source: this.selectedApproval ? 'health_fund' : 'private',
//     })
//     .select()
//     .single();

//   if (error) {
//     console.error(error);
//     this.makeupError = 'שגיאה ביצירת שיעור ההשלמה';
//     return;
//   }

//   this.makeupCreatedMessage = 'שיעור ההשלמה נוצר בהצלחה';
//   await this.onChildChange();
// }

 // בקשת שיעור השלמה מהמזכירה – מכניסת רשומה ל-secretarial_requests
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

    // 🔹 עכשיו נכניס את שיעור ההשלמה לטבלת lessons

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

    const { error: lessonError } = await supa
      .from('lessons')
      .insert({
        lesson_type: 'השלמה',              // ⬅️ lesson_type = השלמה
        day_of_week: dayLabel,             // ⬅️ יום בשבוע מהתאריך
        start_time: slot.start_time,
        end_time: slot.end_time,
        instructor_id: instructorIdNumber, // ⬅️ ת"ז של המדריך
        status: 'ממתין לאישור',           // ⬅️ בהתאם ל-CHECK בטבלה
        child_id: this.selectedChildId,    // ⬅️ ה-UUID של הילד
        repeat_weeks: 1,                   // ⬅️ תמיד 1
        anchor_week_start: anchorDate,     // ⬅️ תאריך השיעור השלמה
        appointment_kind: 'therapy_makeup',// ⬅️ סוג התור
        origin: 'parent',                  // ⬅️ מקור: הורה
        base_lesson_uid: baseLessonUid,      // ⬅️ קישור ל-lesson_occurrence_exceptions.id
        capacity: 1,
        current_booked: 1,
        payment_source: 'private',         // אם תרצי – אפשר לשנות ללוגיקה של קופה/פרטי
      });

    if (lessonError) {
      console.error(lessonError);
      this.makeupError = 'שגיאה בשמירת שיעור ההשלמה במערכת';
      return;
    }

    this.makeupCreatedMessage =
      'בקשת ההשלמה נשלחה למזכירה והשיעור נשמר במערכת ✔️';

    // רענון הנתונים למסך (שיעורים שניתן להשלים, חורים, וכו')
    await this.onChildChange();
  });
}

async requestSeriesFromSecretary(slot: RecurringSlot, dialogTpl: TemplateRef<any>): Promise<void> {
  if (!this.selectedChildId || !this.user) {
    this.seriesError = 'חסר ילד או משתמש מחובר';
    return;
  }

  if (!this.seriesLessonCount) {
    this.seriesError = 'חסר מספר שיעורים בסדרה';
    return;
  }

  if (!this.paymentSourceForSeries) {
    this.seriesError = 'יש לבחור סוג תשלום';
    return;
  }

  if (this.paymentSourceForSeries === 'health_fund' && !this.referralFile) {
    this.seriesError = 'לבקשה דרך קופה יש לצרף הפניה / התחייבות';
    return;
  }

  // ---- חישוב תאריכים ----
  const startDate = slot.lesson_date;
  const weeks = this.seriesLessonCount - 1;

  const endD = new Date(startDate + 'T00:00:00');
  endD.setDate(endD.getDate() + weeks * 7);
  const endDate = this.formatLocalDate(endD);

  // ---- פרטי מדריך ----
  let instructorIdNumber: string | null = null;
  let instructorName = '';

  if (this.selectedInstructorId && this.selectedInstructorId !== 'any') {
    const selected = this.instructors.find(
      i =>
        i.instructor_uid === this.selectedInstructorId ||
        i.instructor_id === this.selectedInstructorId
    );
    instructorIdNumber = selected?.instructor_id ?? slot.instructor_id;
    instructorName = selected?.full_name ?? '';
  } else {
    instructorIdNumber = slot.instructor_id;
    instructorName = slot.instructor_id;
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
    // 🔹 2) payload לבקשה למזכירה (כולל URL אם יש)
    const payload: any = {
      requested_start_time: startTime,
      requested_end_time: endTime
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
      return;
    }

    // מרעננים את המסך
    await this.onChildChange();

    // מנקים קובץ שנבחר
    this.referralFile = null;

    // הודעת הצלחה + חזרה למסך הרגיל של זימון תור (אנחנו כבר שם, רק חיווי)
    this.seriesCreatedMessage = 'בקשתך נשלחה למזכירה';
    this.selectedTab = 'series';
  });
}

  // =========================================
  //           עזרי תאריכים / ימים
  // =========================================
  private dayOfWeekLabel(value: number): string {
    return this.daysOfWeek.find(d => d.value === value)?.label ?? '';
  }

  private dayOfWeekLabelFromDate(dateStr: string): string {
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
  // חייבים ילד
  if (!this.selectedChildId) return false;

  // חייבים כמות שיעורים
  if (!this.seriesLessonCount) return false;

  // חייבים סוג תשלום
  if (!this.paymentSourceForSeries) return false;

  // אם תשלום דרך קופה – חייב קובץ
  if (this.paymentSourceForSeries === 'health_fund' && !this.referralFile) {
    return false;
  }

  return true;
}


}

import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../../services/ui-dialog.service';
import { inject } from '@angular/core';

import {
  ensureTenantContextReady,
  dbTenant
} from '../../../services/legacy-compat';


type FarmWorkingHour = {
  day_of_week: number;
  is_open: boolean;
  farm_start: string | null;
  farm_end: string | null;
};

type WaitingTimeRange = {
  from: string;
  to: string;
};

type WaitingDayAvailability = {
  day: number;
  ranges: WaitingTimeRange[];
};

@Component({
  selector: 'app-waiting-list-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './waiting-list-dialog.html',
  styleUrl: './waiting-list-dialog.scss'
})
export class WaitingListDialog implements OnInit {

  @Input() childId: string | null = null;
  @Input() parentUid: string | null = null;
  @Input() childName = '';
  @Input() childAge: number | null = null;
  @Input() instructors: {
    id_number: string;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  }[] = [];


  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<{ entryId: string; childId: string; parentUid: string }>();
  // קריאה אופציונלית לפני השמירה, למשל אישור ילד מתוך בקשות ואישורים.
  @Input() beforeSave?: () => Promise<{ childId: string; parentUid: string }>;
  private readonly ui = inject(UiDialogService);
  savedEntryId: string | null = null;
  private approvalCompleted = false;

  // =====================================
  // סוגי רכיבה
  // =====================================

  waitingListRidingTypes: {
    id: string;
    name: string;
  }[] = [];

  waitingListRidingTypesLoading = false;
  waitingListRidingTypesError = '';

  waitingListAllRidingTypes = true;
  waitingListRidingTypeIds: string[] = [];
  waitingListRidingTypeSearch = '';
  waitingListRidingTypesOpen = false;

  async loadWaitingListRidingTypes(): Promise<void> {
    this.waitingListRidingTypesLoading = true;
    this.waitingListRidingTypesError = '';
    this.waitingListRidingTypes = [];

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const { data, error } = await db
        .from('riding_types')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;

      this.waitingListRidingTypes = (data ?? []).map(
        (type: any) => ({
          id: type.id,
          name: type.name
        })
      );

    } catch (error: any) {
      console.error('Loading riding types failed:', error);

      this.waitingListRidingTypesError =
        error?.message ?? 'שגיאה בטעינת סוגי הרכיבה';

    } finally {
      this.waitingListRidingTypesLoading = false;
    }
  }

  get filteredWaitingListRidingTypes() {
    const search =
      this.waitingListRidingTypeSearch.trim().toLowerCase();

    return this.waitingListRidingTypes.filter(type =>
      type.name.toLowerCase().includes(search)
    );
  }

  setWaitingListAllRidingTypes(all: boolean): void {
    this.waitingListAllRidingTypes = all;
    this.waitingListRidingTypeIds = [];
    this.waitingListRidingTypeSearch = '';
    this.waitingListRidingTypesOpen = false;
  }

  toggleWaitingListRidingType(
    id: string,
    checked: boolean
  ): void {
    if (checked) {
      if (!this.waitingListRidingTypeIds.includes(id)) {
        this.waitingListRidingTypeIds.push(id);
      }
    } else {
      this.waitingListRidingTypeIds =
        this.waitingListRidingTypeIds.filter(
          typeId => typeId !== id
        );
    }
  }


  // =====================================
  // מדריכים ברשימת ההמתנה
  // =====================================

  waitingListAllInstructors = true;
  waitingListInstructorIds: string[] = [];
  waitingListInstructorSearch = '';
  waitingListInstructorsOpen = false;

  getWaitingListInstructorName(id: string): string {
    const instructor = this.instructors.find(
      item => item.id_number === id
    );

    if (!instructor) return id;

    const fullName = [
      instructor.first_name,
      instructor.last_name
    ].filter(Boolean).join(' ').trim();

    return fullName || instructor.name || id;
  }

  get filteredWaitingListInstructors() {
    const search =
      this.waitingListInstructorSearch.trim().toLowerCase();

    return this.instructors.filter(instructor =>
      this.getWaitingListInstructorName(instructor.id_number)
        .toLowerCase()
        .includes(search)
    );
  }

  setWaitingListAllInstructors(all: boolean): void {
    this.waitingListAllInstructors = all;
    this.waitingListInstructorIds = [];
    this.waitingListInstructorSearch = '';
    this.waitingListInstructorsOpen = false;
  }

  toggleWaitingListInstructor(
    id: string,
    checked: boolean
  ): void {
    if (checked) {
      if (!this.waitingListInstructorIds.includes(id)) {
        this.waitingListInstructorIds.push(id);
      }
    } else {
      this.waitingListInstructorIds =
        this.waitingListInstructorIds.filter(
          instructorId => instructorId !== id
        );
    }
  }


  // =====================================
  // זמינות ימים ושעות
  // =====================================

  waitingListAllTimes = true;
  waitingListSameHours = false;

  waitingListWeekDays = [
    { id: 1, name: 'ראשון' },
    { id: 2, name: 'שני' },
    { id: 3, name: 'שלישי' },
    { id: 4, name: 'רביעי' },
    { id: 5, name: 'חמישי' },
    { id: 6, name: 'שישי' },
    { id: 7, name: 'שבת' }
  ];

  waitingListDays: WaitingDayAvailability[] = [];

  waitingListCommonRanges: WaitingTimeRange[] = [
    { from: '', to: '' }
  ];

  farmWorkingHours: FarmWorkingHour[] = [];
  farmWorkingHoursLoading = false;
  farmWorkingHoursLoaded = false;
  farmWorkingHoursError = '';


  setWaitingListAllTimes(all: boolean): void {
    this.waitingListAllTimes = all;
    this.waitingListDays = [];
    this.waitingListSameHours = false;
    this.waitingListCommonRanges = [
      { from: '', to: '' }
    ];
  }

  isWaitingListDaySelected(day: number): boolean {
    return this.waitingListDays.some(
      item => item.day === day
    );
  }

  toggleWaitingListDay(day: number): void {
    const exists = this.isWaitingListDaySelected(day);

    if (exists) {
      this.waitingListDays = this.waitingListDays.filter(
        item => item.day !== day
      );
    } else {
      this.waitingListDays = [
        ...this.waitingListDays,
        {
          day,
          ranges: [{ from: '', to: '' }]
        }
      ].sort((a, b) => a.day - b.day);
    }
  }

  getWaitingListDay(
    day: number
  ): WaitingDayAvailability | undefined {
    return this.waitingListDays.find(
      item => item.day === day
    );
  }


  async loadWaitingListFarmHours(): Promise<void> {
    this.farmWorkingHoursLoading = true;
    this.farmWorkingHoursLoaded = false;
    this.farmWorkingHoursError = '';
    this.farmWorkingHours = [];

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const { data, error } = await db
        .from('farm_working_hours')
        .select('day_of_week, is_open, farm_start, farm_end')
        .order('day_of_week', { ascending: true });

      if (error) throw error;

      this.farmWorkingHours = (data ?? []).map((row: any) => ({
        day_of_week: Number(row.day_of_week),
        is_open: row.is_open === true,
        farm_start: row.farm_start
          ? String(row.farm_start).slice(0, 5)
          : null,
        farm_end: row.farm_end
          ? String(row.farm_end).slice(0, 5)
          : null
      }));

      this.farmWorkingHoursLoaded = true;

    } catch (error) {
      console.error('שגיאה בטעינת שעות החווה:', error);

      this.farmWorkingHoursError =
        'לא ניתן לטעון את שעות הפעילות של החווה';

    } finally {
      this.farmWorkingHoursLoading = false;
    }
  }

  get waitingListAvailableDays() {
    if (!this.farmWorkingHoursLoaded) {
      return [];
    }

    return this.waitingListWeekDays.filter(day => {
      const hours = this.farmWorkingHours.find(
        row => row.day_of_week === day.id
      );

      return (
        hours?.is_open === true &&
        !!hours.farm_start &&
        !!hours.farm_end &&
        hours.farm_start < hours.farm_end
      );
    });
  }

  getWaitingListFarmHours(
    day: number
  ): FarmWorkingHour | undefined {
    return this.farmWorkingHours.find(
      row => row.day_of_week === day && row.is_open
    );
  }


  // =====================================
  // בדיקות תקינות של זמינות ושעות
  // =====================================

  getWaitingListTimeErrors(dayId: number): string[] {
    if (this.waitingListAllTimes) return [];

    const errors: string[] = [];
    const hours = this.getWaitingListFarmHours(dayId);

    if (!hours?.is_open || !hours.farm_start || !hours.farm_end) {
      return ['לא נמצאו שעות פעילות תקינות לחווה.'];
    }

    const toMinutes = (time: string): number | null => {
      const value = time.slice(0, 5);

      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return null;
      }

      const [h, m] = value.split(':').map(Number);
      return h * 60 + m;
    };

    const farmStart = toMinutes(hours.farm_start);
    const farmEnd = toMinutes(hours.farm_end);

    if (
      farmStart === null ||
      farmEnd === null ||
      farmStart >= farmEnd
    ) {
      return ['שעות הפעילות של החווה אינן תקינות.'];
    }

    const ranges = this.waitingListSameHours
      ? this.waitingListCommonRanges
      : this.getWaitingListDay(dayId)?.ranges ?? [];

    if (ranges.length === 0) {
      return ['יש להגדיר לפחות טווח שעות אחד.'];
    }

    const validRanges: {
      index: number;
      start: number;
      end: number;
    }[] = [];

    ranges.forEach((range, index) => {
      const start = range.from
        ? toMinutes(range.from)
        : farmStart;

      const end = range.to
        ? toMinutes(range.to)
        : farmEnd;

      const number = index + 1;

      if (start === null || end === null) {
        errors.push(`טווח ${number}: יש להזין שעות תקינות.`);
        return;
      }

      if (start >= end) {
        errors.push(
          `טווח ${number}: שעת הסיום חייבת להיות מאוחרת משעת ההתחלה.`
        );
        return;
      }

      if (start < farmStart || end > farmEnd) {
        errors.push(
          `טווח ${number}: השעות חייבות להיות בתוך שעות הפעילות של החווה.`
        );
        return;
      }

      validRanges.push({ index: number, start, end });
    });

    for (let i = 0; i < validRanges.length; i++) {
      for (let j = i + 1; j < validRanges.length; j++) {
        const a = validRanges[i];
        const b = validRanges[j];

        if (a.start < b.end && b.start < a.end) {
          errors.push(
            `קיימת חפיפה בין טווח ${a.index} לטווח ${b.index}.`
          );
        }
      }
    }

    return errors;
  }

  getWaitingListCommonTimeErrors(): string[] {
    const errors = this.waitingListDays.flatMap(day =>
      this.getWaitingListTimeErrors(day.day)
    );

    return [...new Set(errors)];
  }

  // =====================================
  // הוספה והסרה של טווחי שעות
  // =====================================

  addWaitingListTimeRange(day: number): void {
    const selectedDay = this.getWaitingListDay(day);
    if (!selectedDay) return;

    selectedDay.ranges.push({ from: '', to: '' });
  }

  removeWaitingListTimeRange(day: number, index: number): void {
    const selectedDay = this.getWaitingListDay(day);
    if (!selectedDay || selectedDay.ranges.length <= 1) return;

    selectedDay.ranges.splice(index, 1);
  }

  addWaitingListCommonRange(): void {
    this.waitingListCommonRanges.push({ from: '', to: '' });
  }

  removeWaitingListCommonRange(index: number): void {
    if (this.waitingListCommonRanges.length <= 1) return;

    this.waitingListCommonRanges.splice(index, 1);
  }

  waitingListPriority: 'high' | 'medium' | 'low' = 'medium';

  getWaitingListDayName(day: number): string {
    return this.waitingListWeekDays.find(
      item => item.id === day
    )?.name ?? String(day);
  }

  getWaitingListAvailabilitySummary(): string[] {
    if (this.waitingListAllTimes) {
      return ['כל הימים והשעות'];
    }

    if (this.waitingListDays.length === 0) {
      return ['לא נבחרו ימים'];
    }

    return this.waitingListDays.map(day => {
      const dayName = this.getWaitingListDayName(day.day);

      const errors = this.getWaitingListTimeErrors(day.day);

      if (errors.length > 0) {
        return `יום ${dayName}: יש לתקן שגיאות בשעות`;
      }

      const ranges = this.waitingListSameHours
        ? this.waitingListCommonRanges
        : day.ranges;

      const rangeTexts = ranges.map(range => {
        if (!range.from && !range.to) {
          return 'כל השעות';
        }

        if (range.from && !range.to) {
          return `משעה ${range.from}`;
        }

        if (!range.from && range.to) {
          return `עד שעה ${range.to}`;
        }

        return `${range.from}–${range.to}`;
      });

      return `יום ${dayName}: ${rangeTexts.join(', ')}`;
    });
  }

  get canSaveWaitingList(): boolean {
    if (
      this.waitingListRidingTypesLoading ||
      this.waitingListRidingTypesError ||
      this.waitingListRidingTypes.length === 0
    ) {
      return false;
    }

    if (
      !this.waitingListAllRidingTypes &&
      this.waitingListRidingTypeIds.length === 0
    ) {
      return false;
    }

    if (
      !this.farmWorkingHoursLoaded ||
      this.farmWorkingHoursLoading ||
      this.farmWorkingHoursError ||
      this.waitingListAvailableDays.length === 0
    ) {
      return false;
    }

    if (!this.childId && !this.beforeSave) {
      return false;
    }

    if (
      !this.waitingListAllInstructors &&
      this.waitingListInstructorIds.length === 0
    ) {
      return false;
    }

    if (this.waitingListAllTimes) {
      return true;
    }

    if (this.waitingListDays.length === 0) {
      return false;
    }

    if (
      this.waitingListDays.some(day =>
        this.getWaitingListTimeErrors(day.day).length > 0
      )
    ) {
      return false;
    }

    return true;
  }


  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadWaitingListRidingTypes(),
      this.loadWaitingListFarmHours()
    ]);
  }


  // =====================================
  // מצב שמירה, סגירה ואיפוס הטופס
  // =====================================

  savingWaitingList = false;

  closeWaitingListDialog(): void {
    if (this.savingWaitingList) return;

    this.resetWaitingListForm();
    this.closed.emit();
  }

  resetWaitingListForm(): void {
    // סוגי רכיבה
    this.waitingListAllRidingTypes = true;
    this.waitingListRidingTypeIds = [];
    this.waitingListRidingTypeSearch = '';
    this.waitingListRidingTypesOpen = false;

    // מדריכים
    this.waitingListAllInstructors = true;
    this.waitingListInstructorIds = [];
    this.waitingListInstructorSearch = '';
    this.waitingListInstructorsOpen = false;

    // ימים ושעות
    this.waitingListAllTimes = true;
    this.waitingListDays = [];
    this.waitingListSameHours = false;
    this.waitingListCommonRanges = [
      { from: '', to: '' }
    ];

    // עדיפות
    this.waitingListPriority = 'medium';
  }


  validateWaitingListTime(
    day: number,
    range: WaitingTimeRange,
    field: 'from' | 'to'
  ): void {
    const hours = this.getWaitingListFarmHours(day);

    if (!hours?.farm_start || !hours?.farm_end) {
      return;
    }

    const value = range[field];

    // שדה ריק מותר: אין הגבלה בצד הזה
    if (!value) return;

    if (value < hours.farm_start) {
      range[field] = hours.farm_start;
    }

    if (value > hours.farm_end) {
      range[field] = hours.farm_end;
    }
  }

  get waitingListCommonMinTime(): string {
    const starts = this.waitingListDays
      .map(day => this.getWaitingListFarmHours(day.day)?.farm_start)
      .filter((time): time is string => !!time);

    return starts.length
      ? starts.reduce(
        (latest, time) => time > latest ? time : latest
      )
      : '';
  }

  get waitingListCommonMaxTime(): string {
    const ends = this.waitingListDays
      .map(day => this.getWaitingListFarmHours(day.day)?.farm_end)
      .filter((time): time is string => !!time);

    return ends.length
      ? ends.reduce(
        (earliest, time) => time < earliest ? time : earliest
      )
      : '';
  }

  validateWaitingListCommonTime(
    range: WaitingTimeRange,
    field: 'from' | 'to'
  ): void {
    const min = this.waitingListCommonMinTime;
    const max = this.waitingListCommonMaxTime;
    const value = range[field];

    if (!value || !min || !max) return;

    if (value < min) {
      range[field] = min;
    } else if (value > max) {
      range[field] = max;
    }
  }



  async saveWaitingList(): Promise<void> {
    if (!this.canSaveWaitingList || this.savingWaitingList) return;
    this.savingWaitingList = true;
    let approvedChild = this.approvalCompleted;
    try {
      await ensureTenantContextReady();
      const db = dbTenant();
      const priorityMap = { high: 2, medium: 1, low: 0 };
      const availability: { day: number; allDay: boolean; from: string | null; to: string | null }[] = [];
      if (!this.waitingListAllTimes) {
        for (const day of this.waitingListDays) {
          const hours = this.getWaitingListFarmHours(day.day);
          if (!hours?.is_open || !hours.farm_start || !hours.farm_end) {
            throw new Error(`לא נמצאו שעות פעילות תקינות ליום ${day.day}`);
          }
          const ranges = this.waitingListSameHours ? this.waitingListCommonRanges : day.ranges;
          for (const range of ranges) {
            const allDay = !range.from && !range.to;
            availability.push({
              day: day.day, allDay,
              from: allDay ? null : (range.from || hours.farm_start).slice(0, 5),
              to: allDay ? null : (range.to || hours.farm_end).slice(0, 5)
            });
          }
        }
      }
      // האישור מתבצע רק לאחר שהטופס תקין, ורק פעם אחת.
      if (this.beforeSave) {
        const approved = await this.beforeSave();
        if (!approved?.childId || !approved?.parentUid) throw new Error('האישור הסתיים ללא מזהי ילד והורה תקינים');
        this.childId = approved.childId;
        this.parentUid = approved.parentUid;

        approvedChild = true;
        this.approvalCompleted = true;

        // האישור כבר הצליח: בניסיון חוזר נשמור רק את ההמתנה
        this.beforeSave = undefined;
      }

      if (!this.childId || !this.parentUid) {
        await this.ui.alert(
          'לא ניתן לשמור: לילד חסר מזהה או הורה משויך.',
          'שגיאה בשמירת רשימת המתנה'
        );
        return;
      }
      const { data, error } = await db.rpc('waitlist_create_request', {
        p_parent_uid: this.parentUid,
        p_child_uuid: this.childId,
        p_priority: priorityMap[this.waitingListPriority],
        p_all_riding_types: this.waitingListAllRidingTypes,
        p_riding_type_ids: this.waitingListAllRidingTypes ? [] : [...this.waitingListRidingTypeIds],
        p_all_instructors: this.waitingListAllInstructors,
        p_instructor_ids: this.waitingListAllInstructors ? [] : [...this.waitingListInstructorIds],
        p_all_times: this.waitingListAllTimes,
        p_availability: availability
      });
      if (error) throw error;
      const entryId = typeof data === 'string' ? data : null;
      if (!entryId) throw new Error('הבקשה נשמרה אך לא התקבל מזהה בקשת המתנה');
      this.savedEntryId = entryId;
      let queuePosition: { priority: number; priorityPosition: number; overallPosition: number } | undefined;
      try {
        const { data: positions, error: positionError } = await db.rpc('waitlist_get_queue_position', { p_entry_id: entryId });
        if (positionError) throw positionError;
        const p = Array.isArray(positions) ? positions[0] : positions;
        if (p && p.priority != null && p.priority_position != null && p.overall_position != null) {
          queuePosition = { priority: Number(p.priority), priorityPosition: Number(p.priority_position), overallPosition: Number(p.overall_position) };
        }
      } catch (e) { console.error('מיקום בתור אינו זמין:', e); }
      this.saved.emit({ entryId, childId: this.childId, parentUid: this.parentUid });
      // נסתיר את החלון לפני הודעת ההצלחה כדי שלא יסתיר אותה
      this.closed.emit();
      await this.ui.confirm({
        title: 'שמירה הושלמה',
        message: queuePosition ? 'הילד נוסף בהצלחה לרשימת ההמתנה.' : 'הילד נוסף בהצלחה לרשימת ההמתנה.\nהמיקום בתור אינו זמין כרגע.',
        okText: 'אישור', showCancel: false, queuePosition
      });
    } catch (e: any) {
      console.error('שגיאה בשמירת רשימת המתנה:', e);
      const code = String(e?.code ?? '');
      const txt = String(e?.message ?? '');
      let title = approvedChild ? 'הילד אושר, אך ההמתנה לא נשמרה' : 'שגיאה בשמירה';
      let message = approvedChild
        ? 'הילד אושר במערכת, אבל ההוספה לרשימת ההמתנה נכשלה. אפשר לנסות שוב בלי לאשר את הילד מחדש.'
        : 'לא הצלחנו לשמור את הבקשה. נסי שוב.';
      if (code === '23505' || txt.includes('waitlist_entries_unique_child')) {
        title = 'בקשת המתנה כבר קיימת';
        message =
          'לילד/ה כבר קיימת בקשה ברשימת ההמתנה. ' +
          'לא ניתן לפתוח בקשה נוספת לפני שהבקשה הקיימת תטופל או תימחק.';
      } else if (code === '42501' || code === 'PGRST301') {
        message = 'אין הרשאה לשמירת הבקשה. יש לבדוק את הרשאות המשתמש.';
      }
      await this.ui.alert(message, title);
    } finally {
      this.savingWaitingList = false;
    }
  }

}

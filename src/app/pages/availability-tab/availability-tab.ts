// src/app/pages/availability-tab/availability-tab.component.ts
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';
import { FarmSettingsService } from '../../services/farm-settings.service';
import { ensureTenantContextReady } from '../../services/legacy-compat';
import { Input } from '@angular/core';
import { requireTenant } from '../../services/supabaseClient.service';

/* ===================== TYPES ===================== */

type UUID = string;

interface TimeSlot {
  start: string | null;
  end: string | null;
  ridingTypeId: UUID | null;

  editing?: 'start' | 'end' | null;
  editSessionStarted?: boolean;

  isNew?: boolean;
  wasUpdated?: boolean;

  // UI validation
  hasError?: boolean;
  errorMessage?: string | null;
  flashError?: boolean;

  originalStart?: string | null;
  originalEnd?: string | null;

  prevStart?: string | null;
  prevEnd?: string | null;
  prevRidingTypeId?: UUID | null;
}
interface FarmWorkingHourRow {
  day_of_week: number; // 1..7
  is_open: boolean;
  farm_start: string | null;
  farm_end: string | null;
}

interface DayAvailability {
  key: string; // sun/mon/...
  label: string; // ראשון/שני/...
  active: boolean;
  slots: TimeSlot[];
}
interface RidingType {
  id: UUID;
  code: string;
  name: string;
  min_participants: number | null;
  max_participants: number | null;
  special_duration: number | null;
  active: boolean;
}

interface ImpactedLesson {
  lessonId: string;
  childId: string;
  childName: string;
  lessonType: string;
  appointmentKind: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  occurDate: string | null;
  anchorWeekStart: string | null;
  repeatWeeks: number | null;
  isOpenEnded: boolean;
  seriesEndDate: string | null;
  effectiveOccurDate: string | null;

  handled?: boolean;
  handledAction?: 'cancelled_with_makeup' | 'moved' | 'series_ended';
  handling?: boolean;
}
interface ConfirmData {
  lessons: ImpactedLesson[];
}
interface FarmSettings {
  operating_hours_start?: string | null;
  operating_hours_end?: string | null;
  lesson_duration_minutes?: number | null;
  working_days?: number[] | null;
  farm_id?: UUID | null;
}

/** ✅ DB shape לפי הטבלה אצלך (מהצילום) */
type InstructorWeeklyRow = {
  instructor_id_number: string;
  day_of_week: number; // 0..6 (לפי המיפוי החדש)
  start_time: string; // 'HH:MM:SS'
  end_time: string; // 'HH:MM:SS'
  lesson_ridding_type: UUID | null;
  lesson_type_mode?: string | null;
};

/* ===================== COMPONENT ===================== */

@Component({
  selector: 'app-availability-tab',
  standalone: true,
  templateUrl: './availability-tab.html',
  styleUrls: ['./availability-tab.scss'],
  imports: [CommonModule, FormsModule, MatSlideToggleModule, MatButtonModule, MatIconModule],
})
export class AvailabilityTabComponent implements OnInit {
  
public farmHoursByDay: Record<number, { start: string; end: string }> = {};

  public userId: string | null = null;

  public days: DayAvailability[] = [];
  public ridingTypes: RidingType[] = [];

  public allowEdit = true;
  public isDirty = false;
  public lockConfirm = false;

  public farmId: UUID | null = null;
  public farmStart = '08:00';
  public farmEnd = '17:00';
  public lessonDuration = 60;
  public farmWorkingDays: number[] = [];
  @Input() mode: 'self' | 'secretary' = 'self';

  private _instructorIdNumber: string | null = null;
busyAction: string | null = null;
@Input()
set instructorIdNumber(v: string | null) {
  this._instructorIdNumber = v;
}
get instructorIdNumber(): string | null {
  return this._instructorIdNumber;
}

selectedImpactLesson: ImpactedLesson | null = null;

impactMoveSlotsModal = {
  open: false,
  loading: false,
  saving: false,
  error: '',
  slots: [] as any[],
  selectedSlot: null as any | null,
};
impactMoveConfirmModal = {
  open: false,
  childName: '',
  originalDate: '',
  originalTime: '',
  newDate: '',
  newTime: '',
  newInstructor: '',
  slot: null as any | null,
};
  

  public confirmData: ConfirmData | null = null;

  public toastMessage = '';
  private toastTimeout: any;

  private originalDays: DayAvailability[] = [];

  private readonly DAY_LABELS: Array<{ key: DayAvailability['key']; label: string }> = [
    { key: 'sun', label: 'ראשון' },
    { key: 'mon', label: 'שני' },
    { key: 'tue', label: 'שלישי' },
    { key: 'wed', label: 'רביעי' },
    { key: 'thu', label: 'חמישי' },
    { key: 'fri', label: 'שישי' },
    { key: 'sat', label: 'שבת' },
  ];
private lastImpactRanges: { dayLabel: string; oldStart: string; oldEnd: string }[] = [];
  // ✅ מיפוי חדש: 0..6
  private readonly DAY_KEY_TO_NUM: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  private readonly NUM_TO_DAY_KEY: Record<number, string> = {
    0: 'sun',
    1: 'mon',
    2: 'tue',
    3: 'wed',
    4: 'thu',
    5: 'fri',
    6: 'sat',
  };

  constructor(
    private cdr: ChangeDetectorRef,
    private farmSettingsService: FarmSettingsService,
  ) {}

  /* ===================== INIT ===================== */

  async ngOnInit() {
  await ensureTenantContextReady();
  this.buildTimeOptions();

  await this.loadFarmWorkingHours();

  await this.loadRidingTypes();
  this.loadDefaultsIfEmpty();

  if (this.mode === 'secretary') {
    // מזכירה: עובד לפי ת"ז שהגיעה מבחוץ
    if (!this.instructorIdNumber) return;

    this.allowEdit = true; // מזכירה תמיד עורכת
    await this.loadInstructorWeeklyByIdNumber(this.instructorIdNumber);

  } else {
    // מדריך מחובר: כמו היום
    await this.loadUserId();
    await this.loadInstructorRecord(); // מציב instructorIdNumber + allowEdit
    await this.loadInstructorWeekly();  // קורא לפי this.instructorIdNumber
  }

  this.ensureSlotsHaveDefaults();
}

private async loadInstructorWeeklyByIdNumber(idNumber: string) {
  this.instructorIdNumber = idNumber;

  const { data, error } = await dbTenant()
    .from('instructor_weekly_availability')
    .select('instructor_id_number, day_of_week, start_time, end_time, lesson_ridding_type, lesson_type_mode')
    .eq('instructor_id_number', idNumber);

  if (error) {
    console.error('❌ loadInstructorWeeklyByIdNumber error', error);
    this.originalDays = JSON.parse(JSON.stringify(this.days));
    return;
  }

  const rows = (data || []) as any[];

  for (const day of this.days) {
    day.active = false;
    day.slots = [];
  }

  for (const r of rows) {
    const key = this.NUM_TO_DAY_KEY[Number(r.day_of_week)];
    if (!key) continue;

    const day = this.days.find(d => d.key === key);
    if (!day) continue;

    day.active = true;
    day.slots.push({
      start: this.trimToHHMM(r.start_time),
      end: this.trimToHHMM(r.end_time),
      ridingTypeId: r.lesson_ridding_type ?? null,
      hasError: false,
      errorMessage: null,
    });
  }

  for (const day of this.days) {
    day.slots.sort((a, b) => this.toMin(this.normalizeTime(a.start)) - this.toMin(this.normalizeTime(b.start)));
  }

  this.originalDays = JSON.parse(JSON.stringify(this.days));
}


  private async loadUserId() {
    const auth = getAuth();
    this.userId = auth.currentUser?.uid ?? null;
  }

  /* ===================== FARM SETTINGS ===================== */

private async loadFarmWorkingHours() {
  const { data, error } = await dbTenant()
    .from('farm_working_hours')
    .select('day_of_week, is_open, farm_start, farm_end');

  if (error) {
    console.error('❌ loadFarmWorkingHours error', error);
    return;
  }

  const rows = (data || []) as FarmWorkingHourRow[];

  // ימים פתוחים
  this.farmWorkingDays = rows
    .filter(r => r.is_open)
    .map(r => r.day_of_week);

  // שעות לפי יום (1..7)
  this.farmHoursByDay = {};
  for (const r of rows) {
    if (!r.is_open || !r.farm_start || !r.farm_end) continue;

    this.farmHoursByDay[r.day_of_week] = {
      start: r.farm_start.slice(0, 5),
      end: r.farm_end.slice(0, 5),
    };
  }

}

  private async loadFarmSettings() {
    try {
      const settings = (await this.farmSettingsService.loadSettings()) as FarmSettings | null;
      if (!settings) return;

      if (Array.isArray(settings.working_days)) {
        this.farmWorkingDays = this.normalizeWorkingDays(settings.working_days);
      }

      if (settings.farm_id) this.farmId = settings.farm_id;

      if (settings.operating_hours_start) this.farmStart = settings.operating_hours_start.slice(0, 5);
      if (settings.operating_hours_end) this.farmEnd = settings.operating_hours_end.slice(0, 5);

      if (settings.lesson_duration_minutes) this.lessonDuration = settings.lesson_duration_minutes;
    } catch (err) {
      console.error('❌ loadFarmSettings failed', err);
    }
  }

  /** יש מערכות ששומרות working_days כ-1..7 / 0..6 / 1..7 עם 7=Sunday.
   *  כאן אנחנו שומרים כמו שמגיע, ובודקים בכל מקרה בצורה "גמישה". */
  private normalizeWorkingDays(days: number[]): number[] {
    // אם הגיע 0..6 -> לפעמים ממירים 0 ל-7
    const has7 = days.includes(7);
    const has0 = days.includes(0);

    if (has7 && !has0) return days; // 1-7 (אולי 7=ראשון)
    if (has0 && !has7) return days.map(d => (d === 0 ? 7 : d)); // 0-6 -> 1-7 (0 הופך ל-7)
    return days;
  }

  /* ===================== RIDING TYPES ===================== */
private async loadRidingTypes() {
  const { data, error } = await dbTenant()
    .from('riding_types')
.select('id, code, name, min_participants, max_participants, spacial_duration, is_active')
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('❌ loadRidingTypes error', error);
    this.ridingTypes = [];
    return;
  }

  this.ridingTypes = (data || []).map((rt: any) => ({
    id: rt.id,
    code: rt.code,
    name: rt.name,
    min_participants: rt.min_participants ?? null,
    max_participants: rt.max_participants ?? null,
    special_duration: rt.spacial_duration ?? null,
    active: rt.is_active,
  }));

  this.ridingTypes.sort((a, b) => {
    const aIsBreak = a.name.includes('הפסק');
    const bIsBreak = b.name.includes('הפסק');

    if (aIsBreak && !bIsBreak) return 1;
    if (!aIsBreak && bIsBreak) return -1;

    return a.name.localeCompare(b.name, 'he');
  });
}
getAllowedRidingTypesForSlot(slot: TimeSlot): RidingType[] {
  const currentType = this.ridingTypes.find(rt => rt.id === slot.ridingTypeId);

  // זמינות חדשה — להציג את כל סוגי השיעור הרגילים
  if (slot.isNew || !currentType) {
    return this.ridingTypes.filter(rt => rt.code?.trim() !== 'break');
  }

  // אם הסוג הקיים הוא הפסקה — להציג רק הפסקה
  if (currentType.code?.trim() === 'break') {
    return [currentType];
  }

  const currentMax = currentType.max_participants ?? 0;

  return this.ridingTypes.filter(rt => {
    if (rt.id === slot.ridingTypeId) return true;

    if (rt.code?.trim() === 'break') return false;

    if (rt.special_duration !== currentType.special_duration) {
      return false;
    }

    return (rt.max_participants ?? 0) >= currentMax;
  });
}
  /* ===================== INSTRUCTOR ===================== */

  private async loadInstructorRecord() {
    if (!this.userId) return;

    const { data, error } = await dbTenant()
      .from('instructors')
      .select('id_number, notify, allow_availability_edit')
      .eq('uid', this.userId)
      .maybeSingle();

    if (error) {
      console.error('❌ loadInstructorRecord error', error);
      return;
    }
    if (!data) return;

    this.instructorIdNumber = data.id_number;
    this.allowEdit = data.allow_availability_edit ?? true;

  
  }

  /* ===================== DEFAULT DAYS ===================== */

  private loadDefaultsIfEmpty() {
    if (this.days.length) return;

    this.days = this.DAY_LABELS.map(d => ({
      key: d.key,
      label: d.label,
      active: false,
      slots: [],
    }));
  }

  /* ===================== WEEKLY (READ) ===================== */

  private async loadInstructorWeekly() {
    if (!this.instructorIdNumber) return;

    const { data, error } = await dbTenant()
      .from('instructor_weekly_availability')
      .select('instructor_id_number, day_of_week, start_time, end_time, lesson_ridding_type, lesson_type_mode')
      .eq('instructor_id_number', this.instructorIdNumber);

    if (error) {
      console.error('❌ loadInstructorWeekly error', error);
      this.originalDays = JSON.parse(JSON.stringify(this.days));
      return;
    }

    const rows = (data || []) as InstructorWeeklyRow[];

    // reset
    for (const day of this.days) {
      day.active = false;
      day.slots = [];
    }

    for (const r of rows) {
      const key = this.NUM_TO_DAY_KEY[Number(r.day_of_week)];
      if (!key) continue;

      const day = this.days.find(d => d.key === key);
      if (!day) continue;

      day.active = true;
      day.slots.push({
        start: this.trimToHHMM(r.start_time),
        end: this.trimToHHMM(r.end_time),
        ridingTypeId: r.lesson_ridding_type ?? null,
        hasError: false,
        errorMessage: null,
      });
    }

    for (const day of this.days) {
      day.slots.sort(
        (a, b) => this.toMin(this.normalizeTime(a.start)) - this.toMin(this.normalizeTime(b.start)),
      );
    }

    this.originalDays = JSON.parse(JSON.stringify(this.days));
  }

  private trimToHHMM(t: string): string {
    if (!t) return t;
    const m = String(t).match(/^(\d{1,2}:\d{2})/); // '09:00:00' -> '09:00'
    return m ? m[1] : t;
  }

  /* ===================== DAYS / SLOTS UI ===================== */

  private ensureSlotsHaveDefaults() {
    const defaultType = this.ridingTypes[0]?.id ?? null;
    for (const day of this.days) {
      for (const slot of day.slots) {
        slot.ridingTypeId ??= defaultType;
        slot.prevStart ??= slot.start;
        slot.prevEnd ??= slot.end;
        slot.prevRidingTypeId ??= slot.ridingTypeId;

        slot.originalStart ??= slot.start;
        slot.originalEnd ??= slot.end;

        slot.hasError ??= false;
        slot.errorMessage ??= null;
      }
    }
  }

isFarmWorkingDay(dayKey: string): boolean {
  if (!this.farmWorkingDays.length) return true;
  return this.farmWorkingDays.includes(this.toFarmDayNumber(dayKey));
}
  toggleDay(day: DayAvailability, checked: boolean) {
  if (!this.allowEdit) return;

  day.active = checked;

  if (!checked) {
    day.slots = [];
    this.isDirty = true;
    return;
  }

  if (!day.slots.length) {
    const dayNum = this.toFarmDayNumber(day.key);
    const farmHours = this.farmHoursByDay[dayNum];

    const start = farmHours?.start ?? this.farmStart ?? '08:00';
    const end = this.addMinutes(start, this.lessonDuration || 60);

    day.slots.push({
      start,
      end,
      ridingTypeId: this.ridingTypes[0]?.id ?? null,
      isNew: true,
      hasError: false,
      errorMessage: null,
      prevStart: start,
      prevEnd: end,
      originalStart: start,
      originalEnd: end,
    });
  }

  this.isDirty = true;
}

  markDirty() {
    if (!this.allowEdit) return;
    this.isDirty = true;
  }

  onSlotFocus(slot: TimeSlot) {
  if (slot.editSessionStarted) return;

  slot.editSessionStarted = true;

  // snapshot לרברט
  slot.prevStart ??= slot.start;
  slot.prevEnd ??= slot.end;
  slot.prevRidingTypeId ??= slot.ridingTypeId;

  slot.originalStart ??= slot.start;
  slot.originalEnd ??= slot.end;

  // נקה שגיאות בעת פוקוס
  slot.hasError = false;
  slot.errorMessage = null;
}
  onSlotChange(day: DayAvailability, slot: TimeSlot): void {
  if (!this.allowEdit) return;

  this.isDirty = true;
  slot.hasError = false;
  slot.errorMessage = null;

  if (!slot.start || !slot.end) {
    slot.hasError = !!slot.start || !!slot.end;
    slot.errorMessage = slot.hasError ? 'יש להשלים שעת התחלה וסיום' : null;
    return;
  }

  if (this.toMin(slot.end) <= this.toMin(slot.start)) {
    slot.hasError = true;
    slot.errorMessage = 'שעת סיום חייבת להיות אחרי שעת התחלה';
    return;
  }

  const dayNum = this.toFarmDayNumber(day.key);
  const farmHours = this.farmHoursByDay[dayNum];

  if (farmHours) {
    if (this.toMin(slot.start) < this.toMin(farmHours.start)) {
      slot.hasError = true;
  slot.errorMessage = `ביום ${day.label}: שעת התחלה לא יכולה להיות לפני ${farmHours.start}`;
      return;
    }

    if (this.toMin(slot.end) > this.toMin(farmHours.end)) {
      slot.hasError = true;
  slot.errorMessage = `ביום ${day.label}: שעת סיום לא יכולה להיות אחרי ${farmHours.end}`;
      return;
    }
  }

  if (this.hasOverlap(day, slot)) {
    slot.hasError = true;
    slot.errorMessage = 'יש חפיפה עם טווח אחר באותו יום';
    return;
  }

  slot.prevStart = slot.start;
  slot.prevEnd = slot.end;
  slot.prevRidingTypeId = slot.ridingTypeId;
}
private toFarmDayNumber(dayKey: string): number {
  const map: Record<string, number> = {
    sun: 1,
    mon: 2,
    tue: 3,
    wed: 4,
    thu: 5,
    fri: 6,
    sat: 7,
  };

  return map[dayKey];
}

 onRidingTypeChange(day: DayAvailability, slot: TimeSlot) {
  if (!this.allowEdit) return;

  slot.prevRidingTypeId = slot.ridingTypeId;
  slot.wasUpdated = true;
  this.isDirty = true;

  // אם כבר יש שעות — בדיקה מחדש לפי הפונקציה החדשה
  this.onSlotChange(day, slot);
}
  addSlot(day: DayAvailability) {
  if (!this.allowEdit) return;

  const dayNum = this.toFarmDayNumber(day.key);
  const farmHours = this.farmHoursByDay[dayNum];

  const start = farmHours?.start ?? this.farmStart ?? '08:00';
  const end = this.addMinutes(start, this.lessonDuration || 60);

  day.slots.push({
    start,
    end,
    ridingTypeId: this.ridingTypes[0]?.id ?? null,
    isNew: true,
    hasError: false,
    errorMessage: null,
    prevStart: start,
    prevEnd: end,
    originalStart: start,
    originalEnd: end,
  });

  this.isDirty = true;
}
private addMinutes(time: string, minutesToAdd: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutesToAdd;

  const hh = Math.floor(total / 60);
  const mm = total % 60;

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
  private validateSlotSilent(_day: DayAvailability, slot: TimeSlot): void {
  slot.hasError = false;
  slot.errorMessage = null;

  // אם שניהם ריקים – לא מציגים כלום
  if (!slot.start && !slot.end) return;

  // חסר אחד מהם
  if (!slot.start || !slot.end) {
    slot.hasError = true;
    slot.errorMessage = 'יש להשלים שעת התחלה וסיום';
    return;
  }

  // פורמט
  if (!this.isFullTime(slot.start) || !this.isFullTime(slot.end)) {
    slot.hasError = true;
    slot.errorMessage = 'פורמט שעה לא תקין';
    return;
  }

  // סדר שעות בסיסי
  const s = this.toMin(this.normalizeTime(slot.start));
  const e = this.toMin(this.normalizeTime(slot.end));
  if (e <= s) {
    slot.hasError = true;
    slot.errorMessage = 'שעת סיום חייבת להיות אחרי שעת התחלה';
    return;
  }
}


  removeSlot(day: DayAvailability, i: number) {
    if (!this.allowEdit) return;
    day.slots.splice(i, 1);
    this.isDirty = true;
  }

  /* ===================== SAVE FLOW ===================== */

 async saveAvailability() {
  if (this.isBusy()) return;

  this.setBusy('save');

  try {
    for (const day of this.days) {
      if (!day.active) continue;

      for (const slot of day.slots) {
        this.onSlotChange(day, slot);

        if (slot.hasError) {
          this.toast(slot.errorMessage || 'יש שגיאה בטווח שעות');
          return;
        }

        if (!slot.ridingTypeId) {
          slot.hasError = true;
          slot.errorMessage = 'חובה לבחור סוג רכיבה';
          this.toast('חובה לבחור סוג רכיבה');
          return;
        }

        slot.start = this.normalizeTime(slot.start);
        slot.end = this.normalizeTime(slot.end);

        const dayNum = this.toFarmDayNumber(day.key);
        const farmHours = this.farmHoursByDay[dayNum];

        if (farmHours) {
          if (
            this.toMin(slot.start) < this.toMin(farmHours.start) ||
            this.toMin(slot.end) > this.toMin(farmHours.end)
          ) {
this.toast(`ביום ${day.label}: השעות חייבות להיות בין ${farmHours.start} ל־${farmHours.end}`);            return;
          }
        }

        if (this.toMin(slot.end) <= this.toMin(slot.start)) {
this.toast(`ביום ${day.label}: שעת סיום חייבת להיות אחרי שעת התחלה`);          return;
        }
      }

      if (this.dayHasAnyOverlap(day)) {
        this.toast(`יש חפיפה בטווחים ביום ${day.label}`);
        return;
      }
    }

    if (!this.allowEdit && this.mode !== 'secretary') {
      this.toast('הזמינות נעולה לעריכה');
      return;
    }

    if (!this.isDirty) {
      this.toast('אין שינויים לשמירה');
      return;
    }

    const changedRanges = this.getChangedAvailabilityRanges();
    this.lastImpactRanges = changedRanges;

    for (const r of changedRanges) {
      const impact = await this.loadParentsImpactCountOnly(r.dayLabel, r.oldStart, r.oldEnd);

      if (impact && impact.lessons.length > 0) {
        this.confirmData = impact;
        return;
      }
    }

    await this.saveAvailabilityDirect();

    if (this.mode !== 'secretary') {
      await this.lockAvailabilityEdit();
    }

  } finally {
    this.setBusy(null);
  }
}
getLessonImpactLabel(lesson: ImpactedLesson): string {
  if (lesson.lessonType === 'סידרה') {
    if (lesson.isOpenEnded) {
      return 'סדרה ללא הגבלה';
    }

    if (lesson.seriesEndDate) {
      return `סדרה עד ${this.formatDateForDisplay(lesson.seriesEndDate)}`;
    }

    return `סדרה · ${lesson.repeatWeeks || 1} שבועות`;
  }

  if (lesson.lessonType === 'השלמה') return 'שיעור השלמה';
  if (lesson.appointmentKind === 'substitute') return 'שיעור מילוי מקום';
  if (lesson.lessonType === 'בודד') return 'שיעור בודד';

  return lesson.lessonType || lesson.appointmentKind || 'שיעור';
}

private formatDateForDisplay(dateValue: string): string {
  if (!dateValue) return '';

  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return dateValue;

  return d.toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}
  cancelLockConfirm() {
    this.lockConfirm = false;
  }

  async confirmLockAndSave() {
    this.lockConfirm = false;
    await this.saveAvailabilityDirect(); // ✅ שומר ל-weekly
    await this.lockAvailabilityEdit();
  }

  private async saveAvailabilityDirect() {
    if (!this.instructorIdNumber) return;

    const payload = this.buildWeeklyPayloadForSave();
    

    // 1) delete old
    const { error: delError } = await dbTenant()
      .from('instructor_weekly_availability')
      .delete()
      .eq('instructor_id_number', this.instructorIdNumber);

    if (delError) {
      console.error('❌ delete instructor_weekly_availability error', delError);
      this.toast('שגיאה בשמירה');
      return;
    }

    // 2) insert new
    if (payload.length) {
      const { error: insError } = await dbTenant().from('instructor_weekly_availability').insert(payload);

      if (insError) {
        console.error('❌ insert instructor_weekly_availability error', insError);
        this.toast('שגיאה בשמירה');
        return;
      }
    }

    this.isDirty = false;
    this.toast('✔ הזמינות נשמרה');
    this.originalDays = JSON.parse(JSON.stringify(this.days));
  }

  private buildWeeklyPayloadForSave(): Array<{
    instructor_id_number: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    lesson_ridding_type: UUID | null;
    lesson_type_mode: string | null;
  }> {
    const out: Array<{
      instructor_id_number: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      lesson_ridding_type: UUID | null;
      lesson_type_mode: string | null;
    }> = [];

    const instructor_id_number = this.instructorIdNumber!;

    for (const day of this.days) {
      if (!day.active) continue;

      const day_of_week = this.DAY_KEY_TO_NUM[day.key]; // 0..6
      if (!Number.isInteger(day_of_week)) continue;

      for (const s of day.slots) {
        // להתעלם משורה ריקה
        if (!s.start && !s.end) continue;

        if (!s.start || !s.end) continue;
        if (!this.isFullTime(s.start) || !this.isFullTime(s.end)) continue;

        out.push({
          instructor_id_number,
          day_of_week,
          start_time: this.toDbTime(s.start), // 'HH:MM:SS'
          end_time: this.toDbTime(s.end),
          lesson_ridding_type: s.ridingTypeId ?? null,
          lesson_type_mode: null,
        });
      }
    }

    return out;
  }

  private async lockAvailabilityEdit() {
    if (!this.userId) return;

    const { error } = await dbTenant().from('instructors').update({ allow_availability_edit: false }).eq('uid', this.userId);

    if (error) {
      console.error('❌ lockAvailabilityEdit error', error);
      return;
    }

    this.allowEdit = false;
  }

 async approveUpdate() {
  if (this.confirmData?.lessons?.length && !this.allImpactedLessonsHandled()) {
    this.toast('יש לטפל בכל השיעורים המושפעים לפני שמירת הזמינות');
    return;
  }

  if (this.isBusy()) return;

  this.confirmData = null;
  this.setBusy('save');

  try {
    await this.saveAvailabilityDirect();

    if (this.mode !== 'secretary') {
      await this.lockAvailabilityEdit();
    }
  } finally {
    this.setBusy(null);
  }
}
  cancelUpdate() {
    this.confirmData = null;
  }

  /* ===================== IMPACT + CHANGES ===================== */
private async loadParentsImpactCountOnly(
  dayHebrew: string,
  startTime: string,
  endTime: string,
): Promise<ConfirmData | null> {
  if (!this.instructorIdNumber) return null;

  const { data, error } = await dbTenant().rpc('get_impacted_lessons_by_availability', {
    p_instructor_id: this.instructorIdNumber,
    p_day_of_week: dayHebrew,
    p_start_time: this.toDbTime(startTime),
    p_end_time: this.toDbTime(endTime),
  });

  if (error) {
    console.warn('⚠️ impact check failed', error);
    return null;
  }

  const lessons: ImpactedLesson[] = (data || []).map((row: any) => ({
  lessonId: row.lesson_id,
  childId: row.child_id,
  childName: row.child_name || '—',
  lessonType: row.lesson_type || '—',
  appointmentKind: row.appointment_kind || '—',
  dayOfWeek: row.day_of_week || dayHebrew,
  startTime: this.trimToHHMM(row.start_time),
  endTime: this.trimToHHMM(row.end_time),
  anchorWeekStart: row.anchor_week_start || null,
  repeatWeeks: row.repeat_weeks ?? null,
  isOpenEnded: !!row.is_open_ended,
  seriesEndDate: row.series_end_date || null,
  handled: false,
  occurDate: row.effective_occur_date || row.occur_date || null,
effectiveOccurDate: row.effective_occur_date || null,
}));
  return { lessons };
}
  /** טווחים שהיו במקור ונעלמו עכשיו (לצורך השפעה על הורים) */
  private getChangedAvailabilityRanges(): { dayLabel: string; oldStart: string; oldEnd: string }[] {
  const ranges: { dayLabel: string; oldStart: string; oldEnd: string }[] = [];

  for (const oldDay of this.originalDays) {
    const newDay = this.days.find(d => d.key === oldDay.key);

    if (oldDay.active && (!newDay || !newDay.active)) {
      for (const s of oldDay.slots) {
        if (s.start && s.end) {
          ranges.push({
            dayLabel: oldDay.label,
            oldStart: this.normalizeTime(s.start),
            oldEnd: this.normalizeTime(s.end),
          });
        }
      }
      continue;
    }

    if (!oldDay.active || !newDay || !newDay.active) continue;

    for (const oldSlot of oldDay.slots) {
      if (!oldSlot.start || !oldSlot.end) continue;

      const oldStart = this.normalizeTime(oldSlot.start);
      const oldEnd = this.normalizeTime(oldSlot.end);

      const overlappingNewSlots = newDay.slots
        .filter(s => s.start && s.end)
        .map(s => ({
          start: this.normalizeTime(s.start!),
          end: this.normalizeTime(s.end!),
        }))
        .filter(s =>
          this.toMin(s.start) < this.toMin(oldEnd) &&
          this.toMin(s.end) > this.toMin(oldStart)
        )
        .sort((a, b) => this.toMin(a.start) - this.toMin(b.start));

      if (!overlappingNewSlots.length) {
        ranges.push({
          dayLabel: oldDay.label,
          oldStart,
          oldEnd,
        });
        continue;
      }

      let cursor = this.toMin(oldStart);
      const oldEndMin = this.toMin(oldEnd);

      for (const ns of overlappingNewSlots) {
        const nsStart = Math.max(this.toMin(ns.start), this.toMin(oldStart));
        const nsEnd = Math.min(this.toMin(ns.end), oldEndMin);

        if (cursor < nsStart) {
          ranges.push({
            dayLabel: oldDay.label,
            oldStart: this.minToTime(cursor),
            oldEnd: this.minToTime(nsStart),
          });
        }

        cursor = Math.max(cursor, nsEnd);
      }

      if (cursor < oldEndMin) {
        ranges.push({
          dayLabel: oldDay.label,
          oldStart: this.minToTime(cursor),
          oldEnd: this.minToTime(oldEndMin),
        });
      }
    }
  }

  return ranges;
}

  /* ===================== HELPERS ===================== */

  private normalizeTime(t: string | null): string {
    if (!t) return '';
    if (!this.isFullTime(t)) return t;

    const [hh, mm] = t.split(':');
    const h = Number(hh);
    const m = Number(mm);

    if (Number.isNaN(h) || Number.isNaN(m)) return t;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** ✅ מקבל גם 8:05 וגם 08:05 */
  private isFullTime(t: string | null): boolean {
    return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t);
  }

  private toDbTime(t: string): string {
    const hhmm = this.normalizeTime(t);
    return hhmm ? `${hhmm}:00` : '';
  }

  private toMin(t: string) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private revert(slot: TimeSlot) {
    const start = slot.prevStart ?? slot.originalStart ?? this.farmStart;
    const end = slot.prevEnd ?? slot.originalEnd ?? this.farmEnd;
    const rt = slot.prevRidingTypeId ?? slot.ridingTypeId ?? null;

    // ✅ חשוב: בטיק הבא כדי ש-ngModel לא ידרוס אותנו אחרי blur
    setTimeout(() => {
      slot.start = start;
      slot.end = end;
      slot.ridingTypeId = rt;
      slot.editSessionStarted = false;
      slot.hasError = false;
      slot.errorMessage = null;
      this.cdr.detectChanges();
    });
  }

  private hasOverlap(day: DayAvailability, currentSlot: TimeSlot): boolean {
  if (!currentSlot.start || !currentSlot.end) return false;

  const currentStart = this.toMin(currentSlot.start);
  const currentEnd = this.toMin(currentSlot.end);

  return day.slots.some(slot => {
    if (slot === currentSlot) return false;
    if (!slot.start || !slot.end) return false;

    const start = this.toMin(slot.start);
    const end = this.toMin(slot.end);

    return currentStart < end && currentEnd > start;
  });
}
  private dayHasAnyOverlap(day: DayAvailability): boolean {
    const slots = day.slots
      .filter((s): s is TimeSlot & { start: string; end: string } => !!s.start && !!s.end)
      .filter(s => this.isFullTime(s.start) && this.isFullTime(s.end))
      .map(s => ({
        start: this.toMin(this.normalizeTime(s.start)),
        end: this.toMin(this.normalizeTime(s.end)),
      }))
      .sort((a, b) => a.start - b.start);

    for (let i = 1; i < slots.length; i++) {
      if (slots[i].start < slots[i - 1].end) return true;
    }
    return false;
  }

  private toast(msg: string) {
    this.toastMessage = msg;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 2500);
  }
  public timeOptions: string[] = [];

private buildTimeOptions(): void {
  const options: string[] = [];

  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 15, 30, 45]) {
      options.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  this.timeOptions = options;
}
isSeriesImpactLesson(lesson: ImpactedLesson): boolean {
  return lesson.appointmentKind === 'therapy_series' || lesson.lessonType === 'סידרה';
}

allImpactedLessonsHandled(): boolean {
  return !!this.confirmData?.lessons?.length &&
    this.confirmData.lessons.every(l => l.handled);
}

getPendingImpactedLessonsCount(): number {
  return this.confirmData?.lessons?.filter(l => !l.handled).length ?? 0;
}

markImpactLessonHandled(
  lesson: ImpactedLesson,
  action: ImpactedLesson['handledAction']
): void {
  lesson.handled = true;
  lesson.handledAction = action;
}
async cancelImpactLessonWithMakeup(lesson: ImpactedLesson): Promise<void> {
  if (!lesson.lessonId || !lesson.occurDate) {
    this.toast('חסר תאריך מופע לשיעור הזה');
    return;
  }
if (this.isBusy()) return;
this.setBusy('cancel_lesson');
  lesson.handling = true;
const { data: farmSettings } = await dbTenant()
  .from('farm_settings')
  .select('farm_cancel_charge_target')
  .single();

const isBillable =
  farmSettings?.farm_cancel_charge_target === 'cancelled_lesson';

  try {
    const { error } = await dbTenant()
      .from('lesson_occurrence_exceptions')
      .upsert(
        {
          lesson_id: lesson.lessonId,
          occur_date: lesson.occurDate,
          status: 'בוטל',
          is_makeup_allowed: true,
          is_billable: isBillable,
          canceller_role: 'secretary',
          cancelled_at: new Date().toISOString(),
          note: 'בוטל בעקבות שינוי זמינות מדריך',
        },
        { onConflict: 'lesson_id,occur_date' }
      );

    if (error) throw error;
await this.notifyAvailabilityLessonAction({
  actionType: 'cancel_lesson_with_makeup',
  lesson,
});
    this.markImpactLessonHandled(lesson, 'cancelled_with_makeup');
    this.toast('השיעור בוטל עם אפשרות השלמה');
  } catch (e) {
    console.error('cancelImpactLessonWithMakeup failed', e);
    this.toast('שגיאה בביטול השיעור');
  } finally {
    lesson.handling = false;
    this.cdr.detectChanges();
      this.setBusy(null);

  }
}
async endImpactSeries(lesson: ImpactedLesson): Promise<void> {
  if (!lesson.lessonId) return;
if (this.isBusy()) return;
this.setBusy('end_series');
  const effectiveDate =
  lesson.effectiveOccurDate ||
  lesson.occurDate ||
  lesson.seriesEndDate ||
  new Date().toISOString().slice(0, 10);

  lesson.handling = true;

  try {
    const { error } = await dbTenant().rpc('end_lesson_series', {
      p_lesson_id: lesson.lessonId,
      p_effective_occur_date: effectiveDate,
      p_note: 'סיום סדרה בעקבות שינוי זמינות מדריך',
    });

    if (error) throw error;
await this.notifyAvailabilityLessonAction({
  actionType: 'end_series',
  lesson,
});
    this.markImpactLessonHandled(lesson, 'series_ended');
    this.toast('הסדרה הסתיימה');
  } catch (e) {
    console.error('endImpactSeries failed', e);
    this.toast('שגיאה בסיום הסדרה');
  } finally {
    lesson.handling = false;
    this.cdr.detectChanges();
      this.setBusy(null);

  }
}
async openImpactMoveSingle(lesson: ImpactedLesson): Promise<void> {
  const occurDate = lesson.occurDate || lesson.effectiveOccurDate;
if (this.isBusy()) return;
this.setBusy('move_slots');
  if (!lesson.childId || !occurDate) {
    this.toast('חסרים נתוני ילד או תאריך');
    return;
  }

  this.selectedImpactLesson = {
    ...lesson,
    occurDate,
  };

  this.impactMoveSlotsModal = {
    open: true,
    loading: true,
    saving: false,
    error: '',
    slots: [],
    selectedSlot: null,
  };

  try {
    const from = occurDate;
    const to = this.addDaysYmd(from, 30);

    const { data, error } = await dbTenant().rpc('find_makeup_slots_for_lesson_by_id_number', {
      p_child_id: lesson.childId,
      p_instructor_id: null,
      p_from_date: from,
      p_to_date: to,
    });

    if (error) throw error;
this.impactMoveSlotsModal.slots = (data || []).filter((s: any) => {
  const sameDate = s.occur_date === occurDate;
  const sameStart = String(s.start_time).slice(0, 5) === lesson.startTime;

  if (sameDate && sameStart) return false;

  // לא להציע סלוט שנמצא בטווח זמינות שהמזכירה כרגע מוחקת
  if (this.slotOverlapsRemovedAvailability(s)) return false;

  return true;
});
  } catch (e) {
    console.error('openImpactMoveSingle failed', e);
    this.impactMoveSlotsModal.error = 'שגיאה בטעינת אפשרויות להזזה';
  } finally {
    this.impactMoveSlotsModal.loading = false;
    this.cdr.detectChanges();
      this.setBusy(null);

  }
}
private addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
selectImpactMoveSlot(slot: any): void {
  this.impactMoveSlotsModal.selectedSlot = slot;
}

confirmImpactMove(): void {
  const lesson = this.selectedImpactLesson;
  const slot = this.impactMoveSlotsModal.selectedSlot;

  if (!lesson || !slot) return;

  const date = slot.occur_date || slot.lesson_date;
  const start = String(slot.start_time || slot.start).slice(0, 5);
  const end = String(slot.end_time || slot.end).slice(0, 5);

  this.impactMoveConfirmModal = {
    open: true,
    childName: lesson.childName,
    originalDate: lesson.occurDate || '',
    originalTime: `${lesson.startTime}–${lesson.endTime}`,
    newDate: date,
    newTime: `${start}–${end}`,
    newInstructor: slot.instructor_name || String(slot.instructor_id || ''),
    slot,
  };
}
async approveImpactMoveConfirm(): Promise<void> {
  const lesson = this.selectedImpactLesson;
  const slot = this.impactMoveConfirmModal.slot || this.impactMoveSlotsModal.selectedSlot;

  if (!lesson || !slot || !lesson.occurDate) {
    this.toast('חסר סלוט להזזה');
    return;
  }
if (this.isBusy()) return;
this.setBusy('move_lesson');

  const date = slot.occur_date || slot.lesson_date;
  const start = String(slot.start_time || slot.start).slice(0, 5);
  const end = String(slot.end_time || slot.end).slice(0, 5);

  const newStartDatetime = `${date}T${start}:00`;
  const newEndDatetime = `${date}T${end}:00`;

  this.impactMoveSlotsModal.saving = true;

  try {
    const { error } = await dbTenant().rpc('move_lesson_occurrence', {
      p_lesson_id: lesson.lessonId,
      p_occur_date: lesson.occurDate,
      p_new_instructor_id: slot.instructor_id,
      p_new_start_datetime: newStartDatetime,
      p_new_end_datetime: newEndDatetime,
      p_note: 'הוזז בעקבות שינוי זמינות מדריך',
      p_created_by_role: 'secretary',
      p_created_by_uid: null,
    });

    if (error) throw error;
await this.notifyAvailabilityLessonAction({
  actionType: 'move_lesson',
  lesson,
  newDate: date,
  newStartTime: start,
  newEndTime: end,
});
    this.markImpactLessonHandled(lesson, 'moved');
    this.toast('השיעור הוזז בהצלחה');

    this.impactMoveConfirmModal.open = false;
    this.impactMoveSlotsModal.open = false;
    this.impactMoveSlotsModal.selectedSlot = null;
    this.selectedImpactLesson = null;
    await this.refreshImpactLessons();

  } catch (e) {
    console.error('approveImpactMoveConfirm failed', e);
    this.toast('שגיאה בהזזת השיעור');
  } finally {
    this.impactMoveSlotsModal.saving = false;
    this.cdr.detectChanges();
      this.setBusy(null);

  }
}
async openImpactMoveSeries(lesson: ImpactedLesson): Promise<void> {
  this.toast('הזזת סדרה עדיין לא זמינה — חסרה פונקציית move_lesson_series');
}
private minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
private async refreshImpactLessons(): Promise<void> {
  if (!this.lastImpactRanges.length) {
    this.confirmData = null;
    return;
  }

  const allLessons: ImpactedLesson[] = [];

  for (const r of this.lastImpactRanges) {
    const impact = await this.loadParentsImpactCountOnly(
      r.dayLabel,
      r.oldStart,
      r.oldEnd
    );

    if (impact?.lessons?.length) {
      allLessons.push(...impact.lessons);
    }
  }

  this.confirmData = {
    lessons: allLessons,
  };

  this.cdr.detectChanges();
}
private slotOverlapsRemovedAvailability(slot: any): boolean {
  const slotDate = String(slot.occur_date || slot.lesson_date || '').slice(0, 10);
  const slotStart = String(slot.start_time || slot.start || '').slice(0, 5);
  const slotEnd = String(slot.end_time || slot.end || '').slice(0, 5);
  const instructorId = String(slot.instructor_id || '');

  if (!slotDate || !slotStart || !slotEnd) return false;

  const slotDayLabel = this.getHebrewDayFromYmd(slotDate);

  return this.lastImpactRanges.some(r => {
    return (
      r.dayLabel === slotDayLabel &&
      this.toMin(slotStart) < this.toMin(r.oldEnd) &&
      this.toMin(slotEnd) > this.toMin(r.oldStart) &&
      (!instructorId || instructorId === this.instructorIdNumber)
    );
  });
}
private getHebrewDayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return days[date.getDay()];
}
private async notifyAvailabilityLessonAction(payload: {
  actionType: 'move_lesson' | 'cancel_lesson_with_makeup' | 'end_series';
  lesson: ImpactedLesson;
  newDate?: string | null;
  newStartTime?: string | null;
  newEndTime?: string | null;
}): Promise<void> {
  try {
    const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
    await ensureTenantContextReady();

    const tenant = requireTenant();

    const resp = await fetch(
      'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifyAvailabilityLessonAction',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantSchema: tenant.schema,
          tenantId: tenant.id,
          actionType: payload.actionType,
          lessonId: payload.lesson.lessonId,
          childId: payload.lesson.childId,
          instructorId: this.instructorIdNumber,
          originalDate: payload.lesson.occurDate || payload.lesson.effectiveOccurDate,
          originalStartTime: payload.lesson.startTime,
          originalEndTime: payload.lesson.endTime,
          newDate: payload.newDate ?? null,
          newStartTime: payload.newStartTime ?? null,
          newEndTime: payload.newEndTime ?? null,
          note: 'פעולה בעקבות שינוי זמינות מדריך',
        }),
      }
    );

    const json = await resp.json().catch(() => null);

    if (!resp.ok || json?.mailOk === false) {
      this.toast(json?.warning || 'הפעולה בוצעה, אך שליחת מייל נכשלה');
    }
  } catch (e) {
    console.error('notifyAvailabilityLessonAction failed', e);
    this.toast('הפעולה בוצעה, אך שליחת מייל נכשלה');
  }
}
private setBusy(action: string | null): void {
  this.busyAction = action;
  this.cdr.detectChanges();
}

isBusy(): boolean {
  return !!this.busyAction;
}

getBusyText(): string {
  switch (this.busyAction) {
    case 'cancel_lesson':
      return 'מבטלת שיעור...';
    case 'end_series':
      return 'מסיימת סדרה...';
    case 'move_slots':
      return 'טוענת אפשרויות הזזה...';
    case 'move_lesson':
      return 'מזיזה שיעור...';
    case 'save':
      return 'שומרת זמינות...';
    case 'save_notifications':
      return 'שומרת העדפות התראות...';
    default:
      return 'מבצעת פעולה...';
  }
}
}

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';
import { FarmSettingsService } from '../../services/farm-settings.service';

/* ===================== TYPES ===================== */

type UUID = string;

interface TimeSlot {
  start: string;
  end: string;
  ridingTypeId: UUID | null;

  isNew?: boolean;
  wasUpdated?: boolean;

  originalStart?: string;
  originalEnd?: string;

  prevStart?: string;
  prevEnd?: string;
  prevRidingTypeId?: UUID | null;

  flashError?: boolean;
}

interface DayAvailability {
  key: string;
  label: string;
  active: boolean;
  slots: TimeSlot[];
}

interface RidingType {
  id: UUID;
  code: string;
  name: string;
  max_participants: number | null;
  active: boolean;
}

interface NotificationPrefs {
  cancelLesson: boolean;
  reminder: boolean;
  monthlyReport: boolean;
}

/** ✅ רק מספר, בלי רשימה */
interface ConfirmData {
  parentsCount: number;
}

interface FarmSettings {
  operating_hours_start?: string | null;
  operating_hours_end?: string | null;
  lesson_duration_minutes?: number | null;
  working_days?: number[] | null;
  farm_id?: UUID | null;
}

/* ===================== COMPONENT ===================== */

@Component({
  selector: 'app-availability-tab',
  standalone: true,
  templateUrl: './availability-tab.html',
  styleUrls: ['./availability-tab.scss'],
  imports: [
    CommonModule,
    FormsModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
  ],
})
export class AvailabilityTabComponent implements OnInit {
  public userId: string | null = null;
  public instructorIdNumber: string | null = null;

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

  public notif: NotificationPrefs = {
    cancelLesson: true,
    reminder: true,
    monthlyReport: false,
  };

  public confirmData: ConfirmData | null = null;

  public toastMessage = '';
  private toastTimeout: any;

  private originalDays: DayAvailability[] = [];

  constructor(
    private cdr: ChangeDetectorRef,
    private farmSettingsService: FarmSettingsService,
  ) {}

  /* ===================== INIT ===================== */

  async ngOnInit() {
    await this.loadUserId();
    await this.loadInstructorRecord();
    await this.loadFarmSettings();
    await this.loadRidingTypes();
    this.loadDefaultsIfEmpty();
    this.ensureSlotsHaveDefaults();
  }

  private async loadUserId() {
    const auth = getAuth();
    this.userId = auth.currentUser?.uid ?? null;
  }

  /* ===================== FARM SETTINGS ===================== */

  private async loadFarmSettings() {
    
    try {
      const settings = (await this.farmSettingsService.loadSettings()) as FarmSettings | null;
      if (!settings) return;
if (Array.isArray(settings.working_days)) {
  this.farmWorkingDays = this.normalizeWorkingDays(settings.working_days);
  console.log('🏡 farmWorkingDays normalized:', this.farmWorkingDays);
}
console.log('🏡 SETTINGS:', settings);
console.log('🏡 working_days:', settings?.working_days);
console.log('🏡 farmWorkingDays used:', this.farmWorkingDays);

      if (settings.farm_id) this.farmId = settings.farm_id;

      if (settings.operating_hours_start)
        this.farmStart = settings.operating_hours_start.slice(0, 5);

      if (settings.operating_hours_end)
        this.farmEnd = settings.operating_hours_end.slice(0, 5);

      if (settings.lesson_duration_minutes)
        this.lessonDuration = settings.lesson_duration_minutes;

      if (Array.isArray(settings.working_days))
        this.farmWorkingDays = settings.working_days;

    } catch (err) {
      console.error('❌ loadFarmSettings failed', err);
    }
  }

  /* ===================== RIDING TYPES ===================== */

  private async loadRidingTypes() {
    const { data, error } = await dbTenant()
      .schema('bereshit_farm')
      .from('riding_types')
      .select('id, code, name, max_participants, active')
      .eq('active', true)
      .order('name');

    if (error) {
      console.error('❌ loadRidingTypes error', error);
      this.ridingTypes = [];
      
      return;
    }

  this.ridingTypes = (data || []).slice();

this.ridingTypes.sort((a, b) => {
  const aIsBreak = a.name.includes('הפסק');
  const bIsBreak = b.name.includes('הפסק');

  if (aIsBreak && !bIsBreak) return 1;
  if (!aIsBreak && bIsBreak) return -1;

  return a.name.localeCompare(b.name, 'he');
});

  }

  /* ===================== INSTRUCTOR ===================== */

  private async loadInstructorRecord() {
    if (!this.userId) return;

    const { data, error } = await dbTenant()
      .from('instructors')
      .select('id_number, availability, notify, allow_availability_edit')
      .eq('uid', this.userId)
      .maybeSingle();

    if (error) {
      console.error('❌ loadInstructorRecord error', error);
      return;
    }
    if (!data) return;

    this.instructorIdNumber = data.id_number;
    this.allowEdit = data.allow_availability_edit ?? true;

    if (data.availability) {
      const raw = typeof data.availability === 'string'
        ? JSON.parse(data.availability)
        : data.availability;

      this.days = raw;
      this.originalDays = JSON.parse(JSON.stringify(this.days));
    }

    if (data.notify) {
      this.notif = typeof data.notify === 'string'
        ? JSON.parse(data.notify)
        : data.notify;
    }
  }

  /* ===================== DAYS ===================== */

 private loadDefaultsIfEmpty() {
  if (this.days.length) return;

  this.days = [
    { key: 'sun', label: 'ראשון', active: false, slots: [] },
    { key: 'mon', label: 'שני', active: false, slots: [] },
    { key: 'tue', label: 'שלישי', active: false, slots: [] },
    { key: 'wed', label: 'רביעי', active: false, slots: [] },
    { key: 'thu', label: 'חמישי', active: false, slots: [] },
    { key: 'fri', label: 'שישי', active: false, slots: [] },
    { key: 'sat', label: 'שבת', active: false, slots: [] },
  ];
}

onTimeTyping(day: DayAvailability, slot: TimeSlot) {
  if (!this.allowEdit) return;

  this.isDirty = true;

  // אם שני הזמנים כבר מלאים → בדיקה מיידית
  if (this.isFullTime(slot.start) && this.isFullTime(slot.end)) {
    const start = this.toMin(this.normalizeTime(slot.start));
    const end = this.toMin(this.normalizeTime(slot.end));

    if (end <= start) {
      this.toast('שעת התחלה לא יכולה להיות מאוחרת משעת הסיום');
      slot.flashError = true;
      return;
    }

    slot.flashError = false;
  }
}
private normalizeWorkingDays(days: number[]): number[] {
  // אם כבר 1-7
  const has7 = days.includes(7);
  const has0 = days.includes(0);

  if (has7 && !has0) return days;         // 1-7
  if (has0 && !has7) return days.map(d => d === 0 ? 7 : d); // 0-6 -> 1-7

  // fallback: לא נוגעים
  return days;
}

  private ensureSlotsHaveDefaults() {
    const defaultType = this.ridingTypes[0]?.id ?? null;

    for (const day of this.days) {
      for (const slot of day.slots) {
        slot.ridingTypeId ??= defaultType;

        // snapshot לשחזור
        slot.prevStart ??= slot.start;
        slot.prevEnd ??= slot.end;
        slot.prevRidingTypeId ??= slot.ridingTypeId;

        slot.originalStart ??= slot.start;
        slot.originalEnd ??= slot.end;
      }
    }
  }

  isFarmWorkingDay(dayKey: string): boolean {
    const map: Record<string, number> = {
      sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7,
    };
    // אם אין הגדרה בחווה – לא לחסום
    if (!this.farmWorkingDays?.length) return true;
    return this.farmWorkingDays.includes(map[dayKey]);
  }

  toggleDay(day: DayAvailability) {
    if (!this.allowEdit) return;

    if (day.active && !day.slots.length) {
      day.slots.push({
        start: this.farmStart,
        end: this.addMinutes(this.farmStart, this.lessonDuration),
        ridingTypeId: this.ridingTypes[0]?.id ?? null,
        isNew: true,
      });
    }

    if (!day.active) day.slots = [];
    this.isDirty = true;
  }

  /* ===================== SLOTS ===================== */

  markDirty() {
    if (!this.allowEdit) return;
    this.isDirty = true;
  }

  onSlotFocus(slot: TimeSlot) {
    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId;
  }

  /** ✅ ולידציה לשעות — על blur (זה הפתרון לכתיבה ידנית) */
  onTimeBlur(day: DayAvailability, slot: TimeSlot) {
    if (!this.allowEdit) return;

    // אם עוד לא הושלם זמן – לא לעשות כלום (לא להחזיר אחורה בזמן הקלדה)
    if (!this.isFullTime(slot.start) || !this.isFullTime(slot.end)) {
      return;
    }

    slot.start = this.normalizeTime(slot.start);
    slot.end   = this.normalizeTime(slot.end);

    // שעות חווה
    if (this.toMin(slot.start) < this.toMin(this.farmStart)) {
      this.toast(`שעת התחלה לא יכולה להיות לפני ${this.farmStart}`);
      this.revert(slot);
      return;
    }

    if (this.toMin(slot.end) > this.toMin(this.farmEnd)) {
      this.toast(`שעת סיום לא יכולה להיות אחרי ${this.farmEnd}`);
      this.revert(slot);
      return;
    }

    // סוף אחרי התחלה
    if (this.toMin(slot.end) <= this.toMin(slot.start)) {
      this.toast('שעת סיום חייבת להיות אחרי שעת התחלה');
      this.revert(slot);
      return;
    }

    // חפיפות
    if (this.hasOverlap(day, slot)) {
      this.toast('יש חפיפה עם טווח זמן אחר באותו יום');
      this.revert(slot);
      return;
    }

    // הכל תקין → לשמור snapshot
    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId;

    slot.wasUpdated = true;
    this.isDirty = true;
  }

  onRidingTypeChange(day: DayAvailability, slot: TimeSlot) {
    if (!this.allowEdit) return;

    // לא מחזירים אחורה על רכיבה, רק מסמנים dirty
    slot.prevRidingTypeId = slot.ridingTypeId;
    slot.wasUpdated = true;
    this.isDirty = true;

    // אם רוצים ולידציה "חובה לבחור" רק בשמירה – נשאיר בשמירה (לא להציק באמצע)
  }

  addSlot(day: DayAvailability) {
    if (!this.allowEdit) return;

    const last = day.slots[day.slots.length - 1];
    const start = last ? last.end : this.farmStart;
    const end = this.addMinutes(start, this.lessonDuration);

    if (this.toMin(end) > this.toMin(this.farmEnd)) {
      this.toast('אין מקום להוסיף טווח נוסף בתוך שעות החווה');
      return;
    }

    day.slots.push({
      start,
      end,
      ridingTypeId: this.ridingTypes[0]?.id ?? null,
      isNew: true,
    });

    this.isDirty = true;
  }

  removeSlot(day: DayAvailability, i: number) {
    if (!this.allowEdit) return;
    day.slots.splice(i, 1);
    this.isDirty = true;
  }

  /* ===================== SAVE ===================== */

  async saveAvailability() {
    // ולידציה בסיסית לפני שמירה (כולל חובה לבחור רכיבה)
    for (const day of this.days) {
      if (!day.active) continue;

      for (const slot of day.slots) {
        if (!this.isFullTime(slot.start) || !this.isFullTime(slot.end)) {
          this.toast('יש טווח עם שעה לא תקינה');
          return;
        }

        slot.start = this.normalizeTime(slot.start);
        slot.end   = this.normalizeTime(slot.end);

        if (this.toMin(slot.end) <= this.toMin(slot.start)) {
          this.toast('שעת סיום חייבת להיות אחרי שעת התחלה');
          return;
        }

        if (this.toMin(slot.start) < this.toMin(this.farmStart) || this.toMin(slot.end) > this.toMin(this.farmEnd)) {
          this.toast(`השעות חייבות להיות בין ${this.farmStart} ל־${this.farmEnd}`);
          return;
        }

        if (!slot.ridingTypeId) {
          this.toast('חובה לבחור סוג רכיבה');
          return;
        }
      }

      // בדיקת חפיפות בין כל הסלוטים ביום (לא רק האחרון שנגעו בו)
      if (this.dayHasAnyOverlap(day)) {
        this.toast(`יש חפיפה בטווחים ביום ${day.label}`);
        return;
      }
    }

    if (!this.allowEdit) {
      this.toast('הזמינות נעולה לעריכה');
      return;
    }

    if (!this.isDirty) {
      this.toast('אין שינויים לשמירה');
      return;
    }

    const changedRanges = this.getChangedAvailabilityRanges();

    for (const r of changedRanges) {
      const impact = await this.loadParentsImpactCountOnly(
        r.dayLabel,
        r.oldStart,
        r.oldEnd
      );

      if (impact && impact.parentsCount > 0) {
        this.confirmData = impact; // פופאפ (רק מספר)
        return; // עוצר עד אישור
      }
    }

    // אין פגיעה → ממשיכים לנעילה
    this.lockConfirm = true;
  }

  cancelLockConfirm() {
    this.lockConfirm = false;
  }

  async confirmLockAndSave() {
    this.lockConfirm = false;
    await this.saveAvailabilityDirect();
    await this.lockAvailabilityEdit();
  }

  private async saveAvailabilityDirect() {
    if (!this.userId) return;

    const { error } = await dbTenant()
      .from('instructors')
      .update({ availability: JSON.stringify(this.days) })
      .eq('uid', this.userId);

    if (error) {
      console.error('❌ saveAvailabilityDirect error', error);
      this.toast('שגיאה בשמירה');
      return;
    }

    this.isDirty = false;
    this.toast('✔ הזמינות נשמרה');
    this.originalDays = JSON.parse(JSON.stringify(this.days));
  }

  private async lockAvailabilityEdit() {
    if (!this.userId) return;

    const { error } = await dbTenant()
      .from('instructors')
      .update({ allow_availability_edit: false })
      .eq('uid', this.userId);

    if (error) {
      console.error('❌ lockAvailabilityEdit error', error);
      return;
    }

    this.allowEdit = false;
  }

  async approveUpdate() {
    this.confirmData = null;
    this.lockConfirm = true; // ממשיכים לזרימת נעילה ושמירה
  }

  cancelUpdate() {
    this.confirmData = null;
  }

  /* ===================== NOTIFICATIONS ===================== */

  async saveNotifications() {
    if (!this.userId) return;

    const { error } = await dbTenant()
      .from('instructors')
      .update({ notify: JSON.stringify(this.notif) })
      .eq('uid', this.userId);

    if (error) {
      console.error('❌ saveNotifications error', error);
      this.toast('שגיאה בשמירת התראות');
      return;
    }

    this.toast('✔ העדפות התראות נשמרו');
  }

  /* ===================== IMPACT (COUNT ONLY) ===================== */

  private async loadParentsImpactCountOnly(
    dayHebrew: string,
    startTime: string,
    endTime: string
  ): Promise<ConfirmData | null> {
    // אם אין מדריך → אין מה לבדוק
    if (!this.instructorIdNumber) return null;

    const { data, error } = await dbTenant()
      .rpc('get_impacted_parents_by_availability', {
        p_instructor_id: this.instructorIdNumber,
        p_day_of_week: dayHebrew,
        p_start_time: startTime,
        p_end_time: endTime,
      });

    if (error || !data) {
      // לא לחסום שמירה אם ה-RPC לא עובד
      console.warn('⚠️ impact check skipped – RPC missing/failed', error);
      return null;
    }

    // תרחיש 1: ה-RPC מחזיר מספר { parents_count: 5 }
    if (typeof data === 'object' && !Array.isArray(data) && (data as any).parents_count != null) {
      return { parentsCount: Number((data as any).parents_count) || 0 };
    }

    // תרחיש 2: ה-RPC מחזיר רשומות – נספור UNIQUE הורים בלי לשמור שמות
    if (Array.isArray(data)) {
      const unique = new Set<string>();

      for (const row of data) {
        // נעדיף parent_id/parent_uid אם קיים, אחרת fallback לשם (רק לספירה פנימית)
        const key =
          (row?.parent_id ?? row?.parent_uid ?? row?.parent_email ?? row?.parent_name ?? '') + '';

        if (key) unique.add(key);
      }

      // אם לא מצאנו key בכלל – ניפול על אורך הרשומות (לפחות משהו)
      const count = unique.size > 0 ? unique.size : data.length;

      return { parentsCount: count };
    }

    return null;
  }

  /* ===================== CHANGES DETECTION ===================== */

  private getChangedAvailabilityRanges(): {
    dayLabel: string;
    oldStart: string;
    oldEnd: string;
  }[] {
    const ranges: { dayLabel: string; oldStart: string; oldEnd: string }[] = [];

    for (const oldDay of this.originalDays) {
      const newDay = this.days.find(d => d.key === oldDay.key);

      if (oldDay.active && (!newDay || !newDay.active)) {
        for (const s of oldDay.slots) {
          ranges.push({ dayLabel: oldDay.label, oldStart: s.start, oldEnd: s.end });
        }
        continue;
      }

      if (!newDay) continue;

      for (const oldSlot of oldDay.slots) {
        const stillExists = newDay.slots.some(
          s => s.start === oldSlot.start && s.end === oldSlot.end
        );

        if (!stillExists) {
          ranges.push({ dayLabel: oldDay.label, oldStart: oldSlot.start, oldEnd: oldSlot.end });
        }
      }
    }

    return ranges;
  }

  /* ===================== HELPERS ===================== */

  private normalizeTime(t: string): string {
    if (!this.isFullTime(t)) return t;

    const [hh, mm] = t.split(':');
    const h = Number(hh);
    const m = Number(mm);

    if (Number.isNaN(h) || Number.isNaN(m)) return t;

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** ✅ מקבל גם 8:05 וגם 08:05 */
  private isFullTime(t: string): boolean {
    return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t);
  }

  private addMinutes(time: string, min: number): string {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + min);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private toMin(t: string) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private revert(slot: TimeSlot) {
    slot.start = slot.prevStart ?? slot.originalStart ?? this.farmStart;
    slot.end = slot.prevEnd ?? slot.originalEnd ?? this.farmEnd;
    slot.ridingTypeId = slot.prevRidingTypeId ?? slot.ridingTypeId;
  }

  private hasOverlap(day: DayAvailability, target: TimeSlot): boolean {
    if (!this.isFullTime(target.start) || !this.isFullTime(target.end)) return false;

    const a1 = this.toMin(this.normalizeTime(target.start));
    const a2 = this.toMin(this.normalizeTime(target.end));

    return day.slots.some(s => {
      if (s === target) return false;
      if (!this.isFullTime(s.start) || !this.isFullTime(s.end)) return false;

      const b1 = this.toMin(this.normalizeTime(s.start));
      const b2 = this.toMin(this.normalizeTime(s.end));

      return a1 < b2 && a2 > b1;
    });
  }

  private dayHasAnyOverlap(day: DayAvailability): boolean {
    const slots = day.slots
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
}

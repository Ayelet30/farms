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

interface ConfirmData {
  parents: { name: string; child: string }[];
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
  /* ===================== STATE ===================== */

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

  private deletedSlots: { dayKey: string; start: string; end: string }[] = [];

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
    this.ensureSlotsHaveDefaults(); // ✅ היה חסר
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
      return;
    }

    this.ridingTypes = data || [];
  }

  /* ===================== INSTRUCTOR ===================== */

  private async loadInstructorRecord() {
    if (!this.userId) return;

    const { data } = await dbTenant()
      .from('instructors')
      .select('id_number, availability, notify, allow_availability_edit')
      .eq('uid', this.userId)
      .maybeSingle();

    if (!data) return;

    this.instructorIdNumber = data.id_number;
    this.allowEdit = data.allow_availability_edit ?? true;

    if (data.availability) {
      const raw = typeof data.availability === 'string'
        ? JSON.parse(data.availability)
        : data.availability;

      this.days = raw;
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
    ];
  }

  /** ✅ היה חסר – פותר את שגיאת ensureSlotsHaveDefaults */
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
      }
    }
  }

  isFarmWorkingDay(dayKey: string): boolean {
    const map: Record<string, number> = {
      sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7,
    };
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

  onSlotFocus(slot: TimeSlot) {
    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId;
  }

  onSlotChange(day: DayAvailability, slot: TimeSlot) {
    if (!slot.start || !slot.end) return;

    if (this.toMin(slot.end) <= this.toMin(slot.start)) {
      this.revert(slot);
      this.toast('שעת סיום חייבת להיות אחרי שעת התחלה');
      return;
    }

    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId;
    slot.wasUpdated = true;
    this.isDirty = true;
  }

  addSlot(day: DayAvailability) {
    if (!this.allowEdit) return;

    const last = day.slots[day.slots.length - 1];
    const start = last ? last.end : this.farmStart;
    const end = this.addMinutes(start, this.lessonDuration);

    if (this.toMin(end) > this.toMin(this.farmEnd)) return;

    day.slots.push({
      start,
      end,
      ridingTypeId: this.ridingTypes[0]?.id ?? null,
      isNew: true,
    });

    this.isDirty = true;
  }

  removeSlot(day: DayAvailability, i: number) {
    day.slots.splice(i, 1);
    this.isDirty = true;
  }

  /* ===================== SAVE ===================== */

  async saveAvailability() {
  if (!this.allowEdit) {
    this.toast('הזמינות נעולה לעריכה');
    return;
  }

  if (!this.isDirty) {
    this.toast('אין שינויים לשמירה');
    return;
  }

  // 🔴 אם כבר קיימת זמינות פעילה → פופאפ אזהרה
  const hasExistingAvailability = this.days.some(
    d => d.active && d.slots && d.slots.length > 0
  );

  if (hasExistingAvailability) {
    this.confirmData = {
      parents: [],        // כרגע בלי שמות – כמו שהיה פעם
      parentsCount: 1,    // מספיק כדי לפתוח פופאפ
    };
    return; // ⛔ עוצרים כאן
  }

  // אם אין זמינות קיימת – ממשיכים לנעילה
  this.lockConfirm = true;
}

  /* ===================== NOTIFICATIONS ===================== */

  async saveNotifications() {
    if (!this.userId) return;

    await dbTenant()
      .from('instructors')
      .update({ notify: JSON.stringify(this.notif) })
      .eq('uid', this.userId);

    this.toast('✔ העדפות התראות נשמרו');
  }

  /* ===================== HELPERS ===================== */

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
    slot.start = slot.prevStart!;
    slot.end = slot.prevEnd!;
    slot.ridingTypeId = slot.prevRidingTypeId!;
  }

  private toast(msg: string) {
    this.toastMessage = msg;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 2500);
  }
  cancelLockConfirm() {
  this.lockConfirm = false;
}

async confirmLockAndSave() {
  this.lockConfirm = false;

  await this.lockAvailabilityEdit();
  await this.saveAvailability();
}

private async lockAvailabilityEdit() {
  if (!this.userId) return;

  try {
    await dbTenant()
      .from('instructors')
      .update({ allow_availability_edit: false })
      .eq('uid', this.userId);

    this.allowEdit = false;
  } catch (err) {
    console.error('❌ lockAvailabilityEdit error', err);
  }
}
async approveUpdate() {
  this.confirmData = null;

  // בדיוק כמו הזרימה הקיימת:
  this.lockConfirm = true;
}
cancelUpdate() {
  this.confirmData = null;
}

}

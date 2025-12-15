import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';
import { FarmSettingsService } from '../../services/farm-settings.service';

type LessonType = 'regular' | 'double' | 'single' | 'group' | 'both';

interface BreakRange {
  start: string;
  end: string;
}

interface TimeSlot {
  start: string;
  end: string;
  lessonType: LessonType;
  isNew?: boolean;
  wasUpdated?: boolean;
  originalStart?: string;
  originalEnd?: string;
}

interface DayAvailability {
  key: string;
  label: string;
  active: boolean;
  slots: TimeSlot[];
  breaks: BreakRange[];
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

  public allowEdit = true;
  public isDirty = false;
  public lockConfirm = false;

  public days: DayAvailability[] = [];

  public notif: NotificationPrefs = {
    cancelLesson: true,
    reminder: true,
    monthlyReport: false,
  };

  public farmStart = '08:00';
  public farmEnd = '17:00';
  public lessonDuration = 60;

  public lessonTypeOptions = [
    { value: 'double_only', label: 'שיעור כפול בלבד' },
    { value: 'both', label: 'גם וגם' },
    { value: 'double or both', label: 'כפול או גם וגם' },
    { value: 'break', label: 'הפסקה' },
  ];

  public toastMessage = '';
  private toastTimeout: any;

  public confirmData: ConfirmData | null = null;
  private pendingPayload: DayAvailability[] | null = null;

  private deletedSlots: { dayKey: string; start: string; end: string }[] = [];

  constructor(
    private cdr: ChangeDetectorRef,
    private farmSettings: FarmSettingsService,
  ) {}

  /* ============================ INIT ============================ */

  async ngOnInit() {
    await this.loadUserId();
    await this.loadInstructorRecord();
    await this.loadFarmSettings();
    this.loadDefaultsIfEmpty();
  }

  private async loadUserId() {
    const auth = getAuth();
    this.userId = auth.currentUser?.uid ?? null;
  }

  private async loadInstructorRecord() {
    if (!this.userId) return;

    const { data, error } = await dbTenant()
      .from('instructors')
      .select('id_number, availability, notify, allow_availability_edit')
      .eq('uid', this.userId)
      .maybeSingle();

    if (error) {
      console.error('loadInstructorRecord error:', error);
      return;
    }

    if (!data) {
      this.showToast('❌ לא נמצא מדריך עבור המשתמש המחובר');
      return;
    }

    this.instructorIdNumber = data.id_number;
    this.allowEdit = data.allow_availability_edit ?? true;

    if (data.availability) {
      try {
        const raw =
          typeof data.availability === 'string'
            ? JSON.parse(data.availability)
            : data.availability;

        if (Array.isArray(raw)) this.days = raw;
      } catch (e) {
        console.error('Failed to parse availability JSON', e);
      }
    }

    if (data.notify) {
      try {
        this.notif =
          typeof data.notify === 'string'
            ? JSON.parse(data.notify)
            : data.notify;
      } catch (e) {
        console.error('Failed to parse notify JSON', e);
      }
    }
  }

  private async loadFarmSettings() {
    try {
      const settings = await this.farmSettings.loadSettings();
      if (!settings) return;

      if (settings.operating_hours_start)
        this.farmStart = settings.operating_hours_start.slice(0, 5);

      if (settings.operating_hours_end)
        this.farmEnd = settings.operating_hours_end.slice(0, 5);

      if (settings.lesson_duration_minutes)
        this.lessonDuration = settings.lesson_duration_minutes;
    } catch (err) {
      console.error('Failed to load farm settings', err);
    }
  }

  private loadDefaultsIfEmpty() {
    if (this.days && this.days.length > 0) return;

    const mk = (k: string, label: string): DayAvailability => ({
      key: k,
      label,
      active: false,
      slots: [],
      breaks: [],
    });

    this.days = [
      mk('sun', 'ראשון'),
      mk('mon', 'שני'),
      mk('tue', 'שלישי'),
      mk('wed', 'רביעי'),
      mk('thu', 'חמישי'),
    ];
  }

  /* ============================ HELPERS ============================ */

  private markDirty() {
    this.isDirty = true;
  }

  showToast(msg: string) {
    this.toastMessage = msg;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 2500);
  }

  private timeToMinutes(t: string): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map((x) => Number(x) || 0);
    return h * 60 + m;
  }

  private addMinutesToTime(time: string, minutes: number): string {
    const [h, m] = time.split(':').map((x) => Number(x) || 0);
    const base = new Date(2000, 0, 1, h, m + minutes);
    const hh = String(base.getHours()).padStart(2, '0');
    const mm = String(base.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private getSortedSlots(day: DayAvailability): TimeSlot[] {
    return [...day.slots].sort(
      (a, b) => this.timeToMinutes(a.start) - this.timeToMinutes(b.start),
    );
  }

  private mapDayKeyToNumber(key: string): number {
    const map: any = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    return map[key] ?? 0;
  }

  /**
   * דואג שאין חפיפות ושכל טווח "נלחץ" בין הקודם לבא אחריו
   */
  private enforceSlotOrderConstraints(day: DayAvailability, slot: TimeSlot) {
    const sorted = this.getSortedSlots(day);
    const index = sorted.indexOf(slot);

    const prev = index > 0 ? sorted[index - 1] : null;
    const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

    // תיקוף מול הטווח הקודם
    if (prev && this.timeToMinutes(slot.start) < this.timeToMinutes(prev.end)) {
      slot.start = prev.end;
      this.showToast(
        '⛔ שעת התחלה של טווח חייבת להיות אחרי סיום הטווח הקודם באותו היום',
      );
    }

    // תיקוף מול הטווח הבא
    if (next && this.timeToMinutes(slot.end) > this.timeToMinutes(next.start)) {
      slot.end = next.start;
      this.showToast(
        '⛔ שעת סיום של טווח חייבת להיות לפני תחילת הטווח הבא באותו היום',
      );
    }
  }

  /* ============================ DAY TOGGLE ============================ */

  toggleDay(day: DayAvailability) {
    if (!this.allowEdit) {
      day.active = !day.active;
      this.showToast('כדי לערוך את הזמינות יש לבקש מהמזכירה שתפתח את האפשרות');
      return;
    }

    if (day.active && day.slots.length === 0) {
      day.slots.push({
        start: this.farmStart,
        end: this.farmEnd,
        lessonType: 'regular',
        isNew: true,
      });
    }

    if (!day.active) {
      day.slots = [];
      day.breaks = [];
    }

    this.markDirty();
  }

  /* ============================ SLOTS ============================ */

  addSlot(day: DayAvailability) {
    if (!this.allowEdit) {
      this.sendRequest('add', day);
      return;
    }

    // טווח חדש – תמיד אחרי הטווח האחרון
    const sorted = this.getSortedSlots(day);

    let start = this.farmStart;
    if (sorted.length > 0) {
      const last = sorted[sorted.length - 1];
      start = last.end;
    }

    const end = this.addMinutesToTime(start, this.lessonDuration);

    // אם הטווח החדש יוצא מחוץ לשעות פעילות החווה – לא מוסיפים
    if (this.timeToMinutes(end) > this.timeToMinutes(this.farmEnd)) {
      this.showToast('⛔ אין מקום להוסיף עוד טווח ביום זה בתוך שעות הפעילות');
      return;
    }

    day.slots.push({
      start,
      end,
      lessonType: 'regular',
      isNew: true,
    });

    this.markDirty();
  }

  removeSlot(day: DayAvailability, i: number) {
    const slot = day.slots[i];
    if (!slot) return;

    if (!this.allowEdit) {
      this.sendRequest('delete', day, slot);
      return;
    }

    if (slot.isNew) {
      day.slots.splice(i, 1);
      this.markDirty();
      return;
    }

    this.deletedSlots.push({
      dayKey: day.key,
      start: slot.originalStart ?? slot.start,
      end: slot.originalEnd ?? slot.end,
    });

    day.slots.splice(i, 1);
    this.markDirty();
  }

  async onSlotChange(day: DayAvailability, slot: TimeSlot) {
    if (!this.allowEdit) {
      await this.sendRequest('update', day, slot);
      return;
    }

    if (!slot.start || !slot.end) return;

    if (this.timeToMinutes(slot.end) <= this.timeToMinutes(slot.start)) {
      this.showToast('⛔ שעת סיום חייבת להיות אחרי שעת התחלה');
      return;
    }

    // מוודא שהטווח לא נכנס לתוך הטווח הקודם/הבא
    this.enforceSlotOrderConstraints(day, slot);

    if (slot.isNew) {
      this.markDirty();
      return;
    }

    slot.wasUpdated = true;
    this.markDirty();
  }

  /* ============================ BREAKS ============================ */

  addBreak(day: DayAvailability) {
    day.breaks.push({ start: this.farmStart, end: this.farmStart });
    this.markDirty();
  }

  removeBreak(day: DayAvailability, j: number) {
    day.breaks.splice(j, 1);
    this.markDirty();
  }

  onBreakChange(day: DayAvailability, br: BreakRange) {
    console.log('⏱ break changed:', { day: day.key, break: br });
    this.markDirty();
  }

  /* ============================ SECRETARY REQUESTS ============================ */

  private async sendRequest(
    action: 'add' | 'delete' | 'update',
    day: DayAvailability,
    slot?: TimeSlot,
  ) {
    if (!this.instructorIdNumber) return;

    try {
      await dbTenant()
        .from('instructor_availability_requests')
        .insert({
          instructor_id: this.instructorIdNumber,
          day_key: day.key,
          original_start: slot?.originalStart ?? slot?.start ?? null,
          original_end: slot?.originalEnd ?? slot?.end ?? null,
          new_start: slot?.start ?? null,
          new_end: slot?.end ?? null,
          action,
          status: 'pending',
        });

      this.showToast(
        action === 'add'
          ? 'בקשה להוספת טווח נשלחה למזכירה ✔'
          : action === 'delete'
          ? 'בקשה למחיקת טווח נשלחה למזכירה ✔'
          : 'בקשה לעדכון טווח נשלחה למזכירה ✔',
      );
    } catch (err) {
      console.error('sendRequest error:', err);
      this.showToast('❌ שגיאה בשליחת בקשה למזכירה');
    }
  }

  /* ============================ SAVE FLOW ============================ */

  async saveAvailability() {
    console.log('▶ saveAvailability() called');
    if (!this.allowEdit) {
      this.showToast('הזמינות נעולה לעריכה. כדי לערוך יש לפנות למזכירה.');
      return;
    }

    if (!this.isDirty) {
      this.showToast('אין שינויים לשמירה');
      return;
    }

    console.log('✔ Opening lockConfirm popup');
    this.lockConfirm = true;
  }

  cancelLockConfirm() {
    console.log('❌ cancelLockConfirm(): popup closed');
    this.lockConfirm = false;
  }

  async confirmLockAndSave() {
    console.log('▶ confirmLockAndSave(): popup confirmed');
    this.lockConfirm = false;

    await this.lockAvailabilityEdit();
    await this.applySave();
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
      console.error('lockAvailabilityEdit error:', err);
    }
  }

  /* ============================ APPLY SAVE ============================ */

  private async applySave() {
    console.log('🚀 applySave() STARTED');

    if (!this.userId || !this.instructorIdNumber) {
      console.warn('⛔ Missing userId or instructorIdNumber', {
        userId: this.userId,
        instructorIdNumber: this.instructorIdNumber,
      });
      return;
    }

    const dbc = dbTenant();

    try {
      /* 1) Save JSON to instructors */
      console.log('📦 Saving JSON availability → instructors');
      console.log('DATA:', JSON.stringify(this.days, null, 2));

      await dbc
        .from('instructors')
        .update({ availability: JSON.stringify(this.days) })
        .eq('uid', this.userId);

      /* 2) DELETE removed slots */
      console.log('🗑 Deleted slots list:', this.deletedSlots);

      for (const del of this.deletedSlots) {
        const dow = this.mapDayKeyToNumber(del.dayKey);

        console.log('📤 DELETE PAYLOAD:', {
          instructor_id_number: this.instructorIdNumber,
          day_of_week: dow,
          start_time: del.start,
        });

        const { error } = await dbc
          .from('instructor_weekly_availability')
          .delete()
          .eq('instructor_id_number', this.instructorIdNumber)
          .eq('day_of_week', dow)
          .eq('start_time', del.start);

        if (error) {
          console.error('❌ DELETE ERROR:', error);
        }
      }

      /* 3) INSERT / UPDATE slots */
      console.log('⏱ Processing slots for INSERT/UPDATE');

      for (const day of this.days || []) {
        const dow = this.mapDayKeyToNumber(day.key);
        if (!day.active || !Array.isArray(day.slots)) continue;

        for (const slot of day.slots) {
          if (!slot.start || !slot.end) continue;

          /* INSERT */
          if (slot.isNew) {
            const payload = {
              instructor_id_number: this.instructorIdNumber,
              day_of_week: dow,
              start_time: slot.start,
              end_time: slot.end,
              lesson_type_mode: slot.lessonType ?? null,
            };

            console.log('📤 INSERT PAYLOAD:', payload);

            const { error } = await dbc
              .from('instructor_weekly_availability')
              .insert(payload);

            if (error) {
              console.error('❌ INSERT ERROR:', error);
            } else {
              console.log('✔ INSERT OK');
            }

            slot.isNew = false;
            slot.originalStart = slot.start;
            slot.originalEnd = slot.end;
            slot.wasUpdated = false;

            continue;
          }

          /* UPDATE */
          if (slot.wasUpdated) {
            const originalStart = slot.originalStart ?? slot.start;

            const payload = {
              start_time: slot.start,
              end_time: slot.end,
              lesson_type_mode: slot.lessonType ?? null,
            };

            console.log('📤 UPDATE PAYLOAD:', {
              instructor_id_number: this.instructorIdNumber,
              day_of_week: dow,
              original_start: originalStart,
              new_values: payload,
            });

            const { error } = await dbc
              .from('instructor_weekly_availability')
              .update(payload)
              .eq('instructor_id_number', this.instructorIdNumber)
              .eq('day_of_week', dow)
              .eq('start_time', originalStart);

            if (error) {
              console.error('❌ UPDATE ERROR:', error);
            } else {
              console.log('✔ UPDATE OK');
            }

            slot.originalStart = slot.start;
            slot.originalEnd = slot.end;
            slot.wasUpdated = false;
          }
        }
      }

      this.deletedSlots = [];
      this.isDirty = false;

      console.log('🎉 applySave() COMPLETED SUCCESSFULLY');
      this.showToast('✔ הזמינות נשמרה וננעלה לעריכה');
    } catch (err) {
      console.error('🔥 GLOBAL applySave EXCEPTION:', err);
      this.showToast('❌ שגיאה בשמירת הזמינות');
    }
  }

  /* ============================ PARENTS IMPACT POPUP ============================ */

  cancelUpdate() {
    console.log('❌ cancelUpdate(): close parents popup');
    this.confirmData = null;
    this.pendingPayload = null;
  }

  async approveUpdate() {
    console.log('✔ approveUpdate(): save after parents popup');
    this.confirmData = null;
    await this.applySave();
  }

  /* ============================ NOTIFICATIONS ============================ */

  public async saveNotifications() {
    console.log('🔔 saveNotifications() called');

    if (!this.userId) return;

    const dbc = dbTenant();

    try {
      await dbc
        .from('instructors')
        .update({ notify: JSON.stringify(this.notif) })
        .eq('uid', this.userId);

      console.log('✔ Notifications saved:', this.notif);
      this.showToast('✔ העדפות ההתראה נשמרו');
    } catch (err) {
      console.error('❌ saveNotifications error:', err);
      this.showToast('❌ שגיאה בשמירת העדפות ההתראה');
    }
  }
}

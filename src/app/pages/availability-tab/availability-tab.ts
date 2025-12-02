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
  public instructorIdNumber: string | null = null;   // ⭐ נוספו
  public isDirty = false;

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
    { value: 'regular', label: 'רגיל' },
    { value: 'double', label: 'כפול' },
    { value: 'single', label: 'יחידני' },
    { value: 'group', label: 'קבוצתי' },
    { value: 'both', label: 'גם וגם' }
  ];

  public toastMessage = '';
  private toastTimeout: any;

  public confirmData: {
    parents: { name: string; child: string }[];
  } | null = null;

  private pendingPayload: DayAvailability[] | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private farmSettings: FarmSettingsService
  ) {}

  async ngOnInit() {
    await this.loadUserId();
    await this.loadFarmSettings();
    this.loadDefaults();
    await this.loadFromSupabase();
  }

  private async loadUserId() {
    const auth = getAuth();
    this.userId = auth.currentUser?.uid || null;
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

    } catch (e) {
      console.error(e);
    }
  }

  private defaultDay(key: string, label: string): DayAvailability {
    return { key, label, active: false, slots: [], breaks: [] };
  }

  private loadDefaults() {
    this.days = [
      this.defaultDay('sun', 'ראשון'),
      this.defaultDay('mon', 'שני'),
      this.defaultDay('tue', 'שלישי'),
      this.defaultDay('wed', 'רביעי'),
      this.defaultDay('thu', 'חמישי')
    ];
  }

  private async loadFromSupabase() {
    if (!this.userId) return;

    const dbc = dbTenant();

    const { data } = await dbc
      .from('instructors')
      .select('availability, notify, id_number')  // ⭐ נוספה שליפה של id_number
      .eq('uid', this.userId)
      .maybeSingle();

    // ⭐ שומר את מספר המדריך האמיתי (המתאים לטבלת השיעורים)
    if (data?.id_number) {
      this.instructorIdNumber = data.id_number;
    }

    if (data?.availability) {
      try {
        const raw = JSON.parse(data.availability);
        this.days = raw;
      } catch {}
    }

    if (data?.notify) {
      try {
        this.notif = typeof data.notify === 'string'
          ? JSON.parse(data.notify)
          : data.notify;
      } catch {}
    }

    this.cdr.detectChanges();
  }

  markDirty() {
    this.isDirty = true;
  }

  toggleDay(day: DayAvailability) {
    if (day.active && day.slots.length === 0) {
      day.slots.push({
        start: this.farmStart,
        end: this.farmEnd,
        lessonType: 'regular',
      });
    }

    if (!day.active) {
      day.slots = [];
      day.breaks = [];
    }

    this.markDirty();
  }

  addSlot(day: DayAvailability) {
    day.slots.push({
      start: this.farmStart,
      end: this.farmEnd,
      lessonType: 'regular',
    });
    this.mergeSlots(day);
    this.markDirty();
  }

  removeSlot(day: DayAvailability, i: number) {
    day.slots.splice(i, 1);
    this.markDirty();
  }

  addBreak(day: DayAvailability) {
    day.breaks.push({ start: this.farmStart, end: this.farmStart });
    this.markDirty();
  }

  removeBreak(day: DayAvailability, i: number) {
    day.breaks.splice(i, 1);
    this.markDirty();
  }

  private timeToMinutes(time: string): number {
    if (!time) return 0;
    const [h, m] = time.split(':').map((x) => Number(x) || 0);
    return h * 60 + m;
  }

  private minutesToTime(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private validateInsideFarmHours(start: string, end: string) {
    const s = this.timeToMinutes(start);
    const e = this.timeToMinutes(end);
    const fs = this.timeToMinutes(this.farmStart);
    const fe = this.timeToMinutes(this.farmEnd);
    return s >= fs && e <= fe && e > s;
  }

  private validateLessonDuration(slot: TimeSlot) {
    const start = this.timeToMinutes(slot.start);
    const end = this.timeToMinutes(slot.end);
    const dur = end - start;

    if (dur <= 0) return false;
    if (slot.lessonType === 'double')
      return dur === this.lessonDuration * 2;

    return dur >= this.lessonDuration;
  }

  private validateNoSlotOverlap(day: DayAvailability) {
    const sorted = [...day.slots].sort(
      (a, b) => this.timeToMinutes(a.start) - this.timeToMinutes(b.start)
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      if (this.timeToMinutes(sorted[i + 1].start) <
          this.timeToMinutes(sorted[i].end)) {
        return false;
      }
    }
    return true;
  }

  private mergeSlots(day: DayAvailability) {
    if (day.slots.length <= 1) return;

    const sorted = [...day.slots].sort(
      (a, b) => this.timeToMinutes(a.start) - this.timeToMinutes(b.start)
    );

    const merged: TimeSlot[] = [];
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (
        current.lessonType === next.lessonType &&
        this.timeToMinutes(next.start) <= this.timeToMinutes(current.end)
      ) {
        if (this.timeToMinutes(next.end) > this.timeToMinutes(current.end))
          current.end = next.end;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    day.slots = merged;
  }

  private validateBreakRange(day: DayAvailability, br: BreakRange): boolean {
    if (!this.validateInsideFarmHours(br.start, br.end)) {
      this.showToast(
        `⛔ הפסקה חייבת להיות בין ${this.farmStart} ל־${this.farmEnd}`,
      );
      return false;
    }

    const bStart = this.timeToMinutes(br.start);
    const bEnd = this.timeToMinutes(br.end);
    const dur = bEnd - bStart;

    if (dur <= 0) {
      this.showToast('⛔ שעת התחלה חייבת להיות לפני שעת סיום בהפסקה');
      return false;
    }

    // לא יותר מ־2 שיעורים
    if (dur > this.lessonDuration * 2) {
      this.showToast('⛔ הפסקה לא יכולה להיות ארוכה ממשך 2 שיעורים');
      return false;
    }

    // לא חופף לשיעור
    for (const s of day.slots) {
      const sStart = this.timeToMinutes(s.start);
      const sEnd = this.timeToMinutes(s.end);
      if (bStart < sEnd && sStart < bEnd) {
        this.showToast('⛔ אי אפשר לשים הפסקה על גבי שיעור קיים');
        return false;
      }
    }

    return true;
  }

  private validateDaySlots(day: DayAvailability): boolean {
    for (const slot of day.slots) {
      if (!this.validateInsideFarmHours(slot.start, slot.end)) {
        this.showToast(
          `⛔ השיעורים ביום ${day.label} חייבים להיות בין ${this.farmStart} ל־${this.farmEnd}`,
        );
        return false;
      }

      if (!this.validateLessonDuration(slot)) {
        this.showToast(
          `⛔ משך השיעור ביום ${day.label} לא תואם את סוג השיעור / אורך השיעור`,
        );
        return false;
      }
    }

    if (!this.validateNoSlotOverlap(day)) {
      this.showToast(
        `⛔ אי אפשר לקבוע שני שיעורים חופפים באותו יום (${day.label})`,
      );
      return false;
    }

    return true;
  }

  private validateDayBreaks(day: DayAvailability): boolean {
    for (const br of day.breaks) {
      if (!this.validateBreakRange(day, br)) {
        return false;
      }
    }
    return true;
  }

  private validateAllDays(): boolean {
    for (const day of this.days) {
      if (!day.active) continue;
      if (!this.validateDaySlots(day)) return false;
      if (!this.validateDayBreaks(day)) return false;
    }
    return true;
  }

  /* =============== EVENTS =============== */

public onSlotChange(day: DayAvailability, slot: TimeSlot): void {
  let s = this.timeToMinutes(slot.start);
  let e = this.timeToMinutes(slot.end);
  const fs = this.timeToMinutes(this.farmStart);
  const fe = this.timeToMinutes(this.farmEnd);

  // קלמפ לגבולות החווה – לא מאפס ליום שלם
  if (s < fs) {
    s = fs;
    slot.start = this.farmStart;
  }
  if (e > fe) {
    e = fe;
    slot.end = this.farmEnd;
  }

  // אם יצא שהתחלה >= סוף – מזיזים סוף לפי משך שיעור
  if (s >= e) {
    e = s + this.lessonDuration;
    if (e > fe) e = fe;
    slot.end = this.minutesToTime(e);
  }

  // עדיין בודקים חפיפות ומשך שיעור
  if (!this.validateLessonDuration(slot)) {
    this.showToast('⛔ משך השיעור לא תואם את סוג השיעור / אורך השיעור');
  }

  this.mergeSlots(day);
  this.markDirty();
}


  
  public onBreakChange(day: DayAvailability, br: BreakRange): void {
    this.validateBreakRange(day, br);
    this.markDirty();
  }

  /* ================= SAVE ================= */

  public async saveAvailability() {
    if (!this.userId || !this.instructorIdNumber) return;   // ⭐ חייב id_number

    this.pendingPayload = this.days;

    const dbc = dbTenant();
    // בדיקת התנגשויות
    const { data, error } = await dbc.rpc('get_conflicting_parents', {
      p_instructor_id: this.instructorIdNumber   // ⭐ השימוש הנכון
    });
    
console.log("📌 DATA FROM RPC:", data);
console.log("📌 ERROR:", error);
    if (error) {
      console.error(error);
      this.showToast('❌ שגיאה בבדיקת שינויים');
      return;
    }

   if (data?.length > 0) {
  this.confirmData = {
    parents: data.map((row: any) => ({
      name: row.parent_name ?? '—',
      child: row.child_name ?? '—',
    })),
  };
  return;
}


    await this.applyUpdate();
  }

  public cancelUpdate() {
    this.confirmData = null;
    this.pendingPayload = null;
  }

  public async approveUpdate() {
    this.confirmData = null;
    await this.applyUpdate();
  }

  private async applyUpdate() {
    if (!this.userId || !this.pendingPayload) return;

    const dbc = dbTenant();

    const { error } = await dbc
      .from('instructors')
      .update({
        availability: JSON.stringify(this.pendingPayload),
      })
      .eq('uid', this.userId);

    if (error) {
      console.error(error);
      this.showToast('❌ שגיאה בשמירה');
      return;
    }

    this.pendingPayload = null;
    this.isDirty = false;
    this.showToast('✔ נשמר בהצלחה');
  }

  public async saveNotifications() {
    if (!this.userId) return;

    const dbc = dbTenant();

    const { error } = await dbc
      .from('instructors')
      .update({
        notify: JSON.stringify(this.notif),
      })
      .eq('uid', this.userId);

    if (error) {
      console.error(error);
      this.showToast('❌ שגיאה בשמירת ההתראות');
      return;
    }

    this.showToast('✔ ההתראות נשמרו');
  }

  showToast(msg: string) {
    this.toastMessage = msg;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 2500);
  }
}

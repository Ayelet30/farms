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
  ridingTypeId: string | null;

  isNew?: boolean;
  wasUpdated?: boolean;

  originalStart?: string;
  originalEnd?: string;

  prevStart?: string;
  prevEnd?: string;
  prevRidingTypeId?: UUID | null;

  /** 👇 חדש */
  flashError?: boolean;
}

interface TimeSlot {
  start: string;
  end: string;

  /** ✅ DB reference */
   ridingTypeId: string | null; 

  isNew?: boolean;
  wasUpdated?: boolean;
  originalStart?: string;
  originalEnd?: string;

  /** UX – לשמור ערכים לפני עריכה */
  prevStart?: string;
  prevEnd?: string;
  prevRidingTypeId?: UUID | null;
}

interface DayAvailability {
  key: string;
  label: string;
  active: boolean;
  slots: TimeSlot[];
}
interface RidingType {
  id: string;
  code: string;
  name: string;
  default_duration_min: number | null;
  max_participants: number | null;
  description: string | null;
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

interface RidingTypeOption {
  id: UUID;
  label: string;
  min_participants: number;
  max_participants: number;
  is_active: boolean;
  sort_order: number;
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
public ridingTypes: RidingType[] = [];

  public allowEdit = true;
  public isDirty = false;
  public lockConfirm = false;

  /** אם יש לך farm_id במערכת – נטען מה farm settings */
  public farmId: UUID | null = null;

  public days: DayAvailability[] = [];

  public notif: NotificationPrefs = {
    cancelLesson: true,
    reminder: true,
    monthlyReport: false,
  };

  public farmStart = '08:00';
  public farmEnd = '17:00';
  public lessonDuration = 60;

  /** ✅ נטען מהטבלה */
  public ridingTypeOptions: RidingTypeOption[] = [];

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
    await this.loadFarmSettings();       // כולל farmId + שעות פעילות
    await this.loadRidingTypes();    
        // נטען מה DB
    this.loadDefaultsIfEmpty();
    this.ensureSlotsHaveDefaults();   
    console.log('RIDING TYPES COUNT:', this.ridingTypes.length);
console.log('RIDING TYPES:', this.ridingTypes);
   // default riding type אם חסר
  }

  private async loadUserId() {
    const auth = getAuth();
    this.userId = auth.currentUser?.uid ?? null;
  }

private async loadRidingTypes() {
  const { data, error } = await dbTenant()
    .schema('bereshit_farm')
    .from('riding_types')
    .select(`
      id,
      code,
      name,
      default_duration_min,
      max_participants,
      description,
      active
    `)
    .eq('active', true)
    .order('name');

  if (error) {
    console.error('❌ loadRidingTypes error:', error);
    this.showToast('שגיאה בטעינת סוגי רכיבה');
    return;
  }

  this.ridingTypes = data || [];

  // ⬅️ זה החלק החשוב ל־HTML
  this.ridingTypeOptions = this.ridingTypes.map(rt => ({
    id: rt.id,
    label: rt.name,
    min_participants: 1,
    max_participants: rt.max_participants ?? 1,
    is_active: rt.active,
    sort_order: 0,
  }));
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

        if (Array.isArray(raw)) {
          // התאמה אחורה: אם היה lessonType בעבר – לא נשתמש בזה
          this.days = raw.map((d: any) => ({
            key: d.key,
            label: d.label,
            active: !!d.active,
            slots: (d.slots || []).map((s: any) => ({
              start: s.start,
              end: s.end,
              ridingTypeId: s.ridingTypeId ?? s.riding_type_id ?? null,
              isNew: !!s.isNew,
              wasUpdated: !!s.wasUpdated,
              originalStart: s.originalStart ?? s.start,
              originalEnd: s.originalEnd ?? s.end,
              prevStart: s.start,
              prevEnd: s.end,
              prevRidingTypeId: s.ridingTypeId ?? s.riding_type_id ?? null,
            })),
          }));
        }
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

      // אם אצלך settings כולל farm_id
      if ((settings as any).farm_id) this.farmId = (settings as any).farm_id;

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
    });

    this.days = [
      mk('sun', 'ראשון'),
      mk('mon', 'שני'),
      mk('tue', 'שלישי'),
      mk('wed', 'רביעי'),
      mk('thu', 'חמישי'),
    ];
  }

  /** אם אין ridingTypeId בטווחים קיימים – ננסה לשים default ראשון */
  private ensureSlotsHaveDefaults() {
    const defaultTypeId = this.ridingTypeOptions?.[0]?.id ?? null;
    for (const day of this.days || []) {
      for (const s of day.slots || []) {
        if (!s.ridingTypeId) s.ridingTypeId = defaultTypeId;
        s.prevStart = s.start;
        s.prevEnd = s.end;
        s.prevRidingTypeId = s.ridingTypeId;
        s.originalStart ??= s.start;
        s.originalEnd ??= s.end;
      }
    }
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
    return [...(day.slots || [])].sort(
      (a, b) => this.timeToMinutes(a.start) - this.timeToMinutes(b.start),
    );
  }

  private mapDayKeyToNumber(key: string): number {
    const map: any = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    return map[key] ?? 0;
  }

  private hasOverlap(day: DayAvailability, slot: TimeSlot): boolean {
    const start = this.timeToMinutes(slot.start);
    const end = this.timeToMinutes(slot.end);
    if (!start || !end) return false;

    for (const other of day.slots || []) {
      if (other === slot) continue;
      const os = this.timeToMinutes(other.start);
      const oe = this.timeToMinutes(other.end);
      if (start < oe && end > os) return true;
    }
    return false;
  }

  /** ✅ חובה לקיים בגלל ה-HTML */
  onSlotFocus(slot: TimeSlot) {
    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId ?? null;
     this.cdr.detectChanges(); 
  }

  private revertSlot(slot: TimeSlot) {
    if (slot.prevStart != null) slot.start = slot.prevStart;
    if (slot.prevEnd != null) slot.end = slot.prevEnd;
    slot.ridingTypeId = slot.prevRidingTypeId ?? slot.ridingTypeId ?? null;
  }
private flashSlotError(slot: TimeSlot) {
  slot.flashError = true;
  this.cdr.detectChanges();

  setTimeout(() => {
    slot.flashError = false;
    this.cdr.detectChanges();
  }, 700);
}

  /* ============================ DAY TOGGLE ============================ */

  toggleDay(day: DayAvailability) {
    if (!this.allowEdit) {
      day.active = !day.active;
      this.showToast('כדי לערוך את הזמינות יש לבקש מהמזכירה שתפתח את האפשרות');
      return;
    }

    if (day.active && day.slots.length === 0) {
      const defaultTypeId = this.ridingTypeOptions?.[0]?.id ?? null;
      const s: TimeSlot = {
        start: this.farmStart,
        end: this.addMinutesToTime(this.farmStart, this.lessonDuration),
        ridingTypeId: defaultTypeId,
        isNew: true,
      };
      this.onSlotFocus(s);
      day.slots.push(s);
    }

    if (!day.active) {
      day.slots = [];
    }

    this.markDirty();
  }

  /* ============================ SLOTS ============================ */

  addSlot(day: DayAvailability) {
    if (!this.allowEdit) {
      this.sendRequest('add', day);
      return;
    }

    const sorted = this.getSortedSlots(day);
    let start = this.farmStart;

    if (sorted.length > 0) start = sorted[sorted.length - 1].end;

    const end = this.addMinutesToTime(start, this.lessonDuration);

    if (this.timeToMinutes(end) > this.timeToMinutes(this.farmEnd)) {
      this.showToast('⛔ אין מקום להוסיף עוד טווח ביום זה בתוך שעות הפעילות');
      return;
    }

    const defaultTypeId = this.ridingTypeOptions?.[0]?.id ?? null;

    const s: TimeSlot = {
      start,
      end,
      ridingTypeId: defaultTypeId,
      isNew: true,
    };
    this.onSlotFocus(s);

    day.slots.push(s);
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

    // 1) סיום אחרי התחלה
    if (this.timeToMinutes(slot.end) <= this.timeToMinutes(slot.start)) {
      this.showToast('⛔ שעת סיום חייבת להיות אחרי שעת התחלה');
        this.flashSlotError(slot); 
      this.revertSlot(slot);
      return;
    }

    // 2) בתוך שעות פעילות
    if (this.timeToMinutes(slot.start) < this.timeToMinutes(this.farmStart)) {
      this.showToast('⛔ שעת התחלה לא יכולה להיות לפני תחילת יום בחווה');
      this.revertSlot(slot);
        this.flashSlotError(slot); 
      return;
    }
    if (this.timeToMinutes(slot.end) > this.timeToMinutes(this.farmEnd)) {
      this.showToast('⛔ שעת סיום לא יכולה להיות אחרי סיום יום בחווה');
        this.flashSlotError(slot); 
      this.revertSlot(slot);
      return;
    }

    // 3) חפיפות (בלי תיקון אוטומטי!)
    if (this.hasOverlap(day, slot)) {
      this.showToast('⛔ יש חפיפה בין הטווח הזה לטווח אחר באותו היום');
      this.revertSlot(slot);
      return;
    }

    // 4) חייב לבחור סוג רכיבה
    if (!slot.ridingTypeId) {
      this.showToast('⛔ חובה לבחור סוג רכיבה');
      this.revertSlot(slot);
      return;
    }

    // תקין → מעדכנים prev
    slot.prevStart = slot.start;
    slot.prevEnd = slot.end;
    slot.prevRidingTypeId = slot.ridingTypeId;

    if (slot.isNew) {
      this.markDirty();
      return;
    }

    slot.wasUpdated = true;
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
    if (!this.allowEdit) {
      this.showToast('הזמינות נעולה לעריכה. כדי לערוך יש לפנות למזכירה.');
      return;
    }

    if (!this.isDirty) {
      this.showToast('אין שינויים לשמירה');
      return;
    }

    this.lockConfirm = true;
  }

  cancelLockConfirm() {
    this.lockConfirm = false;
  }

  async confirmLockAndSave() {
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
    if (!this.userId || !this.instructorIdNumber) return;

    const dbc = dbTenant();

    try {
      // 1) Save JSON to instructors (לגיבוי UI)
      await dbc
        .from('instructors')
        .update({ availability: JSON.stringify(this.days) })
        .eq('uid', this.userId);

      // 2) DELETE removed slots
      for (const del of this.deletedSlots) {
        const dow = this.mapDayKeyToNumber(del.dayKey);

        const { error } = await dbc
          .from('instructor_weekly_availability')
          .delete()
          .eq('instructor_id_number', this.instructorIdNumber)
          .eq('day_of_week', dow)
          .eq('start_time', del.start);

        if (error) console.error('❌ DELETE ERROR:', error);
      }

      // 3) INSERT / UPDATE slots
      for (const day of this.days || []) {
        const dow = this.mapDayKeyToNumber(day.key);
        if (!day.active || !Array.isArray(day.slots)) continue;

        for (const slot of day.slots) {
          if (!slot.start || !slot.end || !slot.ridingTypeId) continue;

          // INSERT
          if (slot.isNew) {
            const payload = {
              instructor_id_number: this.instructorIdNumber,
              day_of_week: dow,
              start_time: slot.start,
              end_time: slot.end,
              riding_type_id: slot.ridingTypeId,
            };

            const { error } = await dbc
              .from('instructor_weekly_availability')
              .insert(payload);

            if (error) console.error('❌ INSERT ERROR:', error);

            slot.isNew = false;
            slot.originalStart = slot.start;
            slot.originalEnd = slot.end;
            slot.wasUpdated = false;

            slot.prevStart = slot.start;
            slot.prevEnd = slot.end;
            slot.prevRidingTypeId = slot.ridingTypeId;

            continue;
          }

          // UPDATE
          if (slot.wasUpdated) {
            const originalStart = slot.originalStart ?? slot.start;

            const payload = {
              start_time: slot.start,
              end_time: slot.end,
              riding_type_id: slot.ridingTypeId,
            };

            const { error } = await dbc
              .from('instructor_weekly_availability')
              .update(payload)
              .eq('instructor_id_number', this.instructorIdNumber)
              .eq('day_of_week', dow)
              .eq('start_time', originalStart);

            if (error) console.error('❌ UPDATE ERROR:', error);

            slot.originalStart = slot.start;
            slot.originalEnd = slot.end;
            slot.wasUpdated = false;

            slot.prevStart = slot.start;
            slot.prevEnd = slot.end;
            slot.prevRidingTypeId = slot.ridingTypeId;
          }
        }
      }

      this.deletedSlots = [];
      this.isDirty = false;

      this.showToast('✔ הזמינות נשמרה וננעלה לעריכה');
    } catch (err) {
      console.error('🔥 applySave EXCEPTION:', err);
      this.showToast('❌ שגיאה בשמירת הזמינות');
    }
  }

  /* ============================ PARENTS IMPACT POPUP ============================ */

  cancelUpdate() {
    this.confirmData = null;
    this.pendingPayload = null;
  }

  async approveUpdate() {
    this.confirmData = null;
    await this.applySave();
  }

  /* ============================ NOTIFICATIONS ============================ */

  public async saveNotifications() {
    if (!this.userId) return;

    try {
      await dbTenant()
        .from('instructors')
        .update({ notify: JSON.stringify(this.notif) })
        .eq('uid', this.userId);

      this.showToast('✔ העדפות ההתראה נשמרו');
    } catch (err) {
      console.error('❌ saveNotifications error:', err);
      this.showToast('❌ שגיאה בשמירת העדפות ההתראה');
    }
  }
}

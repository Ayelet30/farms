import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';

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

  constructor(private cdr: ChangeDetectorRef) {}

  userId: string | null = null;
  isDirty = false;

  days: DayAvailability[] = [];
  notif: NotificationPrefs = {
    cancelLesson: true,
    reminder: true,
    monthlyReport: false,
  };

  // ⭐ סוגי שיעור
  lessonTypeOptions: { value: LessonType; label: string }[] = [
    { value: 'regular',  label: 'רגיל' },
    { value: 'double',   label: 'כפול' },
    { value: 'single',   label: 'יחידני' },
    { value: 'group',    label: 'קבוצתי' },
    { value: 'both',     label: 'גם וגם' },
  ];

  toastMessage = '';
  private toastTimeout: any;

  confirmData: {
    parents: { name: string; child: string }[];
  } | null = null;

  pendingPayload: DayAvailability[] | null = null;

  /* ================= lifecycle ================= */

  async ngOnInit() {
    await this.loadUserId();
    this.loadDefaults();
    await this.loadFromSupabase();
  }

  async loadUserId() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;
    this.userId = user.uid;
  }

  private defaultDay(key: string, label: string): DayAvailability {
    return {
      key,
      label,
      active: false,
      slots: [],
      breaks: [],
    };
  }

  loadDefaults() {
    this.days = [
      this.defaultDay('sun', 'ראשון'),
      this.defaultDay('mon', 'שני'),
      this.defaultDay('tue', 'שלישי'),
      this.defaultDay('wed', 'רביעי'),
      this.defaultDay('thu', 'חמישי'),
    ];
  }

  async loadFromSupabase() {
    if (!this.userId) return;

    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('instructors')
      .select('availability, notify')
      .eq('uid', this.userId)
      .maybeSingle();

    if (error) {
      console.warn('LOAD ERROR:', error);
      return;
    }

    // זמינות קיימת
    if (data?.availability) {
      try {
        const raw = JSON.parse(data.availability) as any[];

        this.days = raw.map((d: any) => {
          const slots: TimeSlot[] = (d.slots || []).map((s: any) => ({
            start: s.start || '08:00',
            end: s.end || '17:00',
            lessonType: (s.lessonType as LessonType) || 'regular',
          }));

          const breaks: BreakRange[] = (d.breaks || []).map((b: any) => ({
            start: b.start || '',
            end: b.end || '',
          }));

          return {
            key: d.key,
            label: d.label,
            active: !!d.active,
            slots,
            breaks,
          } as DayAvailability;
        });
      } catch (e) {
        console.error('parse availability error', e);
      }
    }

    if (data?.notify) {
      try {
        this.notif = JSON.parse(data.notify);
      } catch {}
    }

    this.cdr.detectChanges();
  }

  /* ================= UI helpers ================= */

  markDirty() {
    this.isDirty = true;
  }

  toggleDay(day: DayAvailability) {
    if (day.active && day.slots.length === 0) {
      day.slots.push({
        start: '08:00',
        end: '17:00',
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
      start: '08:00',
      end: '17:00',
      lessonType: 'regular',
    });
    this.markDirty();
  }

  removeSlot(day: DayAvailability, index: number) {
    day.slots.splice(index, 1);
    this.markDirty();
  }

  addBreak(day: DayAvailability) {
    if (!day.breaks) day.breaks = [];
    day.breaks.push({ start: '', end: '' });
    this.markDirty();
  }

  removeBreak(day: DayAvailability, index: number) {
    day.breaks.splice(index, 1);
    this.markDirty();
  }

  /* =============== SAVE (RPC + UPDATE) =============== */

  async saveAvailability() {
    if (!this.userId) return;

    const payload: DayAvailability[] = this.days;
    this.pendingPayload = payload;

    const dbc = dbTenant();

    console.log('📌 PAYLOAD:', payload);

    const { data, error } = await dbc.rpc(
      'public.get_conflicting_parents',
      {
        p_instructor_uid: this.userId,
        new_availability: payload,
      }
    );

    if (error) {
      console.error('❌ RPC ERROR', error);
      this.showToast('❌ שגיאה בבדיקת השינויים');
      return;
    }

    if (data && data.length > 0) {
      this.confirmData = {
        parents: data.map((p: any) => ({
          name: p.parent_name,
          child: p.child_name,
        })),
      };
      this.cdr.detectChanges();
      return;
    }

    await this.applyUpdate();
  }

  cancelUpdate() {
    this.confirmData = null;
    this.pendingPayload = null;
  }

  async approveUpdate() {
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
    this.showToast('✔ הזמינות נשמרה בהצלחה');
  }

  /* =============== notifications =============== */

  async saveNotifications() {
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

    this.showToast('✔ העדפות ההתראות נשמרו');
  }

  /* =============== toast =============== */

  showToast(message: string) {
    this.toastMessage = message;

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 2500);
  }
}

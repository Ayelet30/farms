import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';

interface TimeSlot {
  start: string;
  end: string;
}

interface DayAvailability {
  key: string;
  label: string;
  active: boolean;
  slots: TimeSlot[];
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
  ]
})
export class AvailabilityTabComponent implements OnInit {

  userId: string | null = null;
  isDirty = false;

  days: DayAvailability[] = [];
  notif: NotificationPrefs = {
    cancelLesson: true,
    reminder: true,
    monthlyReport: false,
  };

  toastMessage = '';
  private toastTimeout: any;

  async ngOnInit() {
    await this.loadUserId();
    this.loadDefaults();
    await this.loadFromSupabase();
  }

  /** מזהה משתמש מה־Firebase */
  async loadUserId() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;
    this.userId = user.uid;
  }

  /** מצב פתיחה */
  loadDefaults() {
    this.days = [
      { key: 'sun', label: 'ראשון', active: false, slots: [] },
      { key: 'mon', label: 'שני', active: false, slots: [] },
      { key: 'tue', label: 'שלישי', active: false, slots: [] },
      { key: 'wed', label: 'רביעי', active: false, slots: [] },
      { key: 'thu', label: 'חמישי', active: false, slots: [] },
    ];
  }

  /** טעינה מה־Supabase */
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

    if (data?.availability) {
      try {
        this.days = JSON.parse(data.availability);
      } catch {}
    }

    if (data?.notify) {
      try {
        this.notif = JSON.parse(data.notify);
      } catch {}
    }
  }

  markDirty() {
    this.isDirty = true;
  }

  toggleDay(day: DayAvailability) {
    if (day.active && day.slots.length === 0) {
      day.slots.push({ start: '08:00', end: '17:00' });
    }
    if (!day.active) {
      day.slots = [];
    }
    this.markDirty();
  }

  addSlot(day: DayAvailability) {
    day.slots.push({ start: '08:00', end: '17:00' });
    this.markDirty();
  }

  removeSlot(day: DayAvailability, index: number) {
    day.slots.splice(index, 1);
    this.markDirty();
  }

  /** שמירת זמינות */
  async saveAvailability() {
    if (!this.userId) return;
    const dbc = dbTenant();

    const { error } = await dbc
      .from('instructors')
      .update({
        availability: JSON.stringify(this.days)
      })
      .eq('uid', this.userId);

    if (error) {
      console.error(error);
      this.showToast('❌ שגיאה בשמירת הזמינות');
      return;
    }

    this.isDirty = false;
    this.showToast('✔ הזמינות נשמרה בהצלחה');
  }

  /** שמירת התראות */
  async saveNotifications() {
    if (!this.userId) return;
    const dbc = dbTenant();

    const { error } = await dbc
      .from('instructors')
      .update({
        notify: JSON.stringify(this.notif)
      })
      .eq('uid', this.userId);

    if (error) {
      console.error(error);
      this.showToast('❌ שגיאה בשמירת ההתראות');
      return;
    }

    this.showToast('✔ העדפות ההתראות נשמרו');
  }

  /** טוסט */
  showToast(message: string) {
    this.toastMessage = message;

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
    }, 2500);
  }
}

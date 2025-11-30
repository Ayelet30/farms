import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';

type UUID = string;

interface FarmSettings {
  id?: UUID;

  // שעות פעילות
  operating_hours_start: string | null; // time (HH:MM)
  operating_hours_end: string | null;   // time (HH:MM)

  // שיעורים
  lessons_count: number | null;             // כמות שיעורים בסדרה
  lesson_duration_minutes: number | null;   // אורך שיעור בדקות
  default_lesson_price: number | null;      // מחיר שיעור רגיל

  // השלמות וביטולים
  makeup_allowed_days_back: number | null;      // כמה ימים אחורה אפשר להירשם להשלמה
  max_makeups_in_period: number | null;         // מקס' השלמות בתקופה
  makeups_period_days: number | null;           // גודל תקופה (ימים)
  displayed_makeup_lessons_count: number | null;// כמות שיעורי השלמה להצגה
  min_time_between_cancellations: string | null;// interval – נשמור כ-HH:MM:SS

  // תשלומים
  registration_fee: number | null;             // דמי רישום
  student_insurance_premiums: number | null;   // ביטוח תלמידים

  // *** הגדרות נוספות מוצעות – צריך עמודות מתאימות בטבלה ***
  max_group_size?: number | null;               // מקס' רוכבים בקבוצה
  max_lessons_per_week_per_child?: number | null;
  allow_online_booking?: boolean | null;        // האם לאפשר זימון עצמי להורים

  updated_at?: string | null;
}

@Component({
  selector: 'app-farm-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './farm-settings.component.html',
  styleUrls: ['./farm-settings.component.scss'],
})
export class FarmSettingsComponent implements OnInit {
  private supabase = dbTenant();

  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  settings = signal<FarmSettings | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    const { data, error } = await this.supabase
      .from('farm_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('load farm_settings error', error);
      this.error.set('לא ניתן לטעון את הגדרות החווה.');
      this.loading.set(false);
      return;
    }

    if (data) {
      // התאמה לשדות ה־time/interval – להציג רק HH:MM
      const s: FarmSettings = {
        ...data,
        operating_hours_start: data.operating_hours_start?.slice(0, 5) ?? '08:00',
        operating_hours_end: data.operating_hours_end?.slice(0, 5) ?? '20:00',
        min_time_between_cancellations: data.min_time_between_cancellations
          ? data.min_time_between_cancellations.slice(0, 5)
          : '00:00',
      };
      this.settings.set(s);
    } else {
      // ברירת מחדל כשאין רשומה
      this.settings.set({
        operating_hours_start: '08:00',
        operating_hours_end: '20:00',
        lessons_count: 12,
        lesson_duration_minutes: 60,
        default_lesson_price: 150,
        makeup_allowed_days_back: 30,
        max_makeups_in_period: 8,
        makeups_period_days: 30,
        displayed_makeup_lessons_count: 3,
        min_time_between_cancellations: '12:00',
        registration_fee: null,
        student_insurance_premiums: null,
        max_group_size: 6,
        max_lessons_per_week_per_child: 2,
        allow_online_booking: true,
      });
    }

    this.loading.set(false);
  }

  async save(): Promise<void> {
    const current = this.settings();
    if (!current) return;

    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);

    // המרה לפורמט שמתאים ל־DB
    const payload: any = {
      ...current,
      updated_at: new Date().toISOString(),
    };

    // time + interval כ-HH:MM:SS
    if (payload.operating_hours_start?.length === 5) {
      payload.operating_hours_start = payload.operating_hours_start + ':00';
    }
    if (payload.operating_hours_end?.length === 5) {
      payload.operating_hours_end = payload.operating_hours_end + ':00';
    }
    if (payload.min_time_between_cancellations?.length === 5) {
      payload.min_time_between_cancellations =
        payload.min_time_between_cancellations + ':00';
    }

    // אם id לא קיים – לא נשלח אותו, שה־DB ייצור
    if (!payload.id) {
      delete payload.id;
    }

    const { data, error } = await this.supabase
      .from('farm_settings')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('save farm_settings error', error);
      this.error.set('שמירת ההגדרות נכשלה. נסי שוב.');
      this.saving.set(false);
      return;
    }

    // עדכון state
    const s: FarmSettings = {
      ...data,
      operating_hours_start: data.operating_hours_start?.slice(0, 5) ?? null,
      operating_hours_end: data.operating_hours_end?.slice(0, 5) ?? null,
      min_time_between_cancellations: data.min_time_between_cancellations
        ? data.min_time_between_cancellations.slice(0, 5)
        : null,
    };

    this.settings.set(s);
    this.success.set('ההגדרות נשמרו בהצלחה.');
    this.saving.set(false);
  }
}

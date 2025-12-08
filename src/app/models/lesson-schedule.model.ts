export interface Lesson {
  lesson_id: string; 
  [x: string]: any;

  id: string;
  child_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  instructor_name: string;

  lesson_type: 'רגיל' | 'השלמה' | 'נסיון' | string;   // ← הוספתי נסיון וגם string לאפשר סוגים מורחבים
  series_index?: number;   // ← אם מגיע מהסדרה (חלק 1/10)
  series_total?: number;

  status: 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם';
  child_color: string;
  child_name: string;

  start_datetime?: string;
  end_datetime?: string;
  occur_date?: string;
  horse_name?: string | null;
  arena_name?: string | null;

}

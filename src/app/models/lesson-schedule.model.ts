export interface Lesson {
  id: string;
  child_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  lesson_type: string;
  status: 'ממתין לאישור' | 'מאושר' | 'הושלם';
  instructor_id: string;
  instructor_name: string;
  child_color: string;
  child_name: string;
  start_datetime: string;  // ✅ תמיד string
  end_datetime: string;    // ✅ תמיד string
}

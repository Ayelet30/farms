export interface Lesson {
  id: string;
  child_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  instructor_name: string;
  lesson_type: 'רגיל' | 'השלמה';
  status: 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם';
  child_color: string;
  child_name: string;
}

export interface Lesson {
  lesson_id: string; 
  [x: string]: any;
  id: string;
  child_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  instructor_id: string; // אם תרצי לאפשר null, שני ל: string | null
  instructor_name: string;
  lesson_type: 'רגיל' | 'השלמה';
  status: 'ממתין לאישור' | 'אושר' | 'בוטל' | 'הושלם';
  child_color: string;
  child_name: string;
  // אופציונליים – מגיעים מה-View:
  start_datetime?: string;
  end_datetime?: string;
  occur_date?: string;
}

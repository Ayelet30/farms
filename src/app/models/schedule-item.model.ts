export interface ScheduleItem {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
  status: 'ממתין לאישור' | 'מאושר' | 'הושלם';
  meta: {
    child_id: string;
    child_name: string;
    instructor_id: string;
    instructor_name: string;
    status: 'ממתין לאישור' | 'מאושר' | 'הושלם';
  };
}


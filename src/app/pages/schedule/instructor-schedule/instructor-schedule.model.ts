export interface InstructorScheduleItem {
  id: string;
  title: string;
  start: string;
  end: string;
  status?: 'active' | 'lesson' | 'free'; // אופציונלי
  color?: string;
}

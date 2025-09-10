export interface ScheduleItem {
  id: string;
  title: string;
  start: string;
  end: string;
  color?: string;
  status?: 'active' | 'lesson' | 'free';
  meta?: any;
};
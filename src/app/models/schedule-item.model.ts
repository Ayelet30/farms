export interface ScheduleItem {
  id: string;
  title: string;
  start: string;
  end: string;
  color?: string;
  status: "ממתין לאישור" | "אושר" | "בוטל" | "הושלם"  | "summary"; // ← עדכון
  meta?: {
    [x: string]: string| undefined;
    status: string;
    child_id: string;
    child_name: string;
    instructor_id: string;
    instructor_name: string;
    canCancel?: string;
    lesson_type?: string;
    isSummaryDay?: string;
    isSummarySlot?: string;
  };
}
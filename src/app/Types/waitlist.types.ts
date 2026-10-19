export type WaitlistStatus =
  | 'active'
  | 'paused'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export type RidingType = {
  id: string;
  code: string;
  name: string;
  min_participants: number | null;
  max_participants: number | null;
  description: string | null;
  active: boolean;
  spacial_price: number | null;
  spacial_duration: number | null;
};


export type WaitlistEntry = {
  id: string;
  created_at: string;
  created_by_uid: string | null;

  parent_uid: string;
  child_uuid: string;

  // שדה ישן - כעת אפשר לבחור כמה סוגי רכיבה
  riding_type_id: string | null;

  requested_day: string | null;
  time_window_start: string | null;
  time_window_end: string | null;

  preferred_instructor_uid: string | null;
  preferred_arena_id: string | null;
  preferred_horse_id: string | null;

  priority: number;
  position: number;

  status: WaitlistStatus;
  notes: string | null;

  last_contacted_at: string | null;

  linked_occurrence_id: string | null;
  offer_expires_at: string | null;
  offer_token: string | null;

  // שדות חדשים - העדפות
  all_riding_types: boolean;
  all_instructors: boolean;
  all_times: boolean;

  // שדות חדשים - הצעות ודחיות
  offer_status: 'none' | 'offered' | 'declined';
  decline_count: number;

  updated_at: string | null;
};


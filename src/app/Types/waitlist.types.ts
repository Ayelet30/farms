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
  created_by_uid: string;

  parent_uid: string;
  child_uuid: string;

  riding_type_id: string;

  requested_day: string | null;       // yyyy-mm-dd
  time_window_start: string | null;   // HH:mm:ss
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
};

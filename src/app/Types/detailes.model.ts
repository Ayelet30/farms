import { Membership } from "../services/supabaseClient.service";

export type AppointmentMode = 'parent' | 'secretary';
export type AppointmentTab = 'series' | 'makeup';
export type ParentDetails = {
  id: string;
  uid: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  email?: string | null;
};

export interface CurrentUser {
  uid: string;
  id_number?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  farmName?: string;
  email?: string;
  displayName?: string;
  role: string | null;
  memberships?: Membership[];
  selectedTenantId?: string | null;
}


export interface UserDetails {
  [x: string]: any;
  uid: string;
  first_name: string;
  last_name: string;
  id_number?: string | null;
  address?: string | null; // שימי לב: address
  phone?: string | null;
  email?: string | null;
  role?: string | null;        // למשל: 'הורה'
  role_in_tenant?: string | null; // למשל parent
  role_id?: number | null;     // אם קיים ב-tenant_users
  farm_id?: number | null;     // tenant_id
  farm_name?: string | null;   // שם החווה
  memberships?: Membership[];       // ← חדש
  selectedTenantId?: string | null; // ← אופ
};

export interface ChildRow {
  child_uuid: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
  status?: string | null;
  birth_date?: string | null;
  gov_id?: string | null;
}


export interface InstructorRow {
  instructor_uid: string;
  full_name: string;
  gender?: string | null;
  certificate?: string | null;
  about?: string | null;
  education?: string | null;
  phone?: string | null;
}
// models/secretarial-request.model.ts (או ליד הקומפוננטה)

export type RequestType =
  | 'CANCEL_OCCURRENCE'
  | 'INSTRUCTOR_DAY_OFF'
  | 'NEW_SERIES'
  | 'ADD_CHILD'
  | 'DELETE_CHILD'
  | 'MAKEUP_LESSON'
  | 'OTHER_REQUEST';

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED_BY_REQUESTER';

export interface SecretarialRequestDbRow {
  id: string;
  request_type: RequestType;
  status: RequestStatus;

  requested_by_uid: string | null;
  requested_by_role: string | null;

  child_id: string | null;
  instructor_id: string | null;
  lesson_occ_id: string | null;

  from_date: string | null;   // date
  to_date: string | null;     // date

  payload: any;               // jsonb

  decided_by_uid: string | null;
  decided_at: string | null;  // timestamptz
  decision_note: string | null;

  created_at: string;         // timestamptz
}
export interface UiRequest {
  id: string;
  requestType: RequestType;
  status: RequestStatus;

  summary: string;
  requestedByName: string;
  childName?: string;
  instructorName?: string;

  fromDate?: string | null;
  toDate?: string | null;
  createdAt: string;

  requesterUid: string | null;  // ← חשוב להוספת סינון לפי משתמש
  payload: any;
}


export interface SecretaryChargeRow {
  id: string;
  parent_uid: string | null;
  amount: number;
  date: string; // YYYY-MM-DD מ־Supabase
  method: 'one_time' | 'subscription' | null;
  invoice_url: string | null;

  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  is_external: boolean;
}

export type AddChildPayload = {
  first_name: string;
  last_name: string;
  parent_uid: string;
  gov_id?: string;
  birth_date?: string;
  gender?: string;
  health_fund?: string;
  status?: string;
  medical_notes?: string;
  behavior_notes?: string;
};


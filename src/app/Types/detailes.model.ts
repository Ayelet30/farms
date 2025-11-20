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

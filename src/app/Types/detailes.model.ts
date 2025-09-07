import { Membership } from "../services/supabaseClient";

export type ParentDetails = {
  id: string;
  uid: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
};

export interface UserDetails {
  uid: string;
  full_name: string;
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

export type ChildRow = {
  id: string;
  parent_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  class_id?: string;
  grade?: string;
  // הוסיפי כאן שדות רלוונטיים מהטבלה שלכם
};
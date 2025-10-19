import { Membership } from "../services/supabaseClient.service";

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
  full_name: string | null;
  gov_id?: string | null;
  birth_date?: string | null;
  parent_id?: string | null;
  status?: string | null;
};


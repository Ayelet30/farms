// supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';

const supabaseUrl = 'https://aztgdhcvucvpvsmusfpz.supabase.co';
const supabaseAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGdkaGN2dWN2cHZzbXVzZnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxMzI4NDIsImV4cCI6MjA2NzcwODg0Mn0.NRhi2ZJq4I0TSVI91Epf_aQT6UUYpcE7Mm1GMPSrC8s'; // עדיף מה־env

let supabase: SupabaseClient | null = null;

// קונטקסט של חווה נוכחית (tenant)
export type TenantContext = {
  id: string;      // farms.id (UUID)
  schema: string;  // farms.schema_name (e.g. 'bereshit_farm')
  accessToken?: string; // JWT קצר-חיים עם tenant_id (נזין מלמעלה)
};

let currentTenant: TenantContext | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnon, {
      auth: {
        // את מנהלת לוגין בפיירבייס, אז לא נוגעים בניהול סשן של supabase
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return supabase;
}

/**
 * קובע/מעדכן את קונטקסט החווה + מזין ל-supabase את ה-JWT עם tenant_id.
 * את ה-token מקבלת מ-Firebase Function (ראו סעיף 2).
 */
export async function setTenantContext(ctx: TenantContext) {
  currentTenant = { ...ctx };

  if (!supabase) getSupabaseClient();

  if (ctx.accessToken) {
    // מזריקים את הטוקן כך שכל הקריאות יעברו עם Authorization: Bearer <token>
    await supabase!.auth.setSession({
      access_token: ctx.accessToken,
      refresh_token: '' // אין לנו refresh; מנפיקים חדש כשצריך
    });
  }
}

/** איפוס קונטקסט (לוגאאוט חוותי) */
export async function clearTenantContext() {
  currentTenant = null;
  if (!supabase) return;
  // מסירים טוקן כדי לא להמשיך עם tenant_id ישן
  await supabase.auth.signOut(); // לא נוגע בפיירבייס, רק ב-supabase
}

/** לקוח לסכמת החווה הנוכחית (חובה לקרוא אחרי setTenantContext) */
export function db() {
  if (!supabase) getSupabaseClient();
  if (!currentTenant?.schema) {
    throw new Error('Tenant context is not set. Call setTenantContext() first.');
  }
  return supabase!.schema(currentTenant.schema);
}

/** שליפת פרטי משתמש מהשכבה הגלובלית (public.users) לפי Firebase UID */
export async function getCurrentUserData(): Promise<any> {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const { data, error } = await getSupabaseClient()
    .from('users')           // טבלה גלובלית ב-public
    .select('*')
    .eq('uid', currentUser.uid)
    .single();

  if (error) {
    console.error('שגיאה בשליפת משתמש מ-Supabase:', error);
    return null;
  }
  return data;
}

/** לוגאאוט אפליקטיבי (פיירבייס) + איפוס קונטקסט חווה */
export async function logout(): Promise<void> {
  await clearTenantContext();
  const auth = getAuth();
  await signOut(auth);
}

/** שליפת מטא-דאטה על חווה (גלובלי) */
export async function getFarmMetaById(farmId: string): Promise<{ id: string; name: string; schema_name: string } | null> {
  const { data, error } = await getSupabaseClient()
    .from('farms') // public.farms
    .select('id, name, schema_name')
    .eq('id', farmId)
    .single();

  if (error) {
    console.error('שגיאה בשליפת חווה:', error);
    return null;
  }
  return data;
}

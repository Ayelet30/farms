// supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';
import { ChildRow, ParentDetails } from '../Types/detailes.model';

const supabaseUrl = 'https://aztgdhcvucvpvsmusfpz.supabase.co';
const supabaseAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGdkaGN2dWN2cHZzbXVzZnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxMzI4NDIsImV4cCI6MjA2NzcwODg0Mn0.NRhi2ZJq4I0TSVI91Epf_aQT6UUYpcE7Mm1GMPSrC8s'; // עדיף מה־env


let supabase: SupabaseClient | null = null;
type UserRow = { uid: string; role?: string; farm_id?: string; default_farm_id?: string };

export type FarmMeta = { id: string; name: string; schema_name: string };

let currentFarmMeta: FarmMeta | null = null;

export async function determineAndSetTenantByUid(uid: string) {
  // מושכים את המשתמש הגלובלי וצופים לשדה farm_id / default_farm_id
  const { data: userRow, error } = await getSupabaseClient()
    .from('users')
    .select('uid, role, farm_id')
    .eq('uid', uid)
    .single();
    
    if (error || !userRow) throw new Error('לא נמצא משתמש גלובלי לבחירת חווה');
    
    const farmId = (userRow as UserRow).default_farm_id || (userRow as UserRow).farm_id;
    if (!farmId) throw new Error('למשתמש אין farm משויך');
    
    const meta = await getFarmMetaById(farmId);
    if (!meta) throw new Error('לא נמצאה חווה עבור המשתמש');

     currentFarmMeta = meta; // 👈 נשמר לשימוש בקומפוננטות

    // כרגע בלי minting – אין accessToken של Supabase, זה בסדר לשאילתות שמותרות ל-anon
    await setTenantContext({ id: meta.id, schema: meta.schema_name });
    return { id: meta.id, schema: meta.schema_name };
}

export type TenantContext = {
  id: string;
  schema: string;
  accessToken?: string;
};
let currentTenant: TenantContext | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnon, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          apikey: supabaseAnon,                          // ✅ תמיד נשלח
          Authorization: `Bearer ${supabaseAnon}`,       // ✅ עד setSession
        },
      },
    });
  }
  return supabase;
}

// ✅ מחליף את assertTenant()
function requireTenant(): TenantContext {
  if (!currentTenant?.schema) {
    throw new Error('Tenant context is not set. Call setTenantContext() first.');
  }
  return currentTenant;
}

// ✅ משתמשים בו בכל מקום במקום assertTenant()
function db() {
  if (!supabase) getSupabaseClient();
  const tenant = requireTenant();
  return getSupabaseClient().schema(tenant.schema);
}

/** public.users לפי Firebase UID */
export async function getCurrentUserData(): Promise<any> {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('*')
    .eq('uid', currentUser.uid)
    .single();

  if (error) {
    console.error('שגיאה בשליפת משתמש מ-Supabase:', error);
    return null;
  }
  return data;
}

/** קונטקסט טננט + הזרקת accessToken (אם יש) */
export async function setTenantContext(ctx: TenantContext) {
  currentTenant = { ...ctx };
  if (!supabase) getSupabaseClient();
  if (ctx.accessToken) {
    await supabase!.auth.setSession({ access_token: ctx.accessToken, refresh_token: '' });
  }
}

export async function clearTenantContext() {
  currentTenant = null;
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function logout(): Promise<void> {
  await clearTenantContext();
  const auth = getAuth();
  await signOut(auth);
}

/** פרטי מטא של חווה מהשכבה הגלובלית */
export async function getFarmMetaById(farmId: string): Promise<{ id: string; name: string; schema_name: string } | null> {
  const { data, error } = await getSupabaseClient()
    .from('farms')
    .select('id, name, schema_name')
    .eq('id', farmId)
    .single();

    console.log("xxxxxxxxxx", data)

  if (error) {
    console.error('שגיאה בשליפת חווה:', error);
    return null;
  }
  return data;
}

/* ------------------------- Parent Details (עם Cache) ------------------------ */

type CacheEntry<T> = { key: string; data: T; expires: number };
let parentCache: CacheEntry<ParentDetails | null> | null = null;

function parentKey(uid: string, schema: string, select: string) {
  return `${schema}::${uid}::${select}`;
}

export function invalidateParentCache() {
  parentCache = null;
}

/**
 * שליפת פרטי הורה מסכמת ה־tenant.
 * 1) קודם לפי UID (הכי זול/מדויק).
 * 2) אם אין – ננסה דרך public.users.parent_id (קריאה אחת גלובלית + אחת לסכמה).
 * `options.cacheMs` – שמירת תוצאה במטמון (ברירת מחדל 60 שניות).
 */
export async function getCurrentParentDetails(
  select = 'id_number, uid, full_name, phone, email',
  options?: { cacheMs?: number }
): Promise<ParentDetails | null> {
  const tenant = requireTenant(); // 👈 במקום assertTenant()
  const auth = getAuth();
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('No Firebase user is logged in.');
  
  const ttl = options?.cacheMs ?? 60_000;
  const key = parentKey(fbUser.uid, tenant.schema, select);
  
  const dbc = db();
  
  const { data: byUid, error: errUid } = await dbc
  .from('parents')
  .select(select)
  .eq('uid', fbUser.uid)
  .maybeSingle();
  
  console.log("*********", key);
  if (errUid) console.warn('parents by uid error:', errUid);
  if (byUid) {
    const casted = byUid as unknown as ParentDetails;
    parentCache = { key, data: casted, expires: Date.now() + ttl };
    return casted;
  }

  const appUser = await getCurrentUserData();
  if (appUser?.parent_id) {
    const { data: byId, error: errId } = await dbc
      .from('parents')
      .select(select)
      .eq('id', appUser.parent_id as string)
      .maybeSingle();
    if (errId) console.warn('parents by id error:', errId);
    const casted = (byId as unknown as ParentDetails) ?? null;
    parentCache = { key, data: casted, expires: Date.now() + ttl };
    return casted;
  }

  parentCache = { key, data: null, expires: Date.now() + ttl };
  return null;
}


/**
 * עוטפת את getCurrentParentDetails ומחזירה גם סטטוס פשוט לשימוש בקומפוננטות.
 */
export async function fetchCurrentParentDetails(
  select = 'id, uid, full_name, phone, email',
  options?: { cacheMs?: number }
): Promise<{ ok: boolean; data: ParentDetails | null; error?: string }> {
  try {
    const data = await getCurrentParentDetails(select, options);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message ?? 'Unknown error' };
  }
}

// ----- Children API -----

/** כל הילדים להורה הנוכחי (ע"פ parent_id, עם נפילה ל-parent_uid אם קיים) */
export async function getMyChildren(
  select = 'id, parent_uid, full_name,'
): Promise<ChildRow[]> {
  // נמצא את ההורה (יש לך כבר את הפונקציה הזו)
  const parent = await getCurrentParentDetails('id, uid');
  if (!parent?.id && !parent?.uid) {
    throw new Error('Parent not found for current user');
  }

  // תמיד עוברים דרך הסכמה של הטננט
  const query = db().from('children').select(select);

  // 1) ראשית לפי parent_id (ה-FK המקובל)
  if (parent?.id) {
    const { data, error } = await query.eq('parent_id', parent.id).order('full_name', { ascending: true });
    if (error) throw error;
    if (data && data.length) return data as unknown as ChildRow[];
  }

  // 2) נפילה אופציונלית: אם יש עמודה children.parent_uid אצלך
  if (parent?.uid) {
    const { data, error } = await db()
      .from('children')
      .select(select)
      .eq('parent_uid', parent.uid)
      .order('full_name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as ChildRow[];
  }

  return [];
}

/** עטיפה עם סטטוס לשימוש נוח בקומפוננטות */
export async function fetchMyChildren(
  select = 'id, parent_id, full_name, class_id, grade'
): Promise<{ ok: boolean; data: ChildRow[]; error?: string }> {
  try {
    const data = await getMyChildren(select);
    return { ok: true, data };
  } catch (e: any) {
    console.warn('getMyChildren error:', e);
    return { ok: false, data: [], error: e?.message ?? 'Unknown error' };
  }
}

export function getCurrentFarmMetaSync(): FarmMeta | null {
  return currentFarmMeta;
}

export async function getCurrentFarmMeta(opts?: { refresh?: boolean }): Promise<FarmMeta | null> {
  const tenant = requireTenant(); // יוודא שיש קונטקסט
  if (!currentFarmMeta || opts?.refresh) {
    const meta = await getFarmMetaById(tenant.id);
    currentFarmMeta = meta;
  }
  return currentFarmMeta;
}

export async function getCurrentFarmName(opts?: { refresh?: boolean }): Promise<string | null> {
  const meta = await getCurrentFarmMeta(opts);
  return meta?.name ?? null;
}

export async function fetchCurrentFarmName(opts?: { refresh?: boolean })
: Promise<{ ok: boolean; data: string | null; error?: string }> {
  try {
    const name = await getCurrentFarmName(opts);
    return { ok: true, data: name };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message ?? 'Unknown error' };
  }
}



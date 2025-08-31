// src/app/services/supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';
import { ChildRow, ParentDetails } from '../Types/detailes.model';

/** ===================== CONFIG ===================== **/
// רצוי להעביר ל-environment / runtime config
const SUPABASE_URL = 'https://aztgdhcvucvpvsmusfpz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGdkaGN2dWN2cHZzbXVzZnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxMzI4NDIsImV4cCI6MjA2NzcwODg0Mn0.NRhi2ZJq4I0TSVI91Epf_aQT6UUYpcE7Mm1GMPSrC8s';

/** ===================== TYPES ===================== **/
export type FarmMeta = { id: string; name: string; schema_name: string };
export type TenantContext = { id: string; schema: string; accessToken?: string };

type UserRow = {
  uid: string;
  role?: string;
  farm_id?: string;
  default_farm_id?: string;
};

type BootstrapResp = {
  access_token: string;
  farm: FarmMeta;
  role_in_tenant: string;
};

/** ===================== STATE ===================== **/
let supabase: SupabaseClient | null = null;
let authBearer: string | null = null;   // ה-JWT הקצר-מועד מהשרת
let currentTenant: TenantContext | null = null;
let currentFarmMeta: FarmMeta | null = null;
let refreshTimer: any = null;

/** ===================== CLIENT FACTORY ===================== **/
function makeClient(): SupabaseClient {
  return createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
    auth: {
      // אין לנו refresh_token → לא לנהל session פנימי של supabase-js
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: async (_n, _t, fn) => await fn(),
    },
    global: {
      headers: {
        apikey: SUPABASE_ANON_KEY.trim(),
        ...(authBearer ? { Authorization: `Bearer ${authBearer}` } : {}),
      },
    },
  });
}

/** ספק יחיד של ה-client */
export function getSupabaseClient(): SupabaseClient {
  if (!supabase) supabase = makeClient();
  return supabase;
}

/** ===================== HELPERS ===================== **/
function requireTenant(): TenantContext {
  if (!currentTenant?.schema) {
    throw new Error('Tenant context is not set. Call setTenantContext() first.');
  }
  return currentTenant;
}

function db() {
  if (!supabase) getSupabaseClient();
  const tenant = requireTenant();
  return getSupabaseClient().schema(tenant.schema);
}

/** ===================== TENANT / SESSION ===================== **/
export async function setTenantContext(ctx: TenantContext) {
  currentTenant = { ...ctx };

  // נשמור את ה-JWT ונבנה קליינט חדש עם Authorization גלובלי
  authBearer = ctx.accessToken ?? null;
  supabase = makeClient();

  // תזמון ריענון לפני פקיעה (אופציונלי)
  clearTimeout(refreshTimer);
  if (authBearer) scheduleTokenRefresh(authBearer);
}

export async function clearTenantContext() {
  currentTenant = null;
  authBearer = null;
  clearTimeout(refreshTimer);
  refreshTimer = null;

  // בונים קליינט “נקי” ללא Authorization
  supabase = makeClient();

  // ניקוי auth פנימי (למקרה שהיו זרימות אחרות)
  await supabase.auth.signOut().catch(() => {});
}

export async function logout(): Promise<void> {
  await clearTenantContext();
  const auth = getAuth();
  await signOut(auth);
}

/** ===================== GLOBAL (public schema) ===================== **/
/** שליפת משתמש גלובלי לפי Firebase UID (public schema) */
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

/** מטא-דאטה של חווה מהשכבה הגלובלית */
export async function getFarmMetaById(farmId: string): Promise<FarmMeta | null> {
  const { data, error } = await getSupabaseClient()
    .from('farms')
    .select('id, name, schema_name')
    .eq('id', farmId)
    .single();

  if (error) {
    console.error('שגיאה בשליפת חווה:', error);
    return null;
  }
  return data as FarmMeta;
}

/** ===================== PARENT CACHE ===================== **/
type CacheEntry<T> = { key: string; data: T; expires: number };
let parentCache: CacheEntry<ParentDetails | null> | null = null;

function parentKey(uid: string, schema: string, select: string) {
  return `${schema}::${uid}::${select}`;
}

export function invalidateParentCache() {
  parentCache = null;
}

/** ===================== PARENT API (per-tenant) ===================== **/
export async function getCurrentParentDetails(
  select = 'uid, full_name, id_number, adress, phone, email',
  options?: { cacheMs?: number }
): Promise<ParentDetails | null> {
  const tenant = requireTenant();
  const auth = getAuth();
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('No Firebase user is logged in.');

  const ttl = options?.cacheMs ?? 60_000;
  const key = parentKey(fbUser.uid, tenant.schema, select);

  if (parentCache && parentCache.key === key && parentCache.expires > Date.now()) {
    return parentCache.data;
  }

  const dbc = db();

  // לפי UID (TEXT)
  const { data: byUid, error: errUid } = await dbc
    .from('parents') 
    .select(select)
    .eq('uid', fbUser.uid)
    .maybeSingle();

  if (errUid) console.warn('parents by uid error:', errUid);
  if (byUid) {
    const casted = byUid as unknown as ParentDetails;
    parentCache = { key, data: casted, expires: Date.now() + ttl };
    return casted;
  }

  // נפילה אופציונלית לפי parent_id (אם יש בשכבה הגלובלית)
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

export async function fetchCurrentParentDetails(
  select = 'uid, full_name, phone, emailfull_name, birth_date, parent_uid, status, health_fund, instructor',
  options?: { cacheMs?: number }
): Promise<{ ok: boolean; data: ParentDetails | null; error?: string }> {
  try {
    const data = await getCurrentParentDetails(select, options);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message ?? 'Unknown error' };
  }
}

/** ===================== CHILDREN API (per-tenant) ===================== **/
export async function getMyChildren(
  select = 'id, parent_uid, full_name'
): Promise<ChildRow[]> {
  const fbUid = getAuth().currentUser?.uid;
  if (!fbUid) throw new Error('No Firebase user');

  const dbc = db();
  const parent = await getCurrentParentDetails('id_number, uid', { cacheMs: 0 });
  
  
  // קודם ננסה לפי parent_id (UUID)
  if (parent?.uid) {
    const { data, error } = await dbc
    .from('children')
    .select(select)
    .eq('parent_uid', parent.uid)
    .order('full_name', { ascending: true });
    
    if (!error) return (data ?? []) as unknown as ChildRow[];
    
    console.log('!!!!!!!!!', select);
    console.log('!!!!!!!!!', data);

    const msg = (error as any)?.message || '';
    const looksLikeBadColumn =
      msg.includes('parent_id') ||
      (error as any)?.code === 'PGRST302' ||
      (error as any)?.code === 'PGRST301';

    if (!looksLikeBadColumn) throw error; // שגיאה אחרת – נזרוק
  }

  // נפילה: לפי parent_uid (טקסט = Firebase UID)
  const { data, error } = await dbc
    .from('children')
    .select(select)
    .eq('parent_uid', fbUid)
    .order('full_name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ChildRow[];
}


export async function fetchMyChildren(
  select = 'id, parent_uid, full_name'
): Promise<{ ok: boolean; data: ChildRow[]; error?: string }> {
  try {
    const data = await getMyChildren(select);
    return { ok: true, data };
  } catch (e: any) {
    console.warn('getMyChildren error:', e);
    return { ok: false, data: [], error: e?.message ?? 'Unknown error' };
  }
}

/** ===================== FARM META (per-tenant) ===================== **/
export function getCurrentFarmMetaSync(): FarmMeta | null {
  return currentFarmMeta;
}

export async function getCurrentFarmMeta(
  opts?: { refresh?: boolean }
): Promise<FarmMeta | null> {
  const tenant = requireTenant();
  if (!currentFarmMeta || opts?.refresh) {
    const meta = await getFarmMetaById(tenant.id);
    currentFarmMeta = meta;
  }
  return currentFarmMeta;
}

export async function getCurrentFarmName(
  opts?: { refresh?: boolean }
): Promise<string | null> {
  const meta = await getCurrentFarmMeta(opts);
  return meta?.name ?? null;
}

export async function fetchCurrentFarmName(
  opts?: { refresh?: boolean }
): Promise<{ ok: boolean; data: string | null; error?: string }> {
  try {
    const name = await getCurrentFarmName(opts);
    return { ok: true, data: name };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message ?? 'Unknown error' };
  }
}

/** ===================== BOOTSTRAP (after Firebase sign-in) ===================== **/
export async function bootstrapSupabaseSession(): Promise<BootstrapResp> {
  const fb = getAuth();
  const user = fb.currentUser;
  if (!user) throw new Error('No Firebase user');

  const idToken = await user.getIdToken(true);

  const res = await fetch('/api/loginBootstrap', {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  const ctype = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `loginBootstrap failed: ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (!ctype.includes('application/json')) {
    const snippet = await res.text().then(t => t.slice(0, 200)).catch(() => '');
    throw new Error(`loginBootstrap returned non-JSON (${ctype}). Snippet: ${snippet}`);
  }

  const data = (await res.json()) as BootstrapResp;

  await setTenantContext({
    id: data.farm.id,
    schema: data.farm.schema_name,
    accessToken: data.access_token,
  });

  currentFarmMeta = data.farm;
  return data;
}

/** ===================== LEGACY PICK-TENANT (optional) ===================== **/
export async function determineAndSetTenantByUid(uid: string) {
  const { data: userRow, error } = await getSupabaseClient()
    .from('users')
    .select('uid, role, farm_id, default_farm_id')
    .eq('uid', uid)
    .single();

  if (error || !userRow) throw new Error('לא נמצא משתמש גלובלי לבחירת חווה');

  const farmId = (userRow as UserRow).default_farm_id || (userRow as UserRow).farm_id;
  if (!farmId) throw new Error('למשתמש אין farm משויך');

  const meta = await getFarmMetaById(farmId);
  if (!meta) throw new Error('לא נמצאה חווה עבור המשתמש');

  currentFarmMeta = meta;
  await setTenantContext({ id: meta.id, schema: meta.schema_name }); // ללא JWT מותאם
  return { id: meta.id, schema: meta.schema_name };
}

/** ===================== TOKEN REFRESH (optional) ===================== **/
function scheduleTokenRefresh(jwt: string) {
  try {
    const body = jwt.split('.')[1] || '';
    const { exp } = JSON.parse(atob(body)); // exp בשניות
    const msLeft = exp * 1000 - Date.now();
    const delay = Math.max(msLeft - 60_000, 10_000); // דקה לפני פקיעה

    refreshTimer = setTimeout(async () => {
      try {
        // מנפיקים JWT חדש מהפונקציה, וזה יקרא שוב ל-setTenantContext
        await bootstrapSupabaseSession();
      } catch (e) {
        console.warn('token refresh failed', e);
      }
    }, delay);
  } catch {
    // אם לא הצלחנו לפענח – לא נתזמן; לפיתוח זה בסדר
  }
}

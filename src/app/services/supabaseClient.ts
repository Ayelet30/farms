
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';
import { ChildRow, ParentDetails, UserDetails } from '../Types/detailes.model';

/** ===================== RUNTIME CONFIG (בלי מפתחות בקוד) ===================== **/
function readMeta(name: string): string | null {
  const el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  return el?.content?.trim() || null;
}
function runtime(key: string): string | null {
  const w = (window as any);
  return (w.__RUNTIME__?.[key] ?? readMeta(`x-${key.toLowerCase().replace(/_/g, '-')}`) ??
          (import.meta as any).env?.[key] ?? (process as any)?.env?.[key] ?? null)?.trim?.() || null;
}

const SUPABASE_URL = runtime('SUPABASE_URL');
const SUPABASE_ANON_KEY = runtime('SUPABASE_ANON_KEY');

/** ===================== TYPES ===================== **/
export type FarmMeta = { id: string; name: string; schema_name: string };
export type TenantContext = { id: string; schema: string; accessToken?: string };

export type RoleInTenant = 'parent' | 'instructor' | 'secretary' | 'manager' | 'admin' | 'coordinator';
export type Membership = { tenant_id: string; role_in_tenant: RoleInTenant; farm: FarmMeta | null };

type BootstrapResp = {
  access_token: string;
  farm: FarmMeta;
  role_in_tenant: RoleInTenant;
};

/** ===================== STATE ===================== **/
let supabase: SupabaseClient | null = null;
let authBearer: string | null = null;
let currentTenant: TenantContext | null = null;
let currentFarmMeta: FarmMeta | null = null;
let refreshTimer: any = null;

/** ===================== CLIENT ===================== **/
function makeClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase runtime config (SUPABASE_URL / SUPABASE_ANON_KEY)');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: async (_n, _t, fn) => await fn(),
    },
    global: {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        ...(authBearer ? { Authorization: `Bearer ${authBearer}` } : {}),
      },
    },
  });
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) supabase = makeClient();
  return supabase;
}

function requireTenant(): TenantContext {
  if (!currentTenant?.schema) throw new Error('Tenant context is not set. Call setTenantContext() first.');
  return currentTenant;
}

let _baseClient: any | null = null;
let _schemaClients: Record<string, any> = {};
export function db(schema?: string) {
  const base = getSupabaseClient();
  if (_baseClient !== base) { _baseClient = base; _schemaClients = {}; }
  const effectiveSchema = schema ?? requireTenant().schema;
  if (!_schemaClients[effectiveSchema]) _schemaClients[effectiveSchema] = base.schema(effectiveSchema);
  return _schemaClients[effectiveSchema];
}
export const dbTenant = () => db();
export const dbPublic = () => db('public');
export function clearDbCache() { _schemaClients = {}; }

export async function setTenantContext(ctx: TenantContext) {
  currentTenant = { ...ctx };
  authBearer = ctx.accessToken ?? null;
  supabase = makeClient();
  clearTimeout(refreshTimer);
  if (authBearer) scheduleTokenRefresh(authBearer);
}

export async function clearTenantContext() {
  currentTenant = null;
  authBearer = null;
  clearTimeout(refreshTimer);
  refreshTimer = null;
  supabase = makeClient();
  try { await supabase.auth.signOut(); } catch {}
}

export async function logout(): Promise<void> {
  await clearTenantContext();
  await signOut(getAuth());
}

/** ===================== BASIC USER/FARM ===================== **/
export async function getCurrentUserData(): Promise<any> {
  const currentUser = getAuth().currentUser;
  if (!currentUser) return null;
  const { data } = await getSupabaseClient().from('users').select('*').eq('uid', currentUser.uid).maybeSingle();
  return data ?? null;
}

export async function getFarmMetaById(farmId: string): Promise<FarmMeta | null> {
  const { data } = await getSupabaseClient()
    .from('farms')
    .select('id, name, schema_name')
    .eq('id', farmId)
    .maybeSingle();
  return (data as FarmMeta) ?? null;
}

/** ===================== CACHES ===================== **/
export function getCurrentFarmMetaSync(): FarmMeta | null { return currentFarmMeta; }
export async function getCurrentFarmMeta(opts?: { refresh?: boolean }): Promise<FarmMeta | null> {
  const tenant = requireTenant();
  if (!currentFarmMeta || opts?.refresh) currentFarmMeta = await getFarmMetaById(tenant.id);
  return currentFarmMeta;
}
export async function getCurrentFarmName(opts?: { refresh?: boolean }): Promise<string | null> {
  const meta = await getCurrentFarmMeta(opts); return meta?.name ?? null; }

/** ===================== DETAILS ===================== **/
async function resolveRoleAndFarm(
  dbcTenant: ReturnType<typeof db>,
  dbcPublic: ReturnType<typeof db>,
  uid: string
): Promise<{ targetTable: string | null; role: string | null; role_in_tenant: string | null; roleId: number | null; farmId: number | null; farmName: string | null }> {
  const { data: tu } = await dbcPublic
    .from('tenant_users')
    .select('tenant_id, role_id, role_in_tenant, is_active')
    .eq('uid', uid)
    .eq('is_active', true)
    .maybeSingle();

  const farmId = tu?.tenant_id ?? null;
  const roleId = tu?.role_id ?? null;
  const role_in_tenant = (tu?.role_in_tenant as string | null) ?? null;
  let roleStr: string | null = role_in_tenant;
  let targetTable: string | null = null;

  if (roleId != null) {
    const { data: rr } = await dbcTenant.from('role').select('id, description, table').eq('id', roleId).maybeSingle();
    if (rr?.table) { targetTable = rr.table as string; roleStr = (rr.description as string) ?? roleStr; }
  }
  if (!targetTable && roleStr) {
    const { data: rr2 } = await dbcTenant.from('role').select('table').eq('description', roleStr).maybeSingle();
    if (rr2?.table) targetTable = rr2.table as string;
  }

  let farmName: string | null = null;
  if (farmId != null) {
    const { data: farm } = await dbcPublic.from('farms').select('name').eq('id', farmId).maybeSingle();
    farmName = (farm?.name as string) ?? null;
  }

  if (!targetTable) {
    const { data: roles } = await dbcTenant.from('role').select('table');
    for (const r of roles ?? []) {
      const tbl = r.table as string; if (!tbl) continue;
      const { data } = await dbcTenant.from(tbl).select('uid').eq('uid', uid).maybeSingle();
      if (data) { targetTable = tbl; break; }
    }
  }
  return { targetTable, role: roleStr ?? null, role_in_tenant, roleId, farmId, farmName };
}

let userCache: { key: string; data: UserDetails; expires: number } | null = null;
export async function getCurrentUserDetails(
  select = 'uid, full_name, id_number, address, phone, email',
  options?: { cacheMs?: number }
): Promise<UserDetails | null> {
  const tenant = requireTenant();
  const fbUser = getAuth().currentUser;
  if (!fbUser) throw new Error('No Firebase user is logged in.');

  const ttl = options?.cacheMs ?? 60_000;
  const cacheKey = `${tenant.schema}|${fbUser.uid}|${select}`;
  if (userCache && userCache.key === cacheKey && userCache.expires > Date.now()) return userCache.data;

  const dbcTenant = db();
  const dbcPublic = db('public');
  const { targetTable, role, role_in_tenant, roleId, farmId, farmName } = await resolveRoleAndFarm(dbcTenant, dbcPublic, fbUser.uid);
  if (!targetTable) return null;

  let { data, error } = await dbcTenant.from(targetTable).select(select).eq('uid', fbUser.uid).maybeSingle();
  if (error) {
    const retry = await dbcTenant.from(targetTable).select('*').eq('uid', fbUser.uid).maybeSingle();
    data = retry.data;
  }
  const rec: any = data ?? null; if (!rec) return null;
  const address = rec.address ?? rec.adress ?? null;

  const result: UserDetails = {
    uid: rec.uid ?? fbUser.uid,
    full_name: rec.full_name ?? null,
    id_number: rec.id_number ?? null,
    address,
    phone: rec.phone ?? null,
    email: rec.email ?? null,
    role,
    role_in_tenant: role_in_tenant ?? null,
    role_id: roleId,
    farm_id: farmId,
    farm_name: farmName,
  };
  userCache = { key: cacheKey, data: result, expires: Date.now() + ttl };
  return result;
}

/** ===================== BOOTSTRAP + TOKEN REFRESH ===================== **/
export async function bootstrapSupabaseSession(tenantId?: string): Promise<BootstrapResp> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('No Firebase user');
  const idToken = await user.getIdToken(true);
  const url = tenantId ? `/api/loginBootstrap?tenantId=${tenantId}` : '/api/loginBootstrap';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  const raw = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(parsed?.error || `loginBootstrap failed: ${res.status}`);
  const data = parsed as BootstrapResp;

  if (tenantId) {
    await setTenantContext({ id: data.farm.id, schema: data.farm.schema_name, accessToken: data.access_token });
    currentFarmMeta = data.farm;
  }
  return data;
}

function scheduleTokenRefresh(jwt: string) {
  try {
    const body = jwt.split('.')[1] || '';
    const { exp } = JSON.parse(atob(body));
    const msLeft = exp * 1000 - Date.now();
    const delay = Math.max(msLeft - 60_000, 10_000);
    refreshTimer = setTimeout(async () => { try { await bootstrapSupabaseSession(); } catch (e) { console.warn('token refresh failed', e); } }, delay);
  } catch { /* ignore */ }
}

/** ===================== MEMBERSHIPS (multi-tenant) ===================== **/
let membershipsCache: Membership[] = [];
export function clearMembershipCache() { membershipsCache = []; }

export async function listMembershipsForCurrentUser(force = false): Promise<Membership[]> {
  const fb = getAuth().currentUser; if (!fb) throw new Error('No Firebase user');
  if (!force && membershipsCache.length) return membershipsCache;

  // ⚠️ בוחרים את role_in_tenant ולא את role_id (שמספרי)
  const { data, error } = await dbPublic()
    .from('tenant_users')
    .select(`tenant_id, role_in_tenant, farm:tenant_id ( id, name, schema_name )`)
    .eq('uid', fb.uid)
    .eq('is_active', true);

  if (error) throw error;
  membershipsCache = (data ?? []).map((r: any) => ({
    tenant_id: r.tenant_id,
    role_in_tenant: (r.role_in_tenant as RoleInTenant) ?? 'parent',
    farm: r.farm ?? null,
  }));
  return membershipsCache;
}

export function getSelectedMembershipSync(): Membership | null {
  if (!currentTenant) return null;
  const found = (membershipsCache ?? []).find(m => m.tenant_id === currentTenant!.id);
  return found ?? (currentFarmMeta ? { tenant_id: currentTenant.id, role_in_tenant: 'parent' as RoleInTenant, farm: currentFarmMeta } : null);
}

export async function selectMembership(tenantId: string): Promise<Membership> {
  const list = await listMembershipsForCurrentUser(true);
  const chosen = list.find(m => m.tenant_id === tenantId) ?? list[0];
  if (!chosen) throw new Error('No memberships');

  // מנפיקים JWT Tenant ומקימים הקשר
  const boot = await bootstrapSupabaseSession(tenantId);
  await setTenantContext({ id: chosen.farm?.id ?? tenantId, schema: chosen.farm?.schema_name ?? 'public', accessToken: boot.access_token });

  // מעדכנים מטא
  currentFarmMeta = boot.farm ?? chosen.farm ?? currentFarmMeta;

  // מעדכנים cache
  membershipsCache = list.map(m => m.tenant_id === chosen.tenant_id ? { ...m, role_in_tenant: boot.role_in_tenant ?? m.role_in_tenant, farm: boot.farm ?? m.farm } : m);

  localStorage.setItem('selectedTenant', chosen.tenant_id);
  return membershipsCache.find(m => m.tenant_id === chosen.tenant_id)!;
}

/** ===================== PARENT API (per-tenant) ===================== **/
export async function getCurrentParentDetails(
  select = 'uid, full_name, id_number, address, phone, email',
  options?: { cacheMs?: number }
): Promise<ParentDetails | null> {
  const tenant = requireTenant(); // חייב להיות context פעיל
  const fbUser = getAuth().currentUser;
  if (!fbUser) throw new Error('No Firebase user is logged in.');

  const dbc = db(tenant.schema);
  // חיפוש לפי uid (ברירת מחדל)
  const { data: byUid, error: errUid } = await dbc
    .from('parents')
    .select(select)
    .eq('uid', fbUser.uid)
    .maybeSingle();

  if (!errUid && byUid) return byUid as unknown as ParentDetails;

  // נפילה אחורה לפי user.public.parent_id אם קיים
  const appUser = await getCurrentUserData();
  if (appUser?.parent_id) {
    const { data: byId } = await dbc
      .from('parents')
      .select(select)
      .eq('id', appUser.parent_id as string)
      .maybeSingle();
    return (byId as unknown as ParentDetails) ?? null;
  }
  return null;
}

export async function fetchCurrentParentDetails(
  select = 'uid, full_name, phone, email, id_number, address',
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

  const dbc = db(); // משתמש בסכימת הטננט הנוכחית

  // ננסה קודם למצוא הורה בטבלת parents (מדויק יותר)
  const parent = await getCurrentParentDetails('uid', { cacheMs: 0 }).catch(() => null);
  if (parent?.uid) {
    const { data, error } = await dbc
      .from('children')
      .select(select)
      .eq('parent_uid', parent.uid)
      .order('full_name', { ascending: true });

    if (!error) return (data ?? []) as unknown as ChildRow[];

    // אם יש שגיאה על עמודה/מדיניות — ניפול לפילטר לפי fbUid
    const msg = (error as any)?.message || '';
    const looksLikeBadColumn =
      msg.includes('parent_id') ||
      (error as any)?.code === 'PGRST302' ||
      (error as any)?.code === 'PGRST301';
    if (!looksLikeBadColumn) throw error;
  }

  // נפילה אחורה: פילטר ישיר לפי uid של המשתמש
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

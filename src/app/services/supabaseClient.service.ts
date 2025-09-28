
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
const LOGIN_BOOTSTRAP_URL = runtime('LOGIN_BOOTSTRAP_URL') ?? '/api/loginBootstrap';


/** ===================== TYPES ===================== **/
export type FarmMeta = { id: string; name: string; schema_name: string; logo_url?: string | null };
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

let currentRoleInTenant: string | null = null;

// מאזינים לשינוי טננט (למשל כדי לרענן UI/ראוטרים)
type TenantListener = (ctx: TenantContext | null) => void;
const tenantListeners = new Set<TenantListener>();
export function onTenantChange(cb: TenantListener): () => void {
  tenantListeners.add(cb);
  return () => tenantListeners.delete(cb);
}
function notifyTenantChange() {
  for (const cb of tenantListeners) { try { cb(currentTenant); } catch { } }
}

// לזכור את בקשת הבוטסטרפ האחרונה – לרענון טוקן לאותו טננט/רול
let _lastBootstrap: { tenantId?: string; roleInTenant?: string | null } = {};


/** ===================== CLIENT ===================== **/
function makeClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase runtime config');

  const storageKey = `sb-${currentTenant?.id ?? 'neutral'}-auth`;

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey,
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

export function requireTenant(): TenantContext {
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

let _ctxLock: Promise<void> | null = null;

export async function setTenantContext(ctx: TenantContext) {
  const run = async () => {
    currentTenant = { ...ctx };
    authBearer = ctx.accessToken ?? null;
    supabase = makeClient();
    clearTimeout(refreshTimer);
    if (authBearer) scheduleTokenRefresh(authBearer);
    notifyTenantChange();                 // <-- הוספה
  };
  _ctxLock = (_ctxLock ?? Promise.resolve()).then(run);
  await _ctxLock;
}

export async function clearTenantContext() {
  currentTenant = null;
  authBearer = null;
  clearTimeout(refreshTimer);
  refreshTimer = null;
  supabase = makeClient();
  try { await supabase.auth.signOut(); } catch { }
  notifyTenantChange();                   // <-- הוספה
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
  const meta = await getCurrentFarmMeta(opts); return meta?.name ?? null;
}

type ResolveOpts = {
  tenantId?: string | null;         // אילוץ טננט מסוים (מומלץ להעביר!)
  roleInTenant?: string | null;     // אופציונלי: אילוץ role בתוך הטננט
};

/** ===================== DETAILS ===================== **/
async function resolveRoleAndFarm(
  dbcTenant: ReturnType<typeof db>,
  dbcPublic: ReturnType<typeof db>,
  uid: string,
  opts: ResolveOpts = {}
): Promise<{
  targetTable: string | null;
  role: string | null;
  role_in_tenant: string | null;
  roleId: number | null;
  farmId: number | null;
  farmName: string | null;
}> {
  // ננסה לנעול טננט לפי הקשר קיים אם לא הועבר במפורש
  let ctxTenantId: string | null = null;
  try { ctxTenantId = requireTenant().id; } catch { /* no context yet */ }

  const wantedTenantId = opts.tenantId ?? ctxTenantId ?? null;
  const wantedRole = opts.roleInTenant ?? null;

  // בונים שאילתה שמחזירה מקסימום שורה אחת (uid + tenant_id [+ role])
  let q = dbcPublic
    .from('tenant_users')
    .select('tenant_id, role_id, role_in_tenant, is_active')
    .eq('uid', uid)
    .eq('is_active', true);

  if (wantedTenantId) q = q.eq('tenant_id', wantedTenantId);
  if (wantedRole) q = q.eq('role_in_tenant', wantedRole as any);

  // נסיון ראשון: maybeSingle — ואם יש ריבוי שורות ניפול ללימיט 1
  let tu: any | null = null;
  const firstTry = await q.maybeSingle();
  if (!firstTry.error) {
    tu = firstTry.data ?? null;
  } else {
    // 406 / Ambiguous result וכו' — נביא שורה אחת מפורשות
    const { data: list } = await q.limit(1);
    tu = (list && list[0]) || null;
  }

  const farmId = tu?.tenant_id ?? wantedTenantId ?? null;
  const roleId = tu?.role_id ?? null;
  const role_in_tenant = (tu?.role_in_tenant as string | null) ?? wantedRole ?? null;
  let roleStr: string | null = role_in_tenant;
  let targetTable: string | null = null;

  // ניסיון לפי role_id → role.description/table
  if (roleId != null) {
    const { data: rr } = await dbcTenant
      .from('role')
      .select('id, description, table')
      .eq('id', roleId)
      .maybeSingle();
    if (rr?.table) {
      targetTable = rr.table as string;
      roleStr = (rr.description as string) ?? roleStr;
    }
  }

  // ניסיון לפי description → table
  if (!targetTable && roleStr) {
    const { data: rr2 } = await dbcTenant
      .from('role')
      .select('table')
      .eq('description', roleStr)
      .maybeSingle();
    if (rr2?.table) targetTable = rr2.table as string;
  }

  // שם חווה
  let farmName: string | null = null;
  if (farmId != null) {
    const { data: farm } = await dbcPublic
      .from('farms')
      .select('name')
      .eq('id', farmId)
      .maybeSingle();
    farmName = (farm?.name as string) ?? null;
  }

  // fallback: חיפוש טבלה לפי מופע uid (בטננט הנוכחי בלבד)
  if (!targetTable) {
    const { data: roles } = await dbcTenant.from('role').select('table');
    for (const r of roles ?? []) {
      const tbl = r.table as string;
      if (!tbl) continue;
      const { data } = await dbcTenant.from(tbl).select('uid').eq('uid', uid).limit(1);
      if (data && data.length) { targetTable = tbl; break; }
    }
  }

  return { targetTable, role: roleStr ?? null, role_in_tenant, roleId, farmId, farmName };
}

let userCache: { key: string; data: UserDetails; expires: number } | null = null;

export async function getCurrentUserDetails(
  select = 'uid, full_name, id_number',
  options?: { cacheMs?: number }
): Promise<UserDetails | null> {
  const tenant = requireTenant();
  const fbUser = getAuth().currentUser;

  if (!fbUser) throw new Error('No Firebase user is logged in.');

  const ttl = options?.cacheMs ?? 60_000;
  const cacheKey = `${tenant.schema}|${fbUser.uid}|${select}`;
  if (userCache && userCache.key === cacheKey && userCache.expires > Date.now()) return userCache.data;

  const dbcTenant = db();         // סכימת הטננט הנוכחית
  const dbcPublic = db('public');

  // ננעלים לטננט הנבחר כדי לא להתבלבל בין חוות שונות
  const { targetTable, role, role_in_tenant, roleId, farmId, farmName } =
    await resolveRoleAndFarm(dbcTenant, dbcPublic, fbUser.uid, { tenantId: tenant.id });

  if (!targetTable) return null;

  // במקום maybeSingle: מביאים את כל הרשומות עבור ה-uid ובוחרים אחת דטרמיניסטית
  const { data: rows, error } = await dbcTenant
    .from(targetTable)
    .select('*')                 // מביא * כדי שנוכל לדרג לפי שדות אם קיימים
    .eq('uid', fbUser.uid);

  if (error) throw error;


  const list = (rows ?? []) as any[];
  if (!list.length) return null;

  // פונקציית בחירה דטרמיניסטית כשיש כפילויות:
  const pickBest = (arr: any[]) => {
    if (arr.length === 1) return arr[0];

    // 1) is_active === true אם קיים
    let filtered = arr;
    if (arr.some(r => 'is_active' in r)) {
      const actives = arr.filter(r => r.is_active === true);
      if (actives.length) filtered = actives;
    }

    // 2) לפי updated_at אם קיים
    if (filtered.some(r => 'updated_at' in r && r.updated_at)) {
      filtered = [...filtered].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      return filtered[0];
    }

    // 3) לפי created_at אם קיים
    if (filtered.some(r => 'created_at' in r && r.created_at)) {
      filtered = [...filtered].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return filtered[0];
    }

    // 4) לפי id (אם נומרי/מספיק להשוואה)
    if (filtered.some(r => 'id' in r)) {
      filtered = [...filtered].sort((a, b) => {
        const ax = typeof a.id === 'number' ? a.id : parseInt(a.id, 10) || 0;
        const bx = typeof b.id === 'number' ? b.id : parseInt(b.id, 10) || 0;
        return bx - ax;
      });
      return filtered[0];
    }

    // 5)fallback: פשוט הראשונה בסדר קבוע
    return filtered[0];
  };

  const rec: any = pickBest(list);
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
const farmLogoCache = new Map<string, string | null>();

// ✅ מחזיר את ה-URL כמו שהוא שמור בטבלה, בלי לגעת ב-Storage בכלל
export async function getCurrentFarmLogoUrl(): Promise<string | null> {
  const ctx = requireTenant(); // חייב להיות קונטקסט טננט
  const { data, error } = await dbPublic()
    .from('farms')
    .select('logo_url')
    .eq('id', ctx.id)
    .maybeSingle();
  if (error) throw error;
  const url = (data?.logo_url || '').trim();
  return url || null;
}

export async function getFarmLogoUrl(farmIdOrSchema: string): Promise<string | null> {
  const { data, error } = await dbPublic()
    .from('farms')
    .select('logo_url')
    .or(`id.eq.${farmIdOrSchema},schema_name.eq.${farmIdOrSchema}`)
    .maybeSingle();
  if (error) throw error;
  const url = (data?.logo_url || '').trim();
  return url || null;
}


/** ===================== BOOTSTRAP + TOKEN REFRESH ===================== **/
export async function bootstrapSupabaseSession(tenantId?: string, roleInTenant?: string): Promise<BootstrapResp> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('No Firebase user');
  const idToken = await user.getIdToken(true);

  const qs = new URLSearchParams();
  if (tenantId) { qs.set('tenantId', tenantId); qs.set('tenant_id', tenantId); }
  if (roleInTenant) { qs.set('role', roleInTenant); qs.set('role_in_tenant', roleInTenant); }

  const url = qs.toString() ? `${LOGIN_BOOTSTRAP_URL}?${qs}` : LOGIN_BOOTSTRAP_URL;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  const raw = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(raw); } catch { }
  if (!res.ok) throw new Error(parsed?.error || `loginBootstrap failed: ${res.status}`);

  const data = parsed as BootstrapResp;

  // נעדכן role אחרון והקשר רענון
  currentRoleInTenant = (data?.role_in_tenant as any) ?? roleInTenant ?? null;
  _lastBootstrap = { tenantId: data?.farm?.id ?? tenantId, roleInTenant: currentRoleInTenant };

  // קביעת קונטקסט אם ביקשנו טננט (או אם אין עדיין)
  if (tenantId || !currentTenant) {
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

    refreshTimer = setTimeout(async () => {
      try {
        const tId = _lastBootstrap.tenantId ?? currentTenant?.id ?? localStorage.getItem('selectedTenant') ?? undefined;
        const rIn = _lastBootstrap.roleInTenant ?? currentRoleInTenant ?? undefined;
        await bootstrapSupabaseSession(tId, rIn);
      } catch (e) {
        console.warn('token refresh failed', e);
      }
    }, delay);
  } catch { /* ignore */ }
}

/** ===================== MEMBERSHIPS (multi-tenant) ===================== **/
let membershipsCache: Membership[] = [];
export function clearMembershipCache() { membershipsCache = []; }

export async function listMembershipsForCurrentUser(force = false): Promise<Membership[]> {
  const fb = getAuth().currentUser;
  if (!fb) throw new Error('No Firebase user');
  if (!force && membershipsCache.length) return membershipsCache;

  // מביאים רק מזהים ותפקיד
  const { data, error } = await dbPublic()
    .from('tenant_users')
    .select('tenant_id, role_in_tenant')
    .eq('uid', fb.uid)
    .eq('is_active', true);

  if (error) throw error;

  // הקלדנו את המערך כדי למנוע any/unknown
  type RowTU = { tenant_id: string; role_in_tenant: RoleInTenant | null };
  const rows: RowTU[] = (data ?? []) as RowTU[];

  // במקום metas[i] – נבנה מפה לפי tenant_id (בטוח יותר מהסתמכות על אינדקס)
  const metaById = new Map<string, FarmMeta | null>();
  await Promise.all(
    rows.map(async (r) => {
      const meta = await getFarmMetaById(r.tenant_id);
      metaById.set(r.tenant_id, meta);
    })
  );

  membershipsCache = rows.map((r) => ({
    tenant_id: r.tenant_id,
    role_in_tenant: (r.role_in_tenant as RoleInTenant) ?? 'parent',
    farm: metaById.get(r.tenant_id) ?? null,
  }));

  return membershipsCache;
}



export function getSelectedMembershipSync(): Membership | null {
  if (!currentTenant) return null;
  const found = (membershipsCache ?? []).find(m => m.tenant_id === currentTenant!.id);
  return found ?? (currentFarmMeta ? { tenant_id: currentTenant.id, role_in_tenant: 'parent' as RoleInTenant, farm: currentFarmMeta } : null);
}

export async function selectMembership(tenantId: string, roleInTenant?: string): Promise<Membership> {
  const list = await listMembershipsForCurrentUser(true);
  const chosen = list.find(m => m.tenant_id === tenantId) ?? list[0];
  if (!chosen) throw new Error('No memberships');

  // בקשה לשרת עם tenant + role
  let boot = await bootstrapSupabaseSession(tenantId, roleInTenant);

  // אם חזר טננט אחר ממה שביקשנו — ננסה פעם נוספת באופן מפורש
  if (boot?.farm?.id !== tenantId) {
    console.warn('server returned different tenant; retrying once...', { asked: tenantId, got: boot?.farm?.id });
    boot = await bootstrapSupabaseSession(tenantId, roleInTenant);
  }

  // נרמל לפי התשובה האחרונה מהשרת (היא הקובעת)
  const normalized: Membership = {
    tenant_id: boot.farm.id,
    role_in_tenant: (boot.role_in_tenant as RoleInTenant) ?? chosen.role_in_tenant,
    farm: boot.farm,
  };

  // ניקה caches כדי שלא יישארו נתונים מהחווה הקודמת
  clearDbCache();
  userCache = null as any;   // <-- אם המשתנה בקובץ הוא local, אל תשכחי לעדכן את שמו

  clearMembershipCache();


  currentFarmMeta = boot.farm;
  membershipsCache = list.map(m =>
    (m.tenant_id === chosen.tenant_id || m.tenant_id === boot.farm.id) ? normalized : m
  );

  _lastBootstrap = { tenantId: normalized.tenant_id, roleInTenant: normalized.role_in_tenant };
  currentRoleInTenant = normalized.role_in_tenant;


  localStorage.setItem('selectedTenant', normalized.tenant_id);
  return normalized;
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
  select = 'id:child_uuid, full_name, gov_id, birth_date, parent_id:parent_uid, status'
): Promise<ChildRow[]> {
  await ensureTenantContextReady();
  const dbc = db();               // לקוח סכימת הטננט
  const { data, error } = await dbc
    .from('children')
    .select(select)               // <- כאן ה-alias-ים
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ChildRow[];
}


export async function fetchMyChildren(
  select = 'id:child_uuid, full_name, gov_id, birth_date, parent_id:parent_uid, status'
): Promise<{ ok: boolean; data: ChildRow[]; error?: string }> {
  try {
    const data = await getMyChildren(select);
    return { ok: true, data };
  } catch (e: any) {
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

export async function ensureTenantContextReady(): Promise<void> {
  if (currentTenant?.schema) return;

  const stored = localStorage.getItem('selectedTenant');
  if (stored) {
    await bootstrapSupabaseSession(stored, currentRoleInTenant ?? undefined);
    return;
  }

  const list = await listMembershipsForCurrentUser(true);
  if (!list.length) throw new Error('No memberships for current user');
  await selectMembership(list[0].tenant_id, list[0].role_in_tenant);
}

export type RequiredAgreementRow = {
  agreement_id: string;
  agreement_code: string;
  title: string;
  scope: 'per_child' | 'per_parent';
  version_id: string;
  body_md?: string | null;
  storage_path?: string | null;
  accepted: boolean;
};

export async function rpcGetRequiredAgreements(childId: string, parentUid: string, activityTag?: string | null) {
  const tenant = requireTenant();
  const { data, error } = await getSupabaseClient().rpc('get_required_agreements', {
    tenant_schema: tenant.schema,
    child: childId,
    parent: parentUid,
    activity_tag: activityTag ?? null
  });
  if (error) throw error;
  return (data ?? []) as RequiredAgreementRow[];
}

export async function insertAgreementAcceptance(opts: {
  versionId: string; parentUid: string; childId?: string | null;
  fullNameSnapshot?: string | null; roleSnapshot?: string | null;
  ip?: string | null; userAgent?: string | null; signaturePath?: string | null;
}) {
  const dbc = db();
  const { data, error } = await dbc.from('user_agreement_acceptances').insert({
    agreement_version_id: opts.versionId,
    parent_user_id: opts.parentUid,
    child_id: opts.childId ?? null,
    full_name_snapshot: opts.fullNameSnapshot ?? null,
    role_snapshot: opts.roleSnapshot ?? 'parent',
    ip: opts.ip ?? null,
    user_agent: opts.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    signature_path: opts.signaturePath ?? null
  }).select().single();
  if (error) throw error;
  return data;
}
// === Parents listing (per-tenant) ===
export type ParentRow = {
  id: string;
  uid: string | null;
  full_name: string | null;
  phone?: string | null;
  email?: string | null;
  address?: any;
  is_active?: boolean | null;
  created_at?: string | null;
};
export type ListParentsOpts = {
  select?: string;
  search?: string | null;
  limit?: number;
  offset?: number;
  orderBy?: 'full_name' | 'created_at';
  ascending?: boolean;
};

/** מחזיר את כל ההורים בחווה (כלומר בסכימת ה-tenant הנוכחי) */
export async function listParents(opts: ListParentsOpts = {}): Promise<{ rows: ParentRow[]; count?: number | null }> {
  const tenant = requireTenant();    

  const dbc = db(tenant.schema);

  const select = opts.select ?? 'uid, full_name,extra_notes, address, phone, email';
  let q = dbc.from('parents').select(select, { count: 'exact' });

  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`;
    q = q.or(`full_name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
  }

  const orderBy = opts.orderBy ?? 'full_name';
  const ascending = opts.ascending ?? true;
  q = q.order(orderBy, { ascending });

  const limit = Math.max(1, opts.limit ?? 50);
  const offset = Math.max(0, opts.offset ?? 0);
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  
  if (error) throw error;


  return { rows: (data ?? []) as unknown as ParentRow[], count: count ?? null };
}


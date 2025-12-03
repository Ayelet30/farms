// services/supabase-tenant.service.ts
import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';
import { runtime } from './runtime';

export type FarmMeta = { id: string; name: string; schema_name: string; logo_url?: string | null };
export type TenantContext = { id: string; schema: string; accessToken?: string };
export type RoleInTenant = 'parent' | 'instructor' | 'secretary' | 'manager' | 'admin' | 'coordinator';
export type Membership = { tenant_id: string; role_in_tenant: RoleInTenant; farm: FarmMeta | null };

type BootstrapResp = { access_token: string; farm: FarmMeta; role_in_tenant: RoleInTenant };

const SUPABASE_URL = runtime('SUPABASE_URL');
const SUPABASE_ANON_KEY = runtime('SUPABASE_ANON_KEY');
const LOGIN_BOOTSTRAP_URL = runtime('LOGIN_BOOTSTRAP_URL') ?? '/api/loginBootstrap';

type TenantListener = (ctx: TenantContext | null) => void;

@Injectable({ providedIn: 'root' })
export class SupabaseTenantService {
  private supabase: SupabaseClient | null = null;
  private authBearer: string | null = null;
  private currentTenant: TenantContext | null = null;
  private currentFarmMeta: FarmMeta | null = null;
  private currentRoleInTenant: RoleInTenant | null = null;
  private refreshTimer: any = null;

  private baseClientRef: SupabaseClient | null = null;
  private schemaClients: Record<string, any> = {};

  private tenantListeners = new Set<TenantListener>();
  private ctxLock: Promise<void> | null = null;

  private membershipsCache: Membership[] = [];
  private userCache: { key: string; data: any; expires: number } | null = null;

  // ---------- public API (זה מה שנקרא מתוך legacy-compat) ----------

  getSupabaseClient(): SupabaseClient {
    if (!this.supabase) this.supabase = this.makeClient();
    return this.supabase;
  }

  requireTenant(): TenantContext {
    if (!this.currentTenant?.schema) throw new Error('Tenant context is not set. Call setTenantContext() first.');
    return this.currentTenant;
  }

  db(schema?: string) {
    const base = this.getSupabaseClient();
    if (this.baseClientRef !== base) { this.baseClientRef = base; this.schemaClients = {}; }
    const effectiveSchema = schema ?? this.requireTenant().schema;
    if (!this.schemaClients[effectiveSchema]) this.schemaClients[effectiveSchema] = base.schema(effectiveSchema);
    return this.schemaClients[effectiveSchema];
  }
  dbTenant = () => this.db();
  dbPublic = () => this.db('public');
  clearDbCache() { this.schemaClients = {}; }

  onTenantChange(cb: TenantListener): () => void {
    this.tenantListeners.add(cb);
    return () => this.tenantListeners.delete(cb);
  }

  async setTenantContext(ctx: TenantContext) {
    const run = async () => {
      this.currentTenant = { ...ctx };
      this.authBearer = ctx.accessToken ?? null;
      this.supabase = this.makeClient();
      this.clearDbCache();
      clearTimeout(this.refreshTimer);
      if (this.authBearer) this.scheduleTokenRefresh(this.authBearer);
      this.notifyTenantChange();
    };
    this.ctxLock = (this.ctxLock ?? Promise.resolve()).then(run);
    await this.ctxLock;
  }

  async clearTenantContext() {
    this.currentTenant = null;
    this.authBearer = null;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.supabase = this.makeClient();
    this.clearDbCache();
    try { await this.supabase.auth.signOut(); } catch {}
    this.notifyTenantChange();
  }

  async logout(): Promise<void> {
    await this.clearTenantContext();
    await signOut(getAuth());
  }

  // ---------- bootstrap / refresh ----------

  async bootstrapSupabaseSession(tenantId?: string, roleInTenant?: RoleInTenant): Promise<BootstrapResp> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('No Firebase user');
    const idToken = await user.getIdToken(true);

    const qs = new URLSearchParams();
    if (tenantId) { qs.set('tenantId', tenantId); qs.set('tenant_id', tenantId); }
    if (roleInTenant) { qs.set('role', roleInTenant); qs.set('role_in_tenant', roleInTenant); }

    const url = qs.toString() ? `${LOGIN_BOOTSTRAP_URL}?${qs}` : LOGIN_BOOTSTRAP_URL;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    const raw = await res.text();
    let parsed: any = null; try { parsed = JSON.parse(raw); } catch {}
    if (!res.ok) throw new Error(parsed?.error || `loginBootstrap failed: ${res.status}`);

    const data = parsed as BootstrapResp;
    this.currentRoleInTenant = (data?.role_in_tenant as RoleInTenant) ?? roleInTenant ?? null;

    if (tenantId || !this.currentTenant) {
      await this.setTenantContext({ id: data.farm.id, schema: data.farm.schema_name, accessToken: data.access_token });
      this.currentFarmMeta = data.farm;
    }
    // טיפה ניקוי קאש כדי למנוע ערבוב
    this.userCache = null;
    this.membershipsCache = [];
    localStorage.setItem('selectedTenant', data.farm.id);
    return data;
  }

  async ensureTenantContextReady(): Promise<void> {
    if (this.currentTenant?.schema) return;
    const stored = localStorage.getItem('selectedTenant');
    if (stored) { await this.bootstrapSupabaseSession(stored, this.currentRoleInTenant ?? undefined as any); return; }
    const list = await this.listMembershipsForCurrentUser(true);
    if (!list.length) throw new Error('No memberships for current user');
    await this.selectMembership(list[0].tenant_id, list[0].role_in_tenant);
  }

  // ---------- meta / farms ----------
  getCurrentFarmMetaSync(): FarmMeta | null { return this.currentFarmMeta; }

  async getCurrentFarmMeta(opts?: { refresh?: boolean }): Promise<FarmMeta | null> {
    const tenant = this.requireTenant();
    if (!this.currentFarmMeta || opts?.refresh) this.currentFarmMeta = await this.getFarmMetaById(tenant.id);
    return this.currentFarmMeta;
  }
  async getCurrentFarmName(opts?: { refresh?: boolean }): Promise<string | null> {
    const meta = await this.getCurrentFarmMeta(opts); return meta?.name ?? null;
  }

  async getFarmMetaById(farmId: string): Promise<FarmMeta | null> {
    const { data } = await this.getSupabaseClient()
      .from('farms')
      .select('id, name, schema_name, logo_url')
      .eq('id', farmId)
      .maybeSingle();
    return (data as FarmMeta) ?? null;
  }

  async getCurrentFarmLogoUrl(): Promise<string | null> {
    const ctx = this.requireTenant();
    const { data, error } = await this.dbPublic()
      .from('farms')
      .select('logo_url')
      .eq('id', ctx.id)
      .maybeSingle();
    if (error) throw error;
    const url = (data?.logo_url || '').trim();
    return url || null;
  }
async getFarmLogoUrl(schemaName: string): Promise<string | null> {
  const { data, error } = await this.dbPublic()
    .from('farms')
    .select('logo_url')
    .eq('schema_name', schemaName)
    .maybeSingle();

  if (error) throw error;

  const url = (data?.logo_url || '').trim();
  return url || null;
}

  // ---------- memberships ----------
  clearMembershipCache() { this.membershipsCache = []; }

  async listMembershipsForCurrentUser(force = false): Promise<Membership[]> {
    const fb = getAuth().currentUser;
    if (!fb) throw new Error('No Firebase user');
    if (!force && this.membershipsCache.length) return this.membershipsCache;

    const { data, error } = await this.dbPublic()
      .from('tenant_users')
      .select('tenant_id, role_in_tenant')
      .eq('uid', fb.uid)
      .eq('is_active', true);

    if (error) throw error;
    type RowTU = { tenant_id: string; role_in_tenant: RoleInTenant | null };
    const rows: RowTU[] = (data ?? []) as RowTU[];

    const metaById = new Map<string, FarmMeta | null>();
    await Promise.all(rows.map(async (r) => {
      const meta = await this.getFarmMetaById(r.tenant_id);
      metaById.set(r.tenant_id, meta);
    }));

    this.membershipsCache = rows.map((r) => ({
      tenant_id: r.tenant_id,
      role_in_tenant: (r.role_in_tenant as RoleInTenant) ?? 'parent',
      farm: metaById.get(r.tenant_id) ?? null,
    }));
    return this.membershipsCache;
  }

  getSelectedMembershipSync(): Membership | null {
    if (!this.currentTenant) return null;
    const found = (this.membershipsCache ?? []).find(m => m.tenant_id === this.currentTenant!.id);
    return found ?? (this.currentFarmMeta ? { tenant_id: this.currentTenant.id, role_in_tenant: 'parent', farm: this.currentFarmMeta } : null);
  }

  async selectMembership(tenantId: string, roleInTenant?: RoleInTenant): Promise<Membership> {
    const list = await this.listMembershipsForCurrentUser(true);
    const chosen = list.find(m => m.tenant_id === tenantId) ?? list[0];
    if (!chosen) throw new Error('No memberships');

    let boot = await this.bootstrapSupabaseSession(tenantId, roleInTenant ?? chosen.role_in_tenant);
    if (boot?.farm?.id !== tenantId) boot = await this.bootstrapSupabaseSession(tenantId, roleInTenant ?? chosen.role_in_tenant);

    const normalized: Membership = {
      tenant_id: boot.farm.id,
      role_in_tenant: (boot.role_in_tenant as RoleInTenant) ?? chosen.role_in_tenant,
      farm: boot.farm,
    };

    this.clearDbCache();
    this.userCache = null;
    this.clearMembershipCache();

    this.currentFarmMeta = boot.farm;
    this.membershipsCache = list.map(m => (m.tenant_id === chosen.tenant_id || m.tenant_id === boot.farm.id) ? normalized : m);
    localStorage.setItem('selectedTenant', normalized.tenant_id);
    return normalized;
  }

  // ---------- user details (כולל בחירה דטרמיניסטית) ----------
  async getCurrentUserData(): Promise<any> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) return null;
    const { data } = await this.getSupabaseClient().from('users').select('*').eq('uid', currentUser.uid).maybeSingle();
    return data ?? null;
  }

  private async resolveRoleAndFarm(uid: string, opts: { tenantId?: string | null, roleInTenant?: string | null } = {}) {
    let ctxTenantId: string | null = null;
    try { ctxTenantId = this.requireTenant().id; } catch {}

    const wantedTenantId = opts.tenantId ?? ctxTenantId ?? null;
    const wantedRole = opts.roleInTenant ?? null;

    let q = this.dbPublic()
      .from('tenant_users')
      .select('tenant_id, role_id, role_in_tenant, is_active')
      .eq('uid', uid).eq('is_active', true);

    if (wantedTenantId) q = q.eq('tenant_id', wantedTenantId);
    if (wantedRole) q = q.eq('role_in_tenant', wantedRole as any);

    let tu: any | null = null;
    const firstTry = await q.maybeSingle();
    if (!firstTry.error) { tu = firstTry.data ?? null; }
    else {
      const { data: list } = await q.limit(1);
      tu = (list && list[0]) || null;
    }

    const farmId = tu?.tenant_id ?? wantedTenantId ?? null;
    const roleId = tu?.role_id ?? null;
    const role_in_tenant = (tu?.role_in_tenant as string | null) ?? wantedRole ?? null;
    let roleStr: string | null = role_in_tenant;
    let targetTable: string | null = null;

    if (roleId != null) {
      const { data: rr } = await this.db()
        .from('role')
        .select('id, description, table')
        .eq('id', roleId)
        .maybeSingle();
      if (rr?.table) { targetTable = rr.table as string; roleStr = (rr.description as string) ?? roleStr; }
    }
    if (!targetTable && roleStr) {
      const { data: rr2 } = await this.db()
        .from('role')
        .select('table')
        .eq('description', roleStr)
        .maybeSingle();
      if (rr2?.table) targetTable = rr2.table as string;
    }

    let farmName: string | null = null;
    if (farmId != null) {
      const { data: farm } = await this.dbPublic()
        .from('farms')
        .select('name')
        .eq('id', farmId)
        .maybeSingle();
      farmName = (farm?.name as string) ?? null;
    }

    if (!targetTable) {
      const { data: roles } = await this.db().from('role').select('table');
      for (const r of roles ?? []) {
        const tbl = r.table as string;
        if (!tbl) continue;
        const { data } = await this.db().from(tbl).select('uid').eq('uid', uid).limit(1);
        if (data && data.length) { targetTable = tbl; break; }
      }
    }

    return { targetTable, role: roleStr ?? null, role_in_tenant, roleId, farmId, farmName };
  }

  async getCurrentUserDetails( select = 'uid, first_name, last_name, id_number',options?: { cacheMs?: number }): Promise<any | null>
 {
    const tenant = this.requireTenant();
    const fbUser = getAuth().currentUser;
    if (!fbUser) throw new Error('No Firebase user is logged in.');

    const ttl = options?.cacheMs ?? 60_000;
    const cacheKey = `${tenant.schema}|${fbUser.uid}|${select}`;
    if (this.userCache && this.userCache.key === cacheKey && this.userCache.expires > Date.now()) return this.userCache.data;

    const { targetTable, role, role_in_tenant, roleId, farmId, farmName } =
      await this.resolveRoleAndFarm(fbUser.uid, { tenantId: tenant.id });

    if (!targetTable) return null;

    const { data: rows, error } = await this.db().from(targetTable).select('*').eq('uid', fbUser.uid);
    if (error) throw error;
    const list = (rows ?? []) as any[];
    if (!list.length) return null;

    const pickBest = (arr: any[]) => {
      if (arr.length === 1) return arr[0];
      let filtered = arr;
      if (arr.some(r => 'is_active' in r)) {
        const actives = arr.filter(r => r.is_active === true);
        if (actives.length) filtered = actives;
      }
      if (filtered.some(r => 'updated_at' in r && r.updated_at)) {
        filtered = [...filtered].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
        return filtered[0];
      }
      if (filtered.some(r => 'created_at' in r && r.created_at)) {
        filtered = [...filtered].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        return filtered[0];
      }
      if (filtered.some(r => 'id' in r)) {
        filtered = [...filtered].sort((a, b) => {
          const ax = typeof a.id === 'number' ? a.id : parseInt(a.id, 10) || 0;
          const bx = typeof b.id === 'number' ? b.id : parseInt(b.id, 10) || 0;
          return bx - ax;
        });
        return filtered[0];
      }
      return filtered[0];
    };

    const rec: any = pickBest(list);
    const address = rec.address ?? rec.adress ?? null;
    const result = {
      uid: rec.uid ?? fbUser.uid,
      first_name: rec.first_name ?? null,
     last_name:  rec.last_name  ?? null,
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
    this.userCache = { key: cacheKey, data: result, expires: Date.now() + ttl };
    return result;
  }

  // ---------- parents / children ----------
 async getCurrentParentDetails(select = 'uid, first_name, last_name, id_number, address, phone, email'): Promise<any | null> {
    const tenant = this.requireTenant();
    const fbUser = getAuth().currentUser;
    if (!fbUser) throw new Error('No Firebase user is logged in.');

    const dbc = this.db(tenant.schema);
    const { data: byUid, error: errUid } = await dbc.from('parents').select(select).eq('uid', fbUser.uid).maybeSingle();
    if (!errUid && byUid) return byUid as any;

    const appUser = await this.getCurrentUserData();
    if (appUser?.parent_id) {
      const { data: byId } = await dbc.from('parents').select(select).eq('id', appUser.parent_id as string).maybeSingle();
      return (byId as any) ?? null;
    }
    return null;
  }

  async getMyChildren(
  select = 'id:child_uuid, first_name, last_name, gov_id, birth_date, parent_id:parent_uid, status'
) {
  await this.ensureTenantContextReady();
  const { data, error } = await this.db()
    .from('children')
    .select(select)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}


  // ---------- agreements ----------
  async rpcGetRequiredAgreements(childId: string, parentUid: string, activityTag?: string | null) {
    const tenant = this.requireTenant();
    const { data, error } = await this.getSupabaseClient().rpc('get_required_agreements', {
      tenant_schema: tenant.schema, child: childId, parent: parentUid, activity_tag: activityTag ?? null
    });
    if (error) throw error;
    return (data ?? []) as any[];
  }

async insertAgreementAcceptance(opts: {
  versionId: string;
  parentUid: string;
  childId?: string | null;
  firstNameSnapshot?: string | null;
  lastNameSnapshot?: string | null;
  roleSnapshot?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  signaturePath?: string | null;
}) {
  
  const splitFull = (full?: string | null) => {
    const s = (full ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return { first: '', last: '' };
    const parts = s.split(' ');
    return parts.length === 1
      ? { first: parts[0], last: '' }
      : { first: parts[0], last: parts.slice(1).join(' ') };
  };
 const firstSnap = opts.firstNameSnapshot ?? null;
const lastSnap  = opts.lastNameSnapshot  ?? null;
 
  const { data, error } = await this.db().from('user_agreement_acceptances').insert({
    agreement_version_id: opts.versionId,
    parent_user_id: opts.parentUid,
    child_id: opts.childId ?? null,

    // שמות העמודות בטבלה:
    first_name_snapshot: firstSnap,
    last_name_snapshot:  lastSnap,

    role_snapshot: opts.roleSnapshot ?? 'parent',
    ip: opts.ip ?? null,
    user_agent: opts.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    signature_path: opts.signaturePath ?? null,
  }).select().single();

  if (error) throw error;
  return data;
}


  // ---------- messaging ----------
  async listInbox(options?: { status?: ('open'|'pending'|'closed')[]; search?: string | null; limit?: number; offset?: number; }) {
    let q = this.db().from('conversations')
      .select('id, subject, status, updated_at, created_at, opened_by_parent_uid, tags')
      .order('updated_at', { ascending: false });

    if (options?.status?.length) q = q.in('status', options.status as any);
    if (options?.search?.trim()) {
      const s = `%${options.search.trim()}%`;
      q = q.or(`subject.ilike.${s}`);
    }
    const { data, error } = await q.range(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 20) - 1);
    if (error) throw error;
    return (data ?? []) as any[];
  }

  async getThread(conversationId: string) {
    const [{ data: conv }, { data: msgs, error: e2 }] = await Promise.all([
      this.db().from('conversations').select('*').eq('id', conversationId).maybeSingle(),
      this.db().from('conversation_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true })
    ]);
    if (e2) throw e2;
    return { conv: (conv as any) ?? null, msgs: (msgs ?? []) as any[] };
    }

  async replyToThread(conversationId: string, body_md: string) {
    const me = await this.getCurrentUserDetails('uid, role_in_tenant', { cacheMs: 0 });
    const senderRole = (me?.role_in_tenant as any) ?? 'secretary';
    const { data, error } = await this.db().from('conversation_messages').insert({
      conversation_id: conversationId,
      body_md,
      sender_role: senderRole,
      sender_uid: getAuth().currentUser?.uid ?? 'unknown',
      has_attachment: false
    }).select().single();
    if (error) throw error;
    await this.db().from('conversations').update({ status: 'pending' }).eq('id', conversationId);
    return data as any;
  }

  async sendBroadcast(payload: {
    subject?: string | null;
    body_md: string;
    channels: { inapp: boolean; email?: boolean; sms?: boolean };
    audience: { type: 'all' | 'manual' | 'single'; parentUids?: string[]; singleUid?: string | null };
    scheduled_at?: string | null;
  }) {
    const { data: msg, error: e1 } = await this.db().from('messages').insert({
      subject: payload.subject ?? null,
      body_md: payload.body_md,
      channel_inapp: !!payload.channels.inapp,
      channel_email: !!payload.channels.email,
      channel_sms: !!payload.channels.sms,
      audience_type: payload.audience.type,
      audience_ref: payload.audience ?? null,
      scheduled_at: payload.scheduled_at ?? null,
      status: payload.scheduled_at ? 'scheduled' : 'sent'
    }).select().single();
    if (e1) throw e1;

    let parentUids: string[] = [];
    if (payload.audience.type === 'all') {
      const { data: parents } = await this.db().from('parents').select('uid').eq('is_active', true);
      parentUids = (parents ?? []).map((p: any) => p.uid).filter(Boolean);
    } else if (payload.audience.type === 'manual') {
      parentUids = payload.audience.parentUids ?? [];
    } else if (payload.audience.type === 'single' && payload.audience.singleUid) {
      parentUids = [payload.audience.singleUid];
    }
    parentUids = Array.from(new Set(parentUids));
    if (parentUids.length) {
      const rows = parentUids.map(uid => ({
        message_id: (msg as any).id,
        recipient_parent_uid: uid,
        delivery_status: payload.scheduled_at ? 'pending' : 'sent'
      }));
      const { error: e2 } = await this.db().from('message_recipients').insert(rows);
      if (e2) throw e2;
    }
    return { message: msg as any, recipients: parentUids.length };
  }

  // ---------- private helpers ----------

  private makeClient(): SupabaseClient {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase runtime config');
    const storageKey = `sb-${this.currentTenant?.id ?? 'neutral'}-auth`;
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
          ...(this.authBearer ? { Authorization: `Bearer ${this.authBearer}` } : {}),
        },
      },
    });
  }

  private notifyTenantChange() {
    for (const cb of this.tenantListeners) { try { cb(this.currentTenant); } catch {} }
  }

  private scheduleTokenRefresh(jwt: string) {
    try {
      const body = jwt.split('.')[1] || '';
      const base64Decode = (b64: string) => {
        if (typeof atob === 'function') return atob(b64);
        if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf-8');
        throw new Error('No base64 decoder available');
      };
      const parsed = JSON.parse(base64Decode(body));
      const exp = Number(parsed?.exp);
      if (!exp || Number.isNaN(exp)) return;

      const msLeft = exp * 1000 - Date.now();
      const delay = Math.max(msLeft - 60_000, 10_000);
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(async () => {
        try {
          const tId = this.currentTenant?.id ?? localStorage.getItem('selectedTenant') ?? undefined;
          await this.bootstrapSupabaseSession(tId as any, this.currentRoleInTenant ?? undefined as any);
        } catch (e) {
          console.warn('token refresh failed', e);
        }
      }, delay);
    } catch (e) {
      console.debug('scheduleTokenRefresh skipped:', (e as any)?.message ?? e);
    }
  }
}

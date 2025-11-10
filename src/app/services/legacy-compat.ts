// services/legacy-compat.ts
// שמרי ייבוא קיים בקוד: import { db, dbTenant, getSupabaseClient, ... } from '.../legacy-compat'
import { inject } from '@angular/core';
import { SupabaseTenantService } from './supabase-tenant.service';

// סינגלטון מהיר גם מחוץ ל־DI (לקריאות ישירות)
let _svc: SupabaseTenantService | null = null;
function svc(): SupabaseTenantService {
  // אם זה מתבצע בתוך Angular—inject, אחרת נפעיל ידנית new (נדיר)
  try { _svc = _svc ?? inject(SupabaseTenantService); }
  catch { _svc = _svc ?? new SupabaseTenantService(); }
  return _svc!;
}

// ===== re-exports עם אותם שמות בדיוק =====
export const getSupabaseClient = () => svc().getSupabaseClient();
export const requireTenant = () => svc().requireTenant();
export const db = (schema?: string) => svc().db(schema);
export const dbTenant = () => svc().dbTenant();
export const dbPublic = () => svc().dbPublic();
export const clearDbCache = () => svc().clearDbCache();

export const onTenantChange = (cb: (ctx: any) => void) => svc().onTenantChange(cb);
export const setTenantContext = (ctx: any) => svc().setTenantContext(ctx);
export const clearTenantContext = () => svc().clearTenantContext();
export const logout = () => svc().logout();

export const getCurrentUserData = () => svc().getCurrentUserData();
export const getFarmMetaById = (farmId: string) => svc().getFarmMetaById(farmId);
export const getCurrentFarmMetaSync = () => svc().getCurrentFarmMetaSync();
export const getCurrentFarmMeta = (opts?: { refresh?: boolean }) => svc().getCurrentFarmMeta(opts);
export const getCurrentFarmName = (opts?: { refresh?: boolean }) => svc().getCurrentFarmName(opts);
export const getCurrentFarmLogoUrl = () => svc().getCurrentFarmLogoUrl();
export const getFarmLogoUrl = (idOrSchema: string) => svc().getFarmLogoUrl(idOrSchema);

export const getCurrentUserDetails = (select?: string, options?: { cacheMs?: number }) =>
  svc().getCurrentUserDetails(select, options);

export const getCurrentParentDetails = (select?: string) => svc().getCurrentParentDetails(select);
export const getMyChildren = (select?: string) => svc().getMyChildren(select);

export const ensureTenantContextReady = () => svc().ensureTenantContextReady();

export const rpcGetRequiredAgreements = (childId: string, parentUid: string, activityTag?: string | null) =>
  svc().rpcGetRequiredAgreements(childId, parentUid, activityTag);

export const insertAgreementAcceptance = (opts: any) => svc().insertAgreementAcceptance(opts);

// messaging
export const listInbox = (options?: any) => svc().listInbox(options);
export const getThread = (conversationId: string) => svc().getThread(conversationId);
export const replyToThread = (conversationId: string, body_md: string) => svc().replyToThread(conversationId, body_md);
export const sendBroadcast = (payload: any) => svc().sendBroadcast(payload);

// bootstrap
export const bootstrapSupabaseSession = (tenantId?: string, roleInTenant?: string) =>
  svc().bootstrapSupabaseSession(tenantId, roleInTenant as any);

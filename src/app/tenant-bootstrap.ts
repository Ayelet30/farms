// app/tenant-bootstrap.ts
import { inject } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SupabaseTenantService } from '../app/services/supabase-tenant.service';

function getRouteParamDeep(ar: ActivatedRoute, keys: string[]): string | null {
  let r: ActivatedRoute | null = ar;
  while (r) {
    for (const k of keys) {
      const v = r.snapshot.paramMap.get(k);
      if (v) return v;
    }
    r = r.firstChild!;
  }
  return null;
}

function guessSubdomain(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;        // e.g. bereshit.domain.com
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0];       // "bereshit"
  return null;
}

async function resolveAndApplyTenantFromKey(key: string): Promise<boolean> {
  const svc = inject(SupabaseTenantService);
  const farm = await svc.findFarmByKey(key);
  if (!farm) return false;

  // אם יש כבר role נבחר – נשמור/נשתמש; אחרת ה־backend יקבע
  await svc.setTenantContext({ id: farm.id, schema: farm.schema_name });
  await svc.selectMembership(farm.id);          // דואג ל־bootstrap + access_token
  return true;
}

export function tenantAppInitializer() {
  return async () => {
    const svc   = inject(SupabaseTenantService);
    const route = inject(ActivatedRoute);
    const router= inject(Router);

    // 1) נסיון לפי route param (farm | schema | tenant)
    const keyFromRoute =
      getRouteParamDeep(route, ['farm', 'schema', 'tenant', 'farmSlug']);

    // 2) או לפי סאב־דומיין
    const keyFromSubdomain = guessSubdomain();

    // 3) או selectedTenant מ־LS
    const keyFromStorage = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('selectedTenant') || null)
      : null;

    // סדר ניסיונות
    const candidates = [keyFromRoute, keyFromSubdomain, keyFromStorage].filter(Boolean) as string[];

    let ok = false;
    for (const key of candidates) {
      ok = await resolveAndApplyTenantFromKey(key);
      if (ok) break;
    }

    // 4) fallback אחרון: memberships → ראשונה
    if (!ok) {
      await svc.ensureTenantContextReady(); // כבר בוחר membership ראשון ומבצע bootstrap
    }

    // עדכון אוטומטי בניווטים (אם farm משתנה ב־URL)
    router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(async () => {
      const k = getRouteParamDeep(route, ['farm', 'schema', 'tenant', 'farmSlug']);
      if (!k) return;
      const ctx = (() => { try { return svc.requireTenant(); } catch { return null; } })();
      if (ctx && (ctx.id === k || ctx.schema === k)) return;  // כבר מסונכרן
      // נסה לטעון מחדש לפי המפתח
      try { await resolveAndApplyTenantFromKey(k); } catch (e) { console.warn('tenant switch failed', e); }
    });
  };
}

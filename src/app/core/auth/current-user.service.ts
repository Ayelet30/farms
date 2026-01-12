
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { onIdTokenChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { BehaviorSubject, firstValueFrom, filter, take } from 'rxjs';

import {
  clearTenantContext,
  getCurrentFarmMeta,
  getCurrentFarmMetaSync,
  getCurrentUserData,
  getCurrentUserDetails,
  listMembershipsForCurrentUser,
  selectMembership,
  type Membership,
} from '../../services/supabaseClient.service';

import type { CurrentUser, UserDetails } from '../../Types/detailes.model';
import { TokensService } from '../../services/tokens.service';

@Injectable({ providedIn: 'root' })
export class CurrentUserService {

  private auth = inject(Auth);
  private platformId = inject(PLATFORM_ID);

  private tokens = inject(TokensService);


  private readonly _user$ = new BehaviorSubject<CurrentUser | null>(null);
  readonly user$ = this._user$.asObservable();

  private readonly _userDetails = new BehaviorSubject<UserDetails | null>(null);
  readonly userDetails$ = this._userDetails.asObservable();

  private readonly _ready$ = new BehaviorSubject(false);

  setUserDetails(details: UserDetails | null): void { this._userDetails.next(details); }
  clearUserDetails(): void { this._userDetails.next(null); }
  get snapshot(): UserDetails | null { return this._userDetails.value; }

  async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    await setPersistence(this.auth, browserLocalPersistence);

    await new Promise<void>((resolve) => {
      const unsub = onIdTokenChanged(this.auth, async (fbUser) => {
        try {
          if (fbUser) {
            const row = await getCurrentUserData();
            const role = (row?.role ?? null) as string | null;
            this._user$.next({
              uid: fbUser.uid,
              phone: row?.phone ?? undefined,
              email: fbUser.email ?? undefined,
              displayName: fbUser.displayName ?? undefined,
              role,
              memberships: undefined,
              selectedTenantId: null,
            });
          } else {
            await clearTenantContext();
            this._user$.next(null);
            this.clearUserDetails();
          }
        } finally {
          this._ready$.next(true);
          unsub();
          resolve();
        }
      });
    });
  }

  async loadUserDetails(select = 'id_number, uid, first_name,last_name', cacheMs = 60_000) {
    await this.waitUntilReady();
    const details = await getCurrentUserDetails(select, { cacheMs });
    this.setUserDetails(details);
    return details;
  }

  setCurrent(patch: Partial<CurrentUser> & Pick<CurrentUser, 'uid'> | null) {
    if (!patch) { this._user$.next(null); return; }
    const prev = this._user$.value ?? { uid: patch.uid, role: null as string | null };
    this._user$.next({ ...prev, ...patch });
  }

  setMemberships(memberships: Membership[]) {
    const cur = this._user$.value; if (!cur) return;
    this._user$.next({ ...cur, memberships });
  }

  setSelectedTenant(tenantId: string | null) {
    console.log("setSelectedTenant", tenantId);
    const cur = this._user$.value; if (!cur) return;
    this._user$.next({ ...cur, selectedTenantId: tenantId });
    if (tenantId) localStorage.setItem('selectedTenant', tenantId);
    else localStorage.removeItem('selectedTenant');
  }


  get current(): CurrentUser | null { return this._user$.value; }

  waitUntilReady(): Promise<void> {
    return firstValueFrom(this._ready$.pipe(filter(Boolean), take(1))) as unknown as Promise<void>;
  }

  async logout() {
    await clearTenantContext();
    const { signOut } = await import('@angular/fire/auth');
    await signOut(this.auth);
    this._user$.next(null);
    this.clearUserDetails();
  }

  /**
   * Hydration אחרי Login: טוען memberships, בוחר טננט (אם יש אחד או אם נשמר ב-localStorage),
   * מקים הקשר טננט, טוען פרטי משתמש, ומעדכן current-user באופן אטומי.
   */
 async hydrateAfterLogin() {
  await this.waitUntilReady();
  const fbUser = this.auth.currentUser!;

  const baseMemberships = await listMembershipsForCurrentUser(true);

  const saved = localStorage.getItem('selectedTenant');
  const toPick =
    baseMemberships.find(m => m.tenant_id === saved)?.tenant_id ??
    (baseMemberships[0]?.tenant_id ?? null);

  let picked: Membership | null = null;
  if (toPick) {
    picked = await selectMembership(
      toPick,
      baseMemberships.find(m => m.tenant_id === toPick)?.role_in_tenant
    );
    this.setSelectedTenant(picked.tenant_id);
  }

  const memberships = await listMembershipsForCurrentUser(false);
  this.setMemberships(memberships);

  const details = picked
    ? await this.loadUserDetails(
        'uid,first_name,last_name, id_number, address, phone, email, id_number, first_name, last_name',
        0
      )
    : null;

  const farmMeta = await getCurrentFarmMeta({ refresh: true });

  this.setCurrent({
    uid: fbUser.uid,
    email: details?.email ?? fbUser.email ?? undefined,
    displayName:
      ((details?.first_name ?? '') + ' ' + (details?.last_name ?? '')).trim() ||
      fbUser.displayName ||
      undefined,
    farmName: picked?.farm?.name,           // ⬅️ שם חווה כבר מההתחלה
    id_number: details?.id_number ?? undefined,
    first_name: details?.first_name ?? undefined,
    last_name: details?.last_name ?? undefined,
    phone: details?.phone ?? undefined,
    role: (picked?.role_in_tenant ?? null) as any,
    memberships,
    selectedTenantId: picked?.tenant_id ?? null,
  });

  this.tokens.applytokens(picked?.farm?.schema_name || 'public');

  return { selected: picked, details };
}


 async switchMembership(tenantId: string, roleInTenant?: string) {
  await this.waitUntilReady();
  const fbUser = this.auth.currentUser!;

  const picked = await selectMembership(tenantId, roleInTenant);
  console.log("switched to membership", fbUser, picked);

  this.setSelectedTenant(picked.tenant_id);

  // רשימת חברות מעודכנת (כולל farm.name לכל טננט)
  const memberships = await listMembershipsForCurrentUser(false);
  this.setMemberships(memberships);

  // טען פרטים ללא cache
  const details = await this.loadUserDetails(
    'uid,first_name,last_name, id_number, address, phone, email',
    0
  );

  // נוודא שיש לנו FarmMeta מלא (עם name)
  const farmMeta = await getCurrentFarmMeta({ refresh: true });

  this.setCurrent({
    uid: fbUser.uid,
    role: picked.role_in_tenant as any,
    memberships,
    selectedTenantId: picked.tenant_id,
    // ⬅️ כאן הקסם – נשמור את שם החווה במשתמש
    farmName: farmMeta?.name,
  });

  this.tokens.applytokens(farmMeta?.schema_name || 'public');

  return { role: picked.role_in_tenant, details };
}

async getIdToken(forceRefresh = false): Promise<string> {
  await this.waitUntilReady();

  const fbUser = this.auth.currentUser;
  if (!fbUser) throw new Error('Not authenticated');

  return fbUser.getIdToken(forceRefresh);
}

}
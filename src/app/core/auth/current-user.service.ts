import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { onIdTokenChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { BehaviorSubject, firstValueFrom, filter, take } from 'rxjs';

import { setTenantContext, clearTenantContext, getCurrentUserData, getCurrentParentDetails } from '../../services/supabaseClient';
import { CurrentUser } from './current-user.model';
import { ParentDetails } from '../../Types/detailes.model';

type MintResponse = {
  accessToken: string;
  tenant: { id: string; schema: string } | null;
};

@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private auth = inject(Auth);
  private platformId = inject(PLATFORM_ID);

  // ✅ זה האובזרוובל היחיד שנשתמש בו
  private _user$ = new BehaviorSubject<CurrentUser | null>(null);
  readonly user$ = this._user$.asObservable();
  private _parentDetails$ = new BehaviorSubject<ParentDetails | null>(null);
  readonly parentDetails$ = this._parentDetails$.asObservable();
  get parentDetails() { return this._parentDetails$.value; }

  // מוכנות ל־guards
  private _ready$ = new BehaviorSubject(false);

  /** אתחול חד-פעמי באפליקציה (אופציונלי) */
  async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await setPersistence(this.auth, browserLocalPersistence);

    await new Promise<void>((resolve) => {
      const unsub = onIdTokenChanged(this.auth, async (fbUser) => {
        try {
          if (fbUser) {
            // שליפת role חד-פעמית (לפי המימוש שלך ב-supabaseClient)
            const row = await getCurrentUserData(); // אמור להחזיר { role, ... }
            const role = row?.role ?? null;

            // (אופציונלי) קיבוע קונטקסט טננט אם יש לך לוגיקה כזו
           // await setTenantContext({ id, schema, accessToken });

            this._user$.next({
              uid: fbUser.uid,
              email: fbUser.email ?? undefined,
              displayName: fbUser.displayName ?? undefined,
              role,
              tenant: null, // שימי כאן אם את מנהלת tenant
            });
          } else {
            await clearTenantContext();
            this._user$.next(null);
          }
        } finally {
          this._ready$.next(true);
          unsub();
          resolve();
        }
      });
    });
  }

  /** קורא ל־getCurrentParentDetails ושומר בזיכרון (עם cache ברירת מחדל) */
  async loadParentDetails(select = 'id_number, uid, full_name, phone, email', cacheMs = 60_000) {
    await this.waitUntilReady?.();
    const details = await getCurrentParentDetails(select, { cacheMs });
    this._parentDetails$.next(details);
    return details;
  }

  /** נקרא אחרי לוגאין ידני כדי לעדכן את ה־guard */
  setCurrent(user: { uid: string; role: string } | null) {
    this._user$.next(user); // ✅ היה _current$ → undefined
  }

  /** ערך סנאפשוט (נוח ל־guards) */
  get current(): CurrentUser | null {
    return this._user$.value;
  }

  /** ממתין לאתחול */
  waitUntilReady(): Promise<void> {
    return firstValueFrom(this._ready$.pipe(filter(Boolean), take(1))) as unknown as Promise<void>;
  }

  /** לוגאאוט נקי */
  async logout() {
    await clearTenantContext();
    const { signOut } = await import('@angular/fire/auth');
    await signOut(this.auth);
    this._user$.next(null);
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';

import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import {
  getCurrentFarmMetaSync,
  getCurrentFarmLogoUrl,
  getFarmLogoUrl,
  logout as sbLogout,
} from '../../services/legacy-compat';

import {
  listMembershipsForCurrentUser,
  getSelectedMembershipSync,
} from '../../services/supabaseClient.service';

import { CurrentUserService } from '../../core/auth/current-user.service';
import { TokensService } from '../../services/tokens.service';
import type { Membership } from '../../services/supabaseClient.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent implements OnInit {
  private router = inject(Router);
  private dialog = inject(MatDialog);
  public cu = inject(CurrentUserService);
  private tokens = inject(TokensService);

  // מצב תצוגה
  isLoggedIn = false;

  // פרטי משתמש מוצגים
  userName = '';
  userRole: string | undefined;
  userRoleKey = ''; // באנגלית (parent/instructor/…)
  farmName: string | undefined;
  farmNote = 'אתר לניהול חוות';

  // לוגו וראשי תיבות
  farmLogoUrl: string | null = null;
  farmInitials = '';

  // שיוכים ותפקיד נבחר
  memberships: Membership[] = [];
  selected?: Membership;

  // מיפוי תפקיד -> דף בית
  private readonly homeRoutes: Record<string, string> = {
    parent: '/parent/children',
    instructor: '/instructor',
    secretary: '/secretary',
    admin: '/admin',
    manager: '/ops',
    coordinator: '/ops',
  };

  // תרגום תפקידים
  readonly roleHe: Record<string, string> = {
    instructor: 'מדריך',
    parent: 'הורה',
    secretary: 'מזכירות',
    admin: 'מנהל מערכת',
    manager: 'מנהל',
    coordinator: 'רכזת',
  };

  async ngOnInit() {
    // וודאי שה־CurrentUserService מוכן
    await this.cu.waitUntilReady();

    // האזנות: כל שינוי ב־user$/userDetails$ יעדכן את ה־Header
    this.cu.user$.subscribe(() => this.rebindFromStores());
    this.cu.userDetails$.subscribe(() => this.rebindFromStores());

    // טעינת שיוכים ובחירה התחלתית (כולל משחזור localStorage במידת הצורך)
    await this.bootstrapMembershipsAndSelection();

    // לוגו לפי הטננט הנוכחי
    await this.loadLogo();
  }

  /** מאגד את הנתונים משני ה־stores ומעדכן את התצוגה */
  private rebindFromStores() {
    const cur = this.cu.current;            // מתוך CurrentUser
    const details = this.cu.snapshot;       // מתוך userDetails$

    this.isLoggedIn = !!cur;
    this.userRoleKey = (cur?.role || '').toLowerCase();
    this.userRole = this.roleHe[this.userRoleKey] || '';

    // שם מלא: קודם מה־details (DB), אחרת מ־Firebase
    this.userName = (details?.full_name || cur?.displayName || '') ?? '';
    this.farmName = (getCurrentFarmMetaSync()?.name || undefined);

    this.farmInitials = this.makeInitials(this.farmName || '');
  }

  /** טוען רשימת שיוכים ובוחר את הטננט הנוכחי/ראשון */
  private async bootstrapMembershipsAndSelection() {
    try {
      this.memberships = await listMembershipsForCurrentUser(true);

      // current לפי ה־service/LS, אחרת ראשון
      const selectedSync = getSelectedMembershipSync();
      const savedId = localStorage.getItem('selectedTenant');
      const fromLs = this.memberships.find(m => m.tenant_id === savedId) || null;

      this.selected =
        selectedSync ??
        fromLs ??
        this.memberships[0] ??
        undefined;

      // אם אין selected ב־LS – שמרי (אחרי hydrate יש ערך)
      if (this.selected?.tenant_id) {
        localStorage.setItem('selectedTenant', this.selected.tenant_id);
      }
    } catch {
      // השאר ריק — לא מפסיק את ה־Header
    }
  }

  private async loadLogo() {
    // נסי קודם הפונקציה ה"מהירה"
    try {
      const url = await getCurrentFarmLogoUrl();
      if (url) { this.farmLogoUrl = url; return; }
    } catch { /* נמשיך לפולבק */ }

    // פולבק לפי מטא־דאטה או לפי השיוך הנבחר
    const ctx = getCurrentFarmMetaSync();
    const currentTenantId = ctx?.id || this.selected?.tenant_id || null;
    const m = this.memberships.find(x => x.tenant_id === currentTenantId) || this.memberships[0];

    const key = m?.farm?.id || m?.tenant_id || m?.farm?.schema_name || null;
    if (key) {
      try {
        this.farmLogoUrl = await getFarmLogoUrl(key);
        return;
      } catch { /* ignore */ }
    }
    this.farmLogoUrl = null;
  }

  handleLoginLogout() {
    if (!this.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }

    const dialogRef = this.dialog.open(LogoutConfirmationComponent, {
      width: '320px',
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(async (confirm: boolean) => {
      if (!confirm) return;
      await this.cu.logout();
      await sbLogout?.(); // ליתר ביטחון (אם קיימת עוטפת)
      this.router.navigate(['/home']);
    });
  }

  routeByRole(role: string | null | undefined) {
    const r = (role || '').toLowerCase();
    return this.homeRoutes[r] || '/home';
  }

  goHome(): void {
    if (!this.isLoggedIn) { this.router.navigate(['/login']); return; }
    const target = this.routeByRole(this.userRoleKey);
    this.router.navigate([target]);
  }

  async onChooseMembership(m: Membership | null) {
    if (!m) return;

    // מעבר טננט — דרך ה־Service
    const resp = await this.cu.switchMembership(m.tenant_id, m.role_in_tenant);
    this.selected = m;

    // שמרי את הבחירה
    localStorage.setItem('selectedTenant', m.tenant_id);

    // עדכני טוקנים וסכמה
    const farm = getCurrentFarmMetaSync();
    this.tokens.applytokens(farm?.schema_name || 'public');

    // רענון נתוני תצוגה
    this.rebindFromStores();
    await this.loadLogo();

    // ניווט לפי תפקיד חדש
    const target = this.routeByRole(resp?.role || m.role_in_tenant);
    await this.router.navigateByUrl(target);
  }

  private makeInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).slice(0, 2);
    const init = parts.map(p => p[0]?.toUpperCase() || '').join('');
    return init || 'F';
  }
}


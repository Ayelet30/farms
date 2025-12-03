import { Component, OnInit, inject, HostListener } from '@angular/core';
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

  isLoggedIn = false;
  userName = '';
  userRole: string | undefined;
  userRoleKey = '';
  farmName: string | undefined;
  farmNote = 'אתר לניהול חוות';
  farmLogoUrl: string | null = null;
  farmInitials = '';
  memberships: Membership[] = [];
  selected?: Membership;

  private readonly homeRoutes: Record<string, string> = {
    parent: '/parent',
    instructor: '/instructor',
    secretary: '/secretary',
    admin: '/admin',
    manager: '/ops',
    coordinator: '/ops',
  };

  readonly roleHe: Record<string, string> = {
    instructor: 'מדריך',
    parent: 'הורה',
    secretary: 'מזכירות',
    admin: 'מנהל מערכת',
    manager: 'מנהל',
    coordinator: 'רכזת',
  };


  isRoleMenuOpen = false;

  // סגירת התפריט בכל קליק מחוץ לחץ
  @HostListener('document:click')
  onDocumentClick() {
    this.isRoleMenuOpen = false;
  }

  toggleRoleMenu(event: MouseEvent) {
    event.stopPropagation(); // שלא יסגור מיד מה־HostListener
    if (this.memberships.length <= 1) return;
    this.isRoleMenuOpen = !this.isRoleMenuOpen;
  }

  async onChooseMembership(m: Membership | null) {
    if (!m) return;

    const resp = await this.cu.switchMembership(m.tenant_id, m.role_in_tenant);
    this.selected = m;
    localStorage.setItem('selectedTenant', m.tenant_id);

    const farm = getCurrentFarmMetaSync();
    this.tokens.applytokens(farm?.schema_name || 'public');

    this.rebindFromStores();
    await this.loadLogo();

    const target = this.routeByRole(resp?.role || m.role_in_tenant);
    await this.router.navigateByUrl(target);

    // לסגור את הדרופדאון אחרי בחירה
    this.isRoleMenuOpen = false;
  }

  async ngOnInit() {
  await this.cu.waitUntilReady();

  this.cu.user$.subscribe((u) => {
    this.memberships = u?.memberships ?? [];
    this.selected =
      this.memberships.find(m => m.tenant_id === u?.selectedTenantId) ||
      this.memberships[0];

    this.rebindFromStores();
  });

  this.cu.userDetails$.subscribe(() => this.rebindFromStores());

  // אם ממש חייבים fallback – אז ורק אם אין memberships נמשוך מהשרת
  if (!this.memberships.length) {
    await this.bootstrapMembershipsAndSelection();
  }

  await this.loadLogo();
}


 private rebindFromStores() {
  const cur = this.cu.current;
  const details = this.cu.snapshot;

  this.isLoggedIn = !!cur;
  this.userRoleKey = (cur?.role || '').toLowerCase();
  this.userRole = this.roleHe[this.userRoleKey] || '';

  this.userName = (
    `${details?.first_name ?? ''} ${details?.last_name ?? ''}`.trim() ||
    cur?.displayName ||
    ''
  ) ?? '';

  // ===== FARM NAME RESOLUTION =====
  const selectedTenantId =
    cur?.selectedTenantId ||
    this.selected?.tenant_id ||
    localStorage.getItem('selectedTenant');

  const selectedMembership =
    this.memberships.find(m => m.tenant_id === selectedTenantId) ||
    this.memberships[0];

  this.farmName =
    getCurrentFarmMetaSync()?.name ||
    selectedMembership?.farm?.name ||
    undefined;

  this.farmInitials = this.makeInitials(this.farmName || '');
}


  private async bootstrapMembershipsAndSelection() {
    try {
      this.memberships = await listMembershipsForCurrentUser(false);
      const selectedSync = getSelectedMembershipSync();
      const savedId = localStorage.getItem('selectedTenant');
      const fromLs = this.memberships.find(m => m.tenant_id === savedId) || null;
      this.selected = selectedSync ?? fromLs ?? this.memberships[0] ?? undefined;
      if (this.selected?.tenant_id) {
        localStorage.setItem('selectedTenant', this.selected.tenant_id);
      }
    } catch {}
  }
  


private async loadLogo() {
  const ctx = getCurrentFarmMetaSync();
  const key = ctx?.schema_name;

  if (!key) {
    this.farmLogoUrl = null;
    return;
  }

  try {
    this.farmLogoUrl = await getFarmLogoUrl(key);
  } catch {
    this.farmLogoUrl = null;
  }
}

  handleLoginLogout() {
    if (!this.isLoggedIn) { this.router.navigate(['/login']); return; }
    const dialogRef = this.dialog.open(LogoutConfirmationComponent, { width: '320px', disableClose: true });
    dialogRef.afterClosed().subscribe(async (confirm: boolean) => {
      if (!confirm) return;
      await this.cu.logout();
      await sbLogout?.();
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

    private makeInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).slice(0, 2);
    const init = parts.map(p => p[0]?.toUpperCase() || '').join('');
    return init || 'F';
  }

formatMembershipRole(m: Membership): string {
  const key = (m.role_in_tenant || '').toLowerCase();
  return this.roleHe[key] || m.role_in_tenant || '';
}

formatMembershipFarm(m: Membership): string {
  return m.farm?.name || 'חווה ללא שם';
}

formatMembershipLabel(m: Membership | null | undefined): string {
  if (!m) return '';
  return `${this.formatMembershipRole(m)} · ${this.formatMembershipFarm(m)}`;
}


}


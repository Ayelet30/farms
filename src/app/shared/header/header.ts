import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import {
  listMembershipsForCurrentUser,
  getCurrentFarmMetaSync,
  getCurrentFarmLogoUrl,
  getFarmLogoUrl,
  getSelectedMembershipSync,
  logout as sbLogout,
} from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { TokensService } from '../../services/tokens.service';
import type { Membership } from '../../services/supabaseClient';

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
    parent: '/parent/children',
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

  async ngOnInit() {
    await this.cu.waitUntilReady();
    this.cu.user$.subscribe(() => this.rebindFromStores());
    this.cu.userDetails$.subscribe(() => this.rebindFromStores());
    await this.bootstrapMembershipsAndSelection();
    await this.loadLogo();
  }

  private rebindFromStores() {
    const cur = this.cu.current;
    const details = this.cu.snapshot;
    this.isLoggedIn = !!cur;
    this.userRoleKey = (cur?.role || '').toLowerCase();
    this.userRole = this.roleHe[this.userRoleKey] || '';
    this.userName = (details?.full_name || cur?.displayName || '') ?? '';
    this.farmName = (getCurrentFarmMetaSync()?.name || undefined);
    this.farmInitials = this.makeInitials(this.farmName || '');
  }

  private async bootstrapMembershipsAndSelection() {
    try {
      this.memberships = await listMembershipsForCurrentUser(true);
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
    try {
      const url = await getCurrentFarmLogoUrl();
      if (url) { this.farmLogoUrl = url; return; }
    } catch {}
    const ctx = getCurrentFarmMetaSync();
    const currentTenantId = ctx?.id || this.selected?.tenant_id || null;
    const m = this.memberships.find(x => x.tenant_id === currentTenantId) || this.memberships[0];
    const key = m?.farm?.id || m?.tenant_id || m?.farm?.schema_name || null;
    if (key) {
      try { this.farmLogoUrl = await getFarmLogoUrl(key); return; } catch {}
    }
    this.farmLogoUrl = null;
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
  }

  private makeInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).slice(0, 2);
    const init = parts.map(p => p[0]?.toUpperCase() || '').join('');
    return init || 'F';
  }
}

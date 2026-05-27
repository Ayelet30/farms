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
    independent: '/independent',
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
    independent: 'רוכב עצמאי',
  };


  isRoleMenuOpen = false;

  // סגירת התפריט בכל קליק מחוץ לחץ
  @HostListener('document:click')
  onDocumentClick() {
    this.isRoleMenuOpen = false;
  }

  deferredPrompt: any = null;

  showInstallButton = true;
  installGuideOpen = false;

  isIosDevice = false;
  isAndroidDevice = false;
  isDesktopDevice = false;
  isStandalone = false;

  installGuideTitle = '';
  installGuideText = '';

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: any) {
    event.preventDefault();
    this.deferredPrompt = event;

    if (!this.isStandalone) {
      this.showInstallButton = true;
    }
  }

  @HostListener('window:appinstalled')
  onAppInstalled() {
    this.deferredPrompt = null;
    this.showInstallButton = false;
    localStorage.setItem('smartFarmInstalled', 'true');
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
      this.initInstallState();
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
    } catch { }
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
    const ctxName = getCurrentFarmMetaSync()?.name;
    return m.farm?.name || ctxName || 'חווה ללא שם';
  }

  formatMembershipLabel(m: Membership | null | undefined): string {
    if (!m) return '';
    return `${this.formatMembershipRole(m)} · ${this.formatMembershipFarm(m)}`;
  }

  private initInstallState(): void {
    const ua = window.navigator.userAgent.toLowerCase();

    this.isIosDevice = /iphone|ipad|ipod/.test(ua);
    this.isAndroidDevice = /android/.test(ua);
    this.isDesktopDevice = !this.isIosDevice && !this.isAndroidDevice;

    this.isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    const alreadyInstalled = localStorage.getItem('smartFarmInstalled') === 'true';

    if (this.isStandalone || alreadyInstalled) {
      this.showInstallButton = false;
      return;
    }

    // באייפון אין beforeinstallprompt, לכן מציגים כפתור הדרכה
    if (this.isIosDevice) {
      this.showInstallButton = true;
      return;
    }

    // באנדרואיד נציג כפתור, אבל ההתקנה תעבוד רק כש־beforeinstallprompt הגיע
    if (this.isAndroidDevice) {
      this.showInstallButton = true;
      return;
    }

    // במחשב אפשר להשאיר כפתור להסבר/QR בהמשך
    this.showInstallButton = true;
  }

  async onInstallClick(): Promise<void> {
    if (this.isStandalone) {
      this.showInstallButton = false;
      return;
    }

    if (this.isIosDevice) {
      this.openIosGuide();
      return;
    }

    if (this.isAndroidDevice) {
      await this.installAndroid();
      return;
    }

    this.openDesktopGuide();
  }

  private async installAndroid(): Promise<void> {
    if (!this.deferredPrompt) {
      this.installGuideTitle = 'התקנת האפליקציה';
      this.installGuideText =
        'אם חלון ההתקנה לא נפתח, פתח את האתר דרך Chrome באנדרואיד ובחר בתפריט: התקנת האפליקציה או הוסף למסך הבית.';
      this.installGuideOpen = true;
      return;
    }

    this.deferredPrompt.prompt();

    const choiceResult = await this.deferredPrompt.userChoice;

    if (choiceResult?.outcome === 'accepted') {
      this.showInstallButton = false;
      localStorage.setItem('smartFarmInstalled', 'true');
    }

    this.deferredPrompt = null;
  }

  private openIosGuide(): void {
    this.installGuideTitle = 'התקנה באייפון';
    this.installGuideText =
      'באייפון ההתקנה נעשית דרך Safari באמצעות הוספה למסך הבית.';
    this.installGuideOpen = true;
  }

  private openDesktopGuide(): void {
    this.installGuideTitle = 'התקנה מהטלפון';
    this.installGuideText =
      'כדי להתקין את Smart Farm כאפליקציה, פתח את האתר מהטלפון.';
    this.installGuideOpen = true;
  }

  closeInstallGuide(): void {
    this.installGuideOpen = false;
  }


}


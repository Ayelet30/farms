import { Component, OnInit, OnDestroy, HostListener, inject, EventEmitter, Output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { Subscription } from 'rxjs';
import {
  ensureTenantContextReady,
  dbTenant,
  dbPublic,
  getCurrentFarmMetaSync,
} from '../../services/legacy-compat';
import { RequestBadgeService } from '../../services/request-badge.service';

type FarmFeature =
  | 'therapeutic_core'
  | 'farm_operations_advanced'
  | 'independent_riders'
  | 'rider_services'
  | 'payment_methods'
  | 'invoices'
  | 'billing'
  | 'recurring_charges'
  | 'kupah_reports'
  | 'kupah_updates'
  | 'claims'
  | 'kupah_automation'
  | 'communications'
  | 'documents'
  | 'reminders'
  | 'rider_billing';

type MenuItem = {
  path?: string;
  label: string;
  icon?: string;
  badge?: number;
  section?: boolean;
  featureKey?: FarmFeature;
  disabled?: boolean;
};

@Component({
  selector: 'app-slider',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './slider.html',
  styleUrls: ['./slider.scss']
})
export class SliderComponent implements OnInit, OnDestroy {

  @Input() collapsed = false;

  @Output() collapsedChange = new EventEmitter<boolean>();

  private router = inject(Router);
  private dialog = inject(MatDialog);
  private cu = inject(CurrentUserService);

  isDesktop = false;
  role = '';
  menuItems: MenuItem[] = [];
  enabledFeatures = new Set<string>();
  error: string | undefined;

  pendingRequestsCount = 0;
  private requestsRealtimeChannel: any = null;

  badgeService = inject(RequestBadgeService);

  async ngOnInit() {
    await this.cu.waitUntilReady();

    await ensureTenantContextReady();
    await this.loadEnabledFeatures();

    this.cu.user$.subscribe(async u => {
      const roleKey = (u?.role || '').toLowerCase();

      if (roleKey !== this.role) {
        this.role = roleKey;
        await this.loadEnabledFeatures();
        this.setMenuItemsByRole();
      }
    });

    const cur = this.cu.current;
    this.role = (cur?.role || '').toLowerCase();

    this.setMenuItemsByRole();
    this.syncBreakpoint();

    await this.badgeService.refreshTenant();

    this.setMenuItemsByRole();
  }

  private applyLicense(items: MenuItem[]): MenuItem[] {
    return items.map(item => ({
      ...item,
      disabled: !!item.featureKey && !this.enabledFeatures.has(item.featureKey)
    }));
  }

  async ngOnDestroy() { }

  @HostListener('window:resize')
  onResize() {
    this.syncBreakpoint();
  }

  @HostListener('window:schedule-fullscreen-change', ['$event'])
onScheduleFullscreenChange(event: Event): void {
  const customEvent = event as CustomEvent<{
    fullscreen: boolean;
  }>;

  if (customEvent.detail?.fullscreen) {
    this.toggleMenu(true);
  }
}

  /** בונה את התפריט לפי תפקיד המשתמש */
  // slider.ts
  private setMenuItemsByRole() {
    switch (this.role) {
      case 'parent':
        this.menuItems = [
          { path: 'parent/children', label: 'הילדים שלי', icon: 'children' },
          { path: 'parent/schedule', label: 'מערכת שיעורים', icon: 'calendar' },
          { path: 'parent/appointment', label: 'זימון תורים', icon: 'calendar_plus' },
          { path: 'parent/payments', label: 'אמצעי תשלום', icon: 'card' },
          { path: 'parent/requests', label: 'בקשות ואישורים', icon: 'checklist' },
          { path: 'parent/messages', label: 'יצירת קשר', icon: 'messages' },
          { path: 'parent/waitlist', label: 'רשימת המתנה', icon: 'waitlist' },
          { path: 'parent/details', label: 'הפרטים שלי', icon: 'user' },
          { path: 'parent/activity-summary', label: 'סיכום פעילות', icon: 'receipt' },
        ];
        break;

      case 'instructor':
        this.menuItems = [
          { path: 'instructor/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: '/instructor/availability', label: 'העדפות זמינות', icon: 'clock' },
          { path: 'instructor/monthly-summary', label: 'סיכום חודשי', icon: 'bar_chart' },
          { path: 'instructor/requests', label: 'בקשות ואישורים', icon: 'checklist' },
          { path: 'instructor/settings', label: 'הגדרות', icon: 'settings' }
        ];
        break;

      case 'secretary':
        this.menuItems = this.applyLicense([
          { path: 'secretary/parents', label: 'הורים בחווה', icon: 'parents', featureKey: 'therapeutic_core' },
          { path: 'secretary/children', label: 'ילדים בחווה', icon: 'children', featureKey: 'therapeutic_core' },

          { path: 'secretary/independent-riders', label: 'רוכבים עצמאיים', icon: 'rider', featureKey: 'independent_riders' },

          { path: 'secretary/instructors', label: 'מדריכים בחווה', icon: 'instructor', featureKey: 'therapeutic_core' },
          { path: 'secretary/horses', label: 'סוסים בחווה', icon: 'hors', featureKey: 'therapeutic_core' },
          { path: 'secretary/arenas', label: 'מגרשים בחווה', icon: 'arena', featureKey: 'farm_operations_advanced' },

          { path: 'secretary/schedule', label: 'לו״ז ומעקב', icon: 'calendar', featureKey: 'therapeutic_core' },
          { path: 'secretary/appointment', label: 'זימון תורים', icon: 'calendar_plus', featureKey: 'therapeutic_core' },

          { path: 'secretary/rider-services', label: 'זימון שירות לסוס', icon: 'receipt', featureKey: 'rider_services' },
          { path: 'secretary/rider-service-tasks', label: 'משימות שירותים', icon: 'checklist', featureKey: 'rider_services' },

          { path: 'secretary/waitlist', label: 'רשימת המתנה', icon: 'waitlist', featureKey: 'therapeutic_core' },
          { path: 'secretary/messages', label: 'יצירת קשר', icon: 'messages', featureKey: 'communications' },
          { path: 'secretary/monthly-summary', label: 'סיכום וגרפים', icon: 'bar_chart', featureKey: 'farm_operations_advanced' },

          { path: 'secretary/requests', label: 'בקשות ואישורים', icon: 'checklist', featureKey: 'therapeutic_core' },
          { path: 'secretary/payments', label: 'תשלומים וחשבוניות', icon: 'card', featureKey: 'invoices' },
          { path: 'secretary/billing', label: 'ניהול חיובים', icon: 'billing', featureKey: 'billing' },

          {
            path: 'secretary/rider-billing',
            label: 'חיובי רוכבים',
            icon: 'billing',
            featureKey: 'billing'
          },
          { path: 'secretary/claims', label: 'טיפול בתביעות', icon: 'claims', featureKey: 'claims' },

          { path: 'secretary/settings', label: 'הגדרות חווה', icon: 'settings', featureKey: 'therapeutic_core' },
        ]);
        break;
      case 'independent':
        this.menuItems = [
          { path: 'independent/appointment', label: 'זימון שירות', icon: 'calendar_plus' },
          { path: 'independent/my-services', label: 'השירותים שלי', icon: 'receipt' },
          // { path: 'independent/billing', label: 'ניהול חיובים', icon: 'billing' },
          { path: 'independent/requests', label: 'בקשות ואישורים', icon: 'checklist' },
          { path: 'independent/payments', label: 'אמצעי תשלום', icon: 'billing' },
          { path: 'independent/details', label: 'הפרטים שלי', icon: 'user' },
          { path: 'independent/horses', label: 'הסוסים שלי', icon: 'hors' },

        ];
        break;
      case 'admin':
        this.menuItems = [
          { path: 'admin/users', label: 'ניהול משתמשים', icon: 'users' },
          { path: 'admin/logs', label: 'צפייה ביומנים', icon: 'logs' },
          { path: 'admin/settings', label: 'הגדרות מערכת', icon: 'settings' },
        ];
        break;

      default:
        this.menuItems = [];
        break;
    }
  }


  navigateToItem(item: MenuItem) {
    if (item.disabled) {
      alert(`הרישיון שנרכש לחווה אינו כולל את האפשרות: ${item.label}`);
      return;
    }

    if (!item.path) return;

    this.router.navigate([item.path]);

    if (!this.isDesktop) {
      this.collapsed = true;
      this.collapsedChange.emit(true);
    }
  }

  toggleMenu(force?: boolean) {
    this.collapsed = typeof force === 'boolean' ? force : !this.collapsed;
    this.collapsedChange.emit(this.collapsed);
  }

  /** בדיקה אם הנתיב פעיל */
  isActive(path: string): boolean {
    return this.router.url.includes(path);
  }

  /** התאמה למסכים רספונסיביים */
  private syncBreakpoint() {
    this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;

    if (this.isDesktop) {
      this.collapsed = false; // בדסקטופ פתוח כברירת מחדל
    } else {
      this.collapsed = true;  // במובייל סגור
    }

    this.collapsedChange.emit(this.collapsed);
  }

  private async loadPendingRequestsCount() {
    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const { count, error } = await db
        .from('v_secretarial_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING');

      if (error) throw error;

      this.pendingRequestsCount = count ?? 0;
      this.setMenuItemsByRole();

    } catch (err) {
      console.error('Failed loading pending requests count', err);
    }
  }

  private async listenToRequestsChanges() {
    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const schema =
        (this.cu.current as any)?.schema_name ??
        (this.cu.current as any)?.tenant_schema ??
        (this.cu.current as any)?.db_schema ??
        (this.cu.current as any)?.farm_schema;

      if (!schema) {
        console.warn('לא נמצא שם סכמה למעקב realtime', this.cu.current);
        return;
      }

      if (this.requestsRealtimeChannel) {
        await db.removeChannel(this.requestsRealtimeChannel);
      }

      this.requestsRealtimeChannel = db
        .channel(`secretarial-requests-count-${schema}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema,
            table: 'secretarial_requests',
          },
          async () => {
            await this.loadPendingRequestsCount();
          }
        )

    } catch (err) {
      console.error('Failed listening to requests changes', err);
    }
  }

  private async loadEnabledFeatures() {
    try {
      await ensureTenantContextReady();

      const farmMeta: any = getCurrentFarmMetaSync?.();

      const schemaName =
        farmMeta?.schema_name ||
        farmMeta?.schemaName ||
        farmMeta?.tenant_schema ||
        farmMeta?.db_schema ||
        farmMeta?.farm_schema;

      if (!schemaName) {
        this.enabledFeatures = new Set();
        return;
      }

      const { data, error } = await dbPublic()
        .rpc('get_enabled_features_for_schema', {
          p_schema_name: schemaName
        });

      if (error) throw error;

      this.enabledFeatures = new Set(
        (data ?? []).map((x: any) => x.feature_key)
      );

    } catch (err) {
      console.error('Failed loading enabled farm features', err);
      this.enabledFeatures = new Set();
    }
  }
}

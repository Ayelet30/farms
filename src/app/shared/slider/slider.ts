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
} from '../../services/legacy-compat';
import { RequestBadgeService } from '../../services/request-badge.service';

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
  menuItems: Array<{
    path?: string;
    label: string;
    icon?: string;
    badge?: number;
    section?: boolean;
  }> = [];
  error: string | undefined;

  pendingRequestsCount = 0;
  private requestsRealtimeChannel: any = null;

  private badgeService = inject(RequestBadgeService);



  async ngOnInit() {
    await this.cu.waitUntilReady();

    // האזנה לשינויים בתפקיד
    this.cu.user$.subscribe(u => {
      const roleKey = (u?.role || '').toLowerCase();
      if (roleKey !== this.role) {
        this.role = roleKey;
        this.setMenuItemsByRole();
      }
    });

    // אתחול ראשוני
    const cur = this.cu.current;
    this.role = (cur?.role || '').toLowerCase();
    this.setMenuItemsByRole();

    this.syncBreakpoint();
    await this.badgeService.init();

    this.pendingRequestsCount = this.badgeService.pendingCount();

    setInterval(() => {
      this.pendingRequestsCount = this.badgeService.pendingCount();
      this.setMenuItemsByRole();
    }, 500);
  }

  async ngOnDestroy() {
    const db = dbTenant();

    if (this.requestsRealtimeChannel) {
      await db.removeChannel(this.requestsRealtimeChannel);
      this.requestsRealtimeChannel = null;
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.syncBreakpoint();
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
        this.menuItems = [
          { path: 'secretary/parents', label: 'הורים בחווה', icon: 'parents' },
          { path: 'secretary/children', label: 'ילדים בחווה', icon: 'children' },
          { path: 'secretary/independent-riders', label: 'רוכבים עצמאיים', icon: 'rider' },
          { path: 'secretary/instructors', label: 'מדריכים בחווה', icon: 'instructor' },
          { path: 'secretary/horses', label: 'סוסים בחווה', icon: 'hors' },
          { path: 'secretary/arenas', label: 'מגרשים בחווה', icon: 'arena' },
          { path: 'secretary/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: 'secretary/appointment', label: 'זימון תורים', icon: 'calendar_plus' },
          { path: 'secretary/waitlist', label: 'רשימת המתנה', icon: 'waitlist' },
          { path: 'secretary/messages', label: 'יצירת קשר', icon: 'messages' },
          { path: 'secretary/monthly-summary', label: 'סיכום וגרפים', icon: 'bar_chart' },
          { path: 'secretary/requests', label: 'בקשות ואישורים', icon: 'checklist' },
          { path: 'secretary/payments', label: 'תשלומים וחשבוניות', icon: 'card' },
          { path: 'secretary/billing', label: 'ניהול חיובים', icon: 'billing' },
          { path: 'secretary/claims', label: 'טיפול בתביעות', icon: 'claims' },
          { path: 'secretary/settings', label: 'הגדרות חווה', icon: 'settings' },
        ];
        break;
      case 'independent':
        this.menuItems = [
          { path: 'independent/appointment', label: 'זימון שירות', icon: 'calendar_plus' },
          { path: 'independent/billing', label: 'ניהול חיובים', icon: 'billing' },
          { path: 'independent/requests', label: 'בקשות ואישורים', icon: 'checklist' },
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


  /** מעבר לנתיב שנבחר בתפריט */
  navigateTo(path: string) {
    this.router.navigate([path]);
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
        .subscribe((status: string) => {
          console.log('requests realtime status:', status);
        });

    } catch (err) {
      console.error('Failed listening to requests changes', err);
    }
  }
}

import { Component, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { CurrentUserService } from '../../core/auth/current-user.service';

@Component({
  selector: 'app-slider',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './slider.html',
  styleUrls: ['./slider.scss']
})
export class SliderComponent implements OnInit {
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private cu = inject(CurrentUserService);

  isDesktop = false;
  menuCollapsed = false;
  role = '';
  menuItems: Array<{ path: string; label: string; icon: string }> = [];
  error: string | undefined;

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
  }

  @HostListener('window:resize')
  onResize() {
    this.syncBreakpoint();
  }

  /** בונה את התפריט לפי תפקיד המשתמש */
  private setMenuItemsByRole() {
    switch (this.role) {
      case 'parent':
        this.menuItems = [
          { path: 'parent/children', label: 'הילדים שלי', icon: 'children' },
          { path: 'parent/schedule', label: 'מערכת שיעורים', icon: 'calendar' },
          { path: 'parent/appointment', label: 'זימון תורים', icon: 'settings' },
          { path: 'parent/activity-summary', label: 'סיכום פעילות', icon: 'receipt' },
          { path: 'parent/payments', label: 'אמצעי תשלום', icon: 'card' },
          { path: 'parent/messages', label: 'הודעות', icon: 'note' },
          { path: 'parent/details', label: 'הפרטים שלי', icon: 'user' },
          { path: 'parent/requests', label: 'בקשות ואישורים', icon: 'settings' } 
        ];
        break;

      case 'instructor':
        this.menuItems = [
          { path: 'instructor/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: '/instructor/availability', label: 'העדפות זמינות', icon: 'clock' },
          { path: 'instructor/monthly-summary', label: 'סיכום חודשי', icon: 'bar_chart' },
          { path: 'instructor/settings', label: 'הגדרות', icon: 'settings' },
          { path: 'instructor/requests', label: 'בקשות ואישורים', icon: 'settings' } 
        ];
        break;

      case 'secretary':
        this.menuItems = [
          { path: 'secretary/parents', label: 'הורים בחווה', icon: 'user' },
          { path: 'secretary/children', label: 'ילדים בחווה', icon: 'children' },
          { path: 'secretary/instructors', label: 'מדריכים בחווה', icon: 'user' },
          { path: 'secretary/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: 'secretary/appointment', label: 'זימון תורים', icon: 'settings' },
          { path: 'secretary/messages', label: 'הודעות', icon: 'note' },
          { path: 'secretary/requests', label: 'בקשות ואישורים', icon: 'note' },
          { path: 'secretary/payments', label: 'תשלומים וחשבוניות', icon: 'card' },
          { path: 'secretary/settings', label: 'הגדרות חווה', icon: 'settings' },
        ];
        break;

      case 'admin':
        this.menuItems = [
          { path: 'admin/users', label: 'ניהול משתמשים', icon: 'user' },
          { path: 'admin/logs', label: 'צפייה ביומנים', icon: 'calendar' },
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
    if (!this.isDesktop) this.menuCollapsed = true; // סגירה במובייל
  }

  /** בדיקה אם הנתיב פעיל */
  isActive(path: string): boolean {
    return this.router.url.includes(path);
  }

  /** פתיחה/סגירה של התפריט */
  toggleMenu(force?: boolean) {
    this.menuCollapsed = typeof force === 'boolean' ? force : !this.menuCollapsed;
  }

  /** התאמה למסכים רספונסיביים */
  private syncBreakpoint() {
    this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    this.menuCollapsed = !this.isDesktop;
  }
}

import { Component, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
<<<<<<< HEAD
=======

>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
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

<<<<<<< HEAD
    // האזנה לשינויים בתפקיד
=======
    // האזיני לשינויים בתפקיד והחליפי תפריט בהתאם
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
    this.cu.user$.subscribe(u => {
      const roleKey = (u?.role || '').toLowerCase();
      if (roleKey !== this.role) {
        this.role = roleKey;
        this.setMenuItemsByRole();
      }
    });

<<<<<<< HEAD
    // אתחול ראשוני
=======
    // פעם ראשונה – קחי מהמצב הנוכחי
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
    const cur = this.cu.current;
    this.role = (cur?.role || '').toLowerCase();
    this.setMenuItemsByRole();

<<<<<<< HEAD
    this.syncBreakpoint();
  }

  @HostListener('window:resize')
  onResize() {
    this.syncBreakpoint();
  }

  /** בונה את התפריט לפי תפקיד המשתמש */
=======
    // מצב רספונסיבי התחלתי
    this.syncBreakpoint();
  }


  @HostListener('window:resize')
  onResize() { this.syncBreakpoint(); }

  /** בונה פריטי תפריט לפי תפקיד */
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
  private setMenuItemsByRole() {
    switch (this.role) {
      case 'parent':
        this.menuItems = [
          { path: 'parent/children', label: 'הילדים שלי', icon: 'children' },
          { path: 'parent/schedule', label: 'מערכת שיעורים', icon: 'calendar' },
          { path: 'parent/activity-summary', label: 'סיכום פעילות', icon: 'receipt' },
          { path: 'parent/payments', label: 'אמצעי תשלום', icon: 'card' },
          { path: 'parent/messages', label: 'הודעות', icon: 'note' },
          { path: 'parent/details', label: 'הפרטים שלי', icon: 'user' },
        ];
        break;

      case 'instructor':
        this.menuItems = [
          
          { path: 'instructor/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: 'instructor/activities', label: 'ניהול פעילויות', icon: 'user' },
          { path: 'instructor/notes', label: 'רשומות והערות', icon: 'note' },
    { path: 'instructor/monthly-summary', label: 'סיכום חודשי', icon: 'bar_chart' },

        ];
        break;

      case 'secretary':
        this.menuItems = [
          { path: 'secretary/parents', label: 'הורים בחווה', icon: 'user' },
          { path: 'secretary/regulations', label: 'ניהול תקנונים', icon: 'note' },
          { path: 'secretary/children', label: 'ילדים בחווה', icon: 'children' },
          { path: 'secretary/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: 'secretary/messages', label: 'הודעות', icon: 'note' },
        ];
        break;

      case 'admin':
        this.menuItems = [
          { path: 'admin/users', label: 'ניהול משתמשים', icon: 'user' },
          { path: 'admin/logs', label: 'צפייה ביומנים', icon: 'calendar' },
          { path: 'admin/settings', label: 'הגדרות מערכת', icon: 'note' },
        ];
        break;

      default:
        this.menuItems = [];
        break;
    }
  }

<<<<<<< HEAD
  /** מעבר לנתיב שנבחר בתפריט */
=======
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
  navigateTo(path: string) {
    this.router.navigate([path]);
    if (!this.isDesktop) this.menuCollapsed = true; // סגירה במובייל
  }

<<<<<<< HEAD
  /** בדיקה אם הנתיב פעיל */
=======
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
  isActive(path: string): boolean {
    return this.router.url.includes(path);
  }

<<<<<<< HEAD
  /** פתיחה/סגירה של התפריט */
=======
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
  toggleMenu(force?: boolean) {
    this.menuCollapsed = typeof force === 'boolean' ? force : !this.menuCollapsed;
  }

<<<<<<< HEAD
  /** התאמה למסכים רספונסיביים */
=======
  /** קובע מצב רספונסיבי: בדסקטופ פתוח, במובייל סגור וצף */
>>>>>>> e734bc93375cb004acaf4e1fdb689fc565350307
  private syncBreakpoint() {
    this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    this.menuCollapsed = !this.isDesktop;
  }
}

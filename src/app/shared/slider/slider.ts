import { Component, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
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
  private cu = inject(CurrentUserService);

  isDesktop = false;
  menuCollapsed = false;
  role = '';
  menuItems: Array<{ path: string; label: string; icon: string }> = [];

  async ngOnInit() {
    await this.cu.waitUntilReady();
    this.cu.user$.subscribe(u => {
      const roleKey = (u?.role || '').toLowerCase();
      if (roleKey !== this.role) {
        this.role = roleKey;
        this.setMenuItemsByRole();
      }
    });

    const cur = this.cu.current;
    this.role = (cur?.role || '').toLowerCase();
    this.setMenuItemsByRole();
    this.syncBreakpoint();
  }

  @HostListener('window:resize')
  onResize() { this.syncBreakpoint(); }

  private setMenuItemsByRole() {
    switch (this.role) {
      case 'parent':
        this.menuItems = [
          { path: 'parent/children', label: 'הילדים שלי', icon: 'children' },
          { path: 'parent/schedule', label: 'מערכת שיעורים', icon: 'calendar' },
          { path: 'parent/summary', label: 'סיכום פעילות', icon: 'receipt' },
          { path: 'parent/payments', label: 'אמצעי תשלום', icon: 'card' },
          { path: 'parent/messages', label: 'הודעות למשרד', icon: 'note' },
          { path: 'parent/details', label: 'הפרטים שלי', icon: 'user' },
        ];
        break;
      case 'instructor':
        this.menuItems = [
          { path: 'instructor/children', label: 'כל הילדים', icon: 'children' },
          { path: 'instructor/schedule', label: 'לו״ז ומעקב', icon: 'calendar' },
          { path: 'instructor/activities', label: 'ניהול פעילויות', icon: 'user' },
          { path: 'instructor/notes', label: 'רשומות והערות', icon: 'note' },
        ];
        break;
      case 'secretary':
        this.menuItems = [
          { path: 'secretary/parents', label: 'הורים בחווה', icon: 'user' },
          { path: 'secretary/regulations', label: 'ניהול תקנונים', icon: 'note' },
        ];
        break;
      case 'admin':
        this.menuItems = [
          { path: 'admin/users', label: 'ניהול משתמשים', icon: 'user' },
          { path: 'admin/logs', label: 'יומנים', icon: 'calendar' },
          { path: 'admin/settings', label: 'הגדרות מערכת', icon: 'note' },
        ];
        break;
      default:
        this.menuItems = [];
        break;
    }
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
    if (!this.isDesktop) this.menuCollapsed = true;
  }

  isActive(path: string): boolean { return this.router.url.includes(path); }

  toggleMenu(force?: boolean) {
    this.menuCollapsed = typeof force === 'boolean' ? force : !this.menuCollapsed;
  }

  private syncBreakpoint() {
    this.isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    this.menuCollapsed = !this.isDesktop;
  }
}

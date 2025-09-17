import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { fetchCurrentFarmName, getCurrentUserData, getCurrentUserDetails, getFarmMetaById, logout } from '../../services/supabaseClient';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-slider',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './slider.html',
  styleUrls: ['./slider.scss']
})
export class SliderComponent implements OnInit {
  role: string = '';
  menuItems: any[] = [];
;
  menuCollapsed = false;
  error: string | undefined;

  constructor(private router: Router, private dialog: MatDialog) {}

  async ngOnInit() {
    const userData = await getCurrentUserDetails();
    this.role = userData?.role_in_tenant ? userData?.role_in_tenant : '';
    this.setMenuItemsByRole();

  }

  setMenuItemsByRole() {
    if (this.role === 'parent') {
      this.menuItems = [
        { path: 'parent/children', label: 'הילדים שלי', icon: 'children' },
        { path: 'parent/schedule', label: 'מערכת שיעורים', icon: 'calendar' },
        { path: 'parent/activity-summary', label: 'סיכום פעילות', icon: 'receipt' },
        { path: 'parent/payments', label: 'אמצעי תשלום', icon: 'card' },
        { path: 'parent/messages', label: 'הודעות', icon: 'note' },
        { path: 'parent/details', label: 'הפרטים שלי', icon: 'user' },
      ];
    } else if (this.role === 'instructor') {
      this.menuItems = [
        { path: 'instructor/children', label: 'כל הילדים', icon: 'children' },
        {path: 'instructor/schedule', label: ' לו"ז ומעקב', icon: 'calendar' },
        { path: 'instructor/activities', label: 'ניהול פעילויות', icon: 'user' },
        { path: 'instructor/notes', label: 'רשומות והערות', icon: 'note' }
      ];
    } else if (this.role === 'admin') {
      this.menuItems = [
        { path: 'admin/users', label: 'ניהול משתמשים', icon: 'user' },
        { path: 'admin/logs', label: 'צפייה ביומנים', icon: 'calendar' },
        { path: 'admin/settings', label: 'הגדרות מערכת', icon: 'note' }
      ];
    }
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
    this.menuCollapsed = false;
  }

  isActive(path: string): boolean {
    return this.router.url.includes(path);
  }

  toggleMenu() {
    this.menuCollapsed = !this.menuCollapsed;
  }

}

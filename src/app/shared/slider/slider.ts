import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserData, getFarmMetaById, logout } from '../../services/supabaseClient';

@Component({
  selector: 'app-slider',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './slider.html',
  styleUrls: ['./slider.css']
})
export class SliderComponent implements OnInit {
  role: string = '';
  menuItems: any[] = [];
  farmName: string = '';
  menuCollapsed = false;

  constructor(private router: Router, private dialog: MatDialog) {}

  async ngOnInit() {
    const userData = await getCurrentUserData();
    this.role = userData?.role || '';
    //this.farmName = await getFarmMetaById(userData?.farm_id);
    this.setMenuItemsByRole();
  }

  setMenuItemsByRole() {
    if (this.role === 'parent') {
      this.menuItems = [
        { path: 'parent/children', label: 'הילדים שלי', icon: '👨‍👧' },
        { path: 'parent/schedule', label: 'מערכת שיעורים', icon: '📅' },
        { path: 'parent/summary', label: 'סיכום פעילות', icon: '🧾' },
        { path: 'parent/payments', label: 'אמצעי תשלום', icon: '💳' },
        { path: 'parent/notes', label: 'הערות למשרד', icon: '📝' },
        { path: 'parent/details', label: 'הפרטים שלי', icon: '⚙️' }
      ];
    } else if (this.role === 'guide') {
      this.menuItems = [
        { path: 'guide/children', label: 'כל הילדים', icon: '👶' },
        { path: 'guide/activities', label: 'ניהול פעילויות', icon: '🏇' },
        { path: 'guide/notes', label: 'רשומות והערות', icon: '📝' }
      ];
    } else if (this.role === 'admin') {
      this.menuItems = [
        { path: 'admin/users', label: 'ניהול משתמשים', icon: '🧑‍💼' },
        { path: 'admin/logs', label: 'צפייה ביומנים', icon: '📊' },
        { path: 'admin/settings', label: 'הגדרות מערכת', icon: '⚙️' }
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

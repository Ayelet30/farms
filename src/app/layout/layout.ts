import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../logout-confirmation/logout-confirmation';




import { getCurrentUserData, getFarmNameById, logout } from '../services/supabase.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterModule, CommonModule], // ✅ חובה עבור <router-outlet>
  templateUrl: './layout.html',
  styleUrls: ['./layout.css']
})
export class LayoutComponent implements OnInit {
  role: string = '';
  menuItems: any[] = [];
  menuOpen = false;
  farmName: string = '';


  constructor(
  private dialog: MatDialog,
  private router: Router
) {}

logout() {
  const dialogRef = this.dialog.open(LogoutConfirmationComponent, {
    width: '320px',
    disableClose: true
  });

  dialogRef.afterClosed().subscribe(result => {
    if (result === true) {
      logout(); // הפונקציה שמבצעת את ההתנתקות (כמו supabase.auth.signOut())
      this.router.navigate(['/home']);
    }
  });
}


  async ngOnInit() {
    const userData = await getCurrentUserData();
    this.role = userData?.role || '';
    this.setMenuItemsByRole();
    this.farmName = await getFarmNameById(userData?.farm_id);

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
    this.menuOpen = false;
  }

  isActive(path: string): boolean {
    return this.router.url.includes(path);
  }
menuCollapsed = false;

toggleMenu() {
  this.menuCollapsed = !this.menuCollapsed;
}

  
}

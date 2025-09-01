import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserDetails, getCurrentUserData, getSupabaseClient, logout, setTenantContext } from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent {
  isLoggedIn = false;
  userName: string = '';
  userRole: string  | undefined;
  farmName: string | undefined;
  farmNote: string = '';

  supabase = getSupabaseClient();

  async ngOnInit() {
    const user = await getCurrentUserData();
    this.isLoggedIn = !!user;
  }


  constructor(private router: Router, private dialog: MatDialog, private cuSvc: CurrentUserService) {
    this.checkLogin();
  }

  async checkLogin() {
    const user = await this.cuSvc.loadUserDetails();
    console.log('user:', user);
    if (!user) {
      console.log("אין משתמש כזה")
    } else {
      this.userName = user.full_name;
      this.userRole = user.role!;
      this.farmName = user.farm_name!;
      this.farmNote = "user.farm_note";
      this.isLoggedIn = true;
    }

  }


  handleLoginLogout() {
    if (this.isLoggedIn) {
      const dialogRef = this.dialog.open(LogoutConfirmationComponent, {
        width: '320px',
        disableClose: true
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result === true) {
          logout();
          this.router.navigate(['/home']);
        }
      });
    } else {
      this.router.navigate(['/login']);
    }
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentParentDetails, getCurrentUserData, getSupabaseClient, logout, setTenantContext } from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent {
  isLoggedIn = false;
  parentName: string = '';
  supabase = getSupabaseClient();

  async ngOnInit() {
    const user = await getCurrentUserData();
    this.isLoggedIn = !!user;
  }


  constructor(private router: Router, private dialog: MatDialog, private cuSvc: CurrentUserService) {
    this.checkLogin();
  }

  async checkLogin() {
    const parent = await this.cuSvc.loadParentDetails();
    console.log('Parent:', parent);
    if (!parent) {
      console.log("אין הורה כזה")
    } else {
      this.parentName = parent.full_name;
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

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserDetails, getCurrentUserData, getSupabaseClient, logout, setTenantContext } from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { listMembershipsForCurrentUser, selectMembership, Membership } from '../../services/supabaseClient';
import { TokensService } from '../../services/tokens.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent {
  isLoggedIn = false;
  userName: string = '';
  userRole: string  | undefined;
  farmName: string | undefined;
  farmNote: string = '';
  
  roleMenuOpen = false;
  memberships: Membership[] = [];
  roleHe: Record<string,string> = { instructor: 'מדריך', parent: 'הורה', secretary: 'מזכירות', manager: 'מנהל' };
  
  supabase = getSupabaseClient();
  tokensService: any;

  async ngOnInit() {
     try {
    this.memberships = await listMembershipsForCurrentUser();
    const user = this.memberships.at(0);
    this.isLoggedIn = !!user;
  } catch {}
  }


  constructor(private router: Router, private dialog: MatDialog, public cuSvc: CurrentUserService) {
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
      this.farmNote = "אתר לניהול חוות";
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
 routeByRole(role: string | null | undefined) {
    switch ((role || '').toLowerCase()) {
      case 'parent': return '/parent';
      case 'instructor': return '/instructor';
      case 'secretary': return '/secretary';
      case 'admin': return '/admin';
      case 'manager':
      case 'coordinator': return '/ops';
      default: return '/home';
    }
  }

  async onChooseTenant(tenantId: string | null | undefined) {
  if (!tenantId) return;
  const { role } = await this.cuSvc.switchMembership(tenantId);
  const target = this.routeByRole(role);
  await this.router.navigateByUrl(target);
}

  
}



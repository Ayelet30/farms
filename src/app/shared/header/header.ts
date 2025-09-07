import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserDetails, getCurrentUserData, getSupabaseClient, logout, setTenantContext, getCurrentFarmMetaSync } from '../../services/supabaseClient';
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
  selected: Membership | null = null;
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


  constructor(public cu: CurrentUserService, private dialog: MatDialog, private router: Router, private tokens: TokensService) {
    this.checkLogin();
  }

  async checkLogin() {
    const user = await this.cu.loadUserDetails();
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

      dialogRef.afterClosed().subscribe((result: boolean) => {
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


 async onChooseMembership(m: Membership | null) {
    if (!m) return;

    // שולחים גם tenant וגם role כדי לקבל JWT וסביבה תואמים
    const { role } = await this.cu.switchMembership(m.tenant_id, m.role_in_tenant);

    // עדכון environment (טוקנים/סכימה) לפי החווה שבפועל הוקמה בצד השרת
    const farm = getCurrentFarmMetaSync();
    this.tokens.applytokens(farm?.schema_name || 'public');

    this.checkLogin();

    // ניווט לפי role שחזר מהשרת (למקרה שהשרת בחר אחרת)
    const target = this.routeByRole(role);
    await this.router.navigateByUrl(target);
  }
  
}



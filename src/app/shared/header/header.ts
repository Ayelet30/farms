import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserDetails, getCurrentUserData, getSupabaseClient, logout, setTenantContext, getCurrentFarmMetaSync, getCurrentFarmLogoUrl, getSelectedMembershipSync } from '../../services/supabaseClient';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { listMembershipsForCurrentUser, selectMembership, Membership  , getFarmLogoUrl} from '../../services/supabaseClient';
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
    farmLogoUrl: string | null = null;   
  farmInitials: string = '';           
  selected?: { role_in_tenant?: string | null };      

  // מיפוי דפי בית לפי תפקיד
  private readonly homeRoutes: Record<string, string> = {
    parent: '/parent/children',   // "הילדים שלי"
    instructor: '/instructor',    //להחליט לאן רוצים שהמדריך יעבור בלחיצה על הלוגו
    secretary: '/secretary',      // להחליט לאן רוצים שהמזכירה תעבור בלחיצה על הלוגו
  };

  userRoleKey: string = '';   
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
    const current = getSelectedMembershipSync() ?? this.memberships[0] ?? null;
    this.selected = current || undefined;
    this.userRoleKey = current?.role_in_tenant || '';             
    this.userRole    = this.roleHe[this.userRoleKey] || '';        

  } catch {}
    this.farmLogoUrl = await getCurrentFarmLogoUrl();
  await this.loadLogo();   
                   

  }


  constructor(public cu: CurrentUserService, private dialog: MatDialog, private router: Router, private tokens: TokensService) {
    this.checkLogin();
  }
private async loadLogo() {
  try {
    const url = await getCurrentFarmLogoUrl();
    if (url) { this.farmLogoUrl = url; return; }
  } catch {  }

  const ctx = getCurrentFarmMetaSync();
  const currentTenantId = ctx?.id || null;
  const m = this.memberships.find(x => x.tenant_id === currentTenantId) || this.memberships[0];

  const key = m?.farm?.id || m?.tenant_id || m?.farm?.schema_name || null;
  if (key) {
    try {
      this.farmLogoUrl = await getFarmLogoUrl(key);
      return;
    } catch {}
  }
  this.farmLogoUrl = null;
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
    case 'parent':      return '/parent/children';
    case 'instructor':  return '/instructor';
    case 'secretary':   return '/secretary';
    case 'admin':       return '/admin';
    case 'manager':
    case 'coordinator': return '/ops';
    default:            return '/home';
  }
}


goHome(): void {
  if (!this.isLoggedIn) { this.router.navigate(['/login']); return; }
  const role = (this.selected?.role_in_tenant || this.userRoleKey || '').toLowerCase(); 
  const target = this.homeRoutes[role] || 'home';
  this.router.navigate([target]);
}

private makeInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2);
  const init = parts.map(p => p[0]?.toUpperCase() || '').join('');
  return init || 'F';
}
async checkLogin() {
  const user = await this.cu.loadUserDetails();
  if (!user) return;

  this.userName = user.full_name;
  this.userRole = user.role!;
  this.farmName = user.farm_name!;
  this.farmNote = 'אתר לניהול חוות';
  this.isLoggedIn = true;

  this.farmInitials = this.makeInitials(this.farmName || ''); 
  await this.loadLogo();                                      
}
async onChooseMembership(m: Membership | null) {
  if (!m) return;

  const resp = await this.cu.switchMembership(m.tenant_id, m.role_in_tenant);

  const roleKey = (resp?.role || m.role_in_tenant || '').toString().toLowerCase();

  this.selected     = m;
  this.userRoleKey  = roleKey;                       
  this.userRole     = this.roleHe[roleKey] || '';    

  const farm = getCurrentFarmMetaSync();
  this.tokens.applytokens(farm?.schema_name || 'public');

  await this.checkLogin();
  await this.loadLogo?.();

  const target = this.routeByRole(roleKey);
  await this.router.navigateByUrl(target);
}

  
}



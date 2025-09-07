
// src/app/auth/login.component.ts
import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MembershipPickerDialogComponent } from '../../core/auth/membership-picker.dialog';
import { TokensService } from '../../services/tokens.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  email = '';
  password = '';
  errorMessage = '';
  loading = false;
  private auth = inject(Auth);

  constructor(
    private router: Router,
    private cuSvc: CurrentUserService,
    private dialog: MatDialog,
    private tokens: TokensService,
    @Optional() private dialogRef?: MatDialogRef<LoginComponent>
  ) {}

  private routeByRole(role: string | null | undefined): string {
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

  async login() {
    this.errorMessage = '';
    this.loading = true;
    try {
      // 1) Firebase sign-in
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const uid = cred.user.uid;

      // 2) Hydration מלא של current-user (memberships + בחירה אוטו' אם אפשר + פרטים)
      const { selected } = await this.cuSvc.hydrateAfterLogin();

      // 3) אם אין בחירה ונמצאו כמה שיוכים — נפתח דיאלוג בחירה
      const memberships = this.cuSvc.current?.memberships || [];
      let activeRole: string | null | undefined = selected?.role_in_tenant ?? this.cuSvc.current?.role;
      let activeFarm: string | null | undefined = selected?.farm?.schema_name;

      if (!selected && memberships.length > 1) {
        const chosenTenantId = await this.dialog
          .open(MembershipPickerDialogComponent, {
            width: '420px',
            data: { memberships }
          })
          .afterClosed()
          .toPromise();

        const tenantToUse = chosenTenantId || memberships[0]?.tenant_id; // נפילה אוטו' לראשון אם נסגר בלי בחירה
        if (tenantToUse) {
          const { role, details } = await this.cuSvc.switchMembership(tenantToUse);
          activeRole = role;
        }
      }
      
      //set tokens by farm
      this.tokens.restoreLasttokens(activeFarm);

      // 4) ניווט לפי תפקיד (או '/home' אם עדיין אין)
      const target = this.routeByRole(activeRole);
      this.dialogRef?.close({ success: true, role: activeRole, target });
      await this.router.navigateByUrl(target);

    } catch (e: any) {
      console.error(e);
      this.errorMessage = e?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }
}
// src/app/auth/login.component.ts
import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { bootstrapSupabaseSession, getCurrentFarmMetaSync } from '../../services/supabaseClient';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialogRef } from '@angular/material/dialog';

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
    @Optional() private dialogRef?: MatDialogRef<LoginComponent>
  ) {}

  private routeByRole(role: string): string {
    switch (role) {
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

      // 2) Supabase bootstrap (מנפיק טוקן, קובע schema + farm)
      const boot = await bootstrapSupabaseSession();
      const role = String(boot.role_in_tenant ?? '').toLowerCase();

      // 3) עדכון current user ל-Guards ולשאר המערכת
      const farm = getCurrentFarmMetaSync(); // מכיל { id, name, schema_name } מה-bootstrap
      this.cuSvc.setCurrent({
        uid,
        role,
        // farmId: farm?.id,
        // farmName: farm?.name,
        // schema: farm?.schema_name
      });

      // 4) ניווט לפי תפקיד
      const target = this.routeByRole(role);
      this.dialogRef?.close({ success: true, role, target });
      await this.router.navigateByUrl(target);
    } catch (e: any) {
      console.error(e);
      this.errorMessage = e?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }
}

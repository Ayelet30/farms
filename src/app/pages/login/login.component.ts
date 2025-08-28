// src/app/auth/login.component.ts
import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { determineAndSetTenantByUid, getSupabaseClient } from '../../services/supabaseClient';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-login',
  standalone: true,                 // אם זה קומפוננטה standalone
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']   // ← לתקן ל־styleUrls
})
export class LoginComponent {
  email = '';
  password = '';
  errorMessage = '';
  private auth = inject(Auth);

  constructor(
    private router: Router,
    private cuSvc: CurrentUserService,
    @Optional() private dialogRef?: MatDialogRef<LoginComponent>   // אופציונלי לבטיחות
  ) {}

  private routeByRole(role: string): string {
    switch (role) {
      case 'parent': return '/parent';
      case 'instructor': return '/instructor';
      case 'secretary': return '/secretary';
      case 'admin': return '/admin';
      case 'manager':
      case 'coordinator': return '/ops';
      default: throw new Error('תפקיד לא מזוהה');
    }
  }

  async login() {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const uid = cred.user.uid;

      // 1) קובע tenant קודם
      await determineAndSetTenantByUid(uid);

      // 2) טוען role (לאחר קביעת tenant)
      const { data: userRow, error } = await getSupabaseClient()
        .from('users')
        .select('role')
        .eq('uid', uid)
        .single();
      if (error || !userRow) throw new Error('לא נמצאו נתוני משתמש');

      const role = String(userRow.role ?? '').toLowerCase();
      // 3) מעדכן משתמש נוכחי (ל־guards)
      this.cuSvc.setCurrent({ uid, role });

      // 4) יעד אחד לפי תפקיד
      const target = this.routeByRole(role);

      // 5) סוגר דיאלוג (אם רץ כדיאלוג)
      this.dialogRef?.close({ success: true, role, target });

      // 6) מנווט
      await this.router.navigateByUrl(target);

    } catch (e: any) {
      console.error(e);
      this.errorMessage = 'שגיאה: ' + (e?.message ?? e);
    }
  }
}


// src/app/auth/login.component.ts
import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TokensService } from '../../services/tokens.service';
import { sendPasswordResetEmail } from 'firebase/auth';

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
  isLoading = false;
  successMessage = '';
  private auth = inject(Auth);


  constructor(
    private router: Router,
    private cuSvc: CurrentUserService,
    private dialog: MatDialog,
    private tokens: TokensService,
    @Optional() private dialogRef?: MatDialogRef<LoginComponent>
  ) {
    (this.auth as any).languageCode = 'he';
  }

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

      console.log('selected', selected);

      // 3) אם אין בחירה ונמצאו כמה שיוכים — נפתח דיאלוג בחירה
      const memberships = this.cuSvc.current?.memberships || [];
      let activeRole: string | null | undefined = selected?.role_in_tenant ?? this.cuSvc.current?.role;
      let activeFarm: string | null | undefined = selected?.farm?.schema_name;

      //set tokens by farm
      this.tokens.restoreLasttokens(activeFarm);

      // 4) ניווט לפי תפקיד (או '/home' אם עדיין אין)
      const target = this.routeByRole(activeRole);
      this.dialogRef?.close({ success: true, role: activeRole, target });
      await this.router.navigateByUrl(target);

    } 
    catch (e: any) {
      console.error("???????????",e);
      const code = e?.code || '';
      if (code === 'auth/invalid-credential') {
        this.errorMessage = 'שם משתמש או סיסמא שגויים';
      } else if (code === 'auth/invalid-email') {
        this.errorMessage = 'כתובת דוא"ל לא תקינה.';
      } else if (code === 'auth/too-many-requests') {
        this.errorMessage = 'נחסמו ניסיונות לזמן קצר. נסה שוב מאוחר יותר.';
      } else {
        this.errorMessage = 'אירעה שגיאה בכניסה למערכת אנא פנה לתמיכה.';
        console.error(e);
      }
    } finally {
      this.isLoading = false;
    }
  
  }

  async forgotPassword(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.email) {
      this.errorMessage = 'הכנס את כתובת הדוא"ל ואז לחצי "שכחתי סיסמה".';
      return;
    }

    this.isLoading = true;
    try {
      await sendPasswordResetEmail(this.auth, this.email /*, actionCodeSettings */);
      this.successMessage = 'שלחנו קישור לאיפוס סיסמה לכתובת הדוא"ל שלך. בדקי את תיבת הדואר/ספאם.';
    } catch (e: any) {
      const code = e?.code || '';
      if (code === 'auth/invalid-credential') {
        this.errorMessage = 'לא נמצאה משתמש עם הדוא"ל הזה.';
      } else if (code === 'auth/invalid-email') {
        this.errorMessage = 'כתובת דוא"ל לא תקינה.';
      } else if (code === 'auth/too-many-requests') {
        this.errorMessage = 'נחסמו ניסיונות לזמן קצר. נסי שוב מאוחר יותר.';
      } else {
        this.errorMessage = 'אירעה שגיאה בשליחת מייל האיפוס.';
        console.error(e);
      }
    } finally {
      this.isLoading = false;
    }
  }
}

import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword, sendPasswordResetEmail, fetchSignInMethodsForEmail } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
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
  isLoading = false;
  successMessage = '';
  showPassword = false; // ← חדש: מצב הצגת סיסמה

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
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const uid = cred.user.uid;

      const { selected } = await this.cuSvc.hydrateAfterLogin();
      console.log('selected', selected);

      const memberships = this.cuSvc.current?.memberships || [];
      let activeRole: string | null | undefined = selected?.role_in_tenant ?? this.cuSvc.current?.role;
      let activeFarm: string | null | undefined = selected?.farm?.schema_name;

      this.tokens.restoreLastTokens(activeFarm);

      const target = this.routeByRole(activeRole);
      this.dialogRef?.close({ success: true, role: activeRole, target });
      await this.router.navigateByUrl(target);

    } catch (e: any) {
      const code = e?.code || '';
      if (code === 'auth/invalid-credential') {
        this.errorMessage = 'שם משתמש או סיסמא שגויים';
      } else if (code === 'auth/invalid-email') {
        this.errorMessage = 'כתובת דוא"ל לא תקינה.';
      } else if (code === 'auth/missing-password') {
        this.errorMessage = 'יש להכניס סיסמא.';
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
    // שלב 1: בדיקה אם יש בכלל משתמש עם המייל הזה
    const methods = await fetchSignInMethodsForEmail(this.auth, this.email);

    if (!methods || methods.length === 0) {
      // אין משתמש כזה → לא שולחים מייל איפוס
      this.errorMessage = 'לא נמצא משתמש עם כתובת הדוא"ל הזו.';
      return;
    }

    // שלב 2: שליחת מייל איפוס רק אם יש משתמש
    await sendPasswordResetEmail(this.auth, this.email);
    this.successMessage =
      'שלחנו קישור לאיפוס סיסמה לכתובת הדוא"ל שלך. בדוק את תיבת הדואר/ספאם.';
  } catch (e: any) {
    const code = e?.code || '';

    if (code === 'auth/user-not-found') {
      // במקרה שמשום מה מגיע מהפיירבייס עצמו
      this.errorMessage = 'לא נמצא משתמש עם כתובת הדוא"ל הזו.';
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

import { Component, inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TokensService } from '../../services/tokens.service';
import { firstValueFrom } from 'rxjs'; 

import { ResetPasswordConfirmDialogComponent } from './reset-password-confirm-dialog/reset-password-confirm-dialog.component';

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
  showPassword = false;

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
    this.errorMessage = "";
    this.successMessage = "";
    if(!this.email){
      this.errorMessage = 'יש להכניס שם משתמש';
      return;
    }
    else if(!this.password){
      this.errorMessage = 'יש להכניס סיסמא';
      return;
    }
  this.errorMessage = '';
  this.isLoading = true;   // ← מסך טעינה מתחיל

  try {
    const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
    const uid = cred.user.uid;

    const { selected } = await this.cuSvc.hydrateAfterLogin();
    console.log('selected', selected);

    const memberships = this.cuSvc.current?.memberships || [];
    let activeRole: string | null | undefined =
      selected?.role_in_tenant ?? this.cuSvc.current?.role;
    let activeFarm: string | null | undefined = selected?.farm?.schema_name;

    const target = this.routeByRole(activeRole);
    this.dialogRef?.close({ success: true, role: activeRole, target });

    // ממתינים שהניווט יסתיים לפני סיום הטעינה
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
    this.isLoading = false;   // ← הטעינה מסתיימת אחרי ניווט / שגיאה
  }
}

  async forgotPassword(): Promise<void> {
  this.errorMessage = '';
  this.successMessage = '';

  const email = (this.email || '').trim();
  if (!email) {
    this.errorMessage = 'הכנס את כתובת הדוא"ל ואז לחץ "שכחתי סיסמה".';
    return;
  }

  // שלב 1: פתיחת פופאפ אישור
  const dialogRef = this.dialog.open(ResetPasswordConfirmDialogComponent, {
    width: '360px',
    data: { email },
  });

  const confirmed = await firstValueFrom(dialogRef.afterClosed());
  if (!confirmed) {
    return; // המשתמש בחר ביטול
  }

  // שלב 2: שליחת המייל
  this.isLoading = true;

  try {
    await sendPasswordResetEmail(this.auth, email);

    // הודעת הצלחה כללית (הנכונה מבחינה אבטחתית)
    this.successMessage =
      'אם קיים במערכת משתמש עם כתובת הדוא"ל הזו - נשלח אליו קישור לאיפוס סיסמה.';
  } catch (e: any) {
    console.error('forgotPassword error:', e);
    const code = e?.code || '';

    if (code === 'auth/invalid-email') {
      this.errorMessage = 'כתובת דוא"ל לא תקינה.';
    } else if (code === 'auth/too-many-requests') {
      this.errorMessage = 'נחסמו ניסיונות לזמן קצר. נסה שוב מאוחר יותר.';
    } else {
      this.errorMessage = 'אירעה שגיאה בשליחת מייל האיפוס.';
    }
  } finally {
    this.isLoading = false;
  }
}

}

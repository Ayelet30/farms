// src/app/services/create-user.service.ts
import { Injectable } from '@angular/core';
import { Auth as AngularFireAuth } from '@angular/fire/auth';
import {
  initializeApp,
  FirebaseApp,
  getApps
} from 'firebase/app';
import {
  getAuth,
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword,
  Auth as FbAuth,
  signOut as fbSignOut
} from 'firebase/auth';
import { environment } from '../../environments/environment';
import { dbPublic } from './supabaseClient.service'; // ← חשוב לוודא שיש לך את הפונקציה הזו

@Injectable({ providedIn: 'root' })
export class CreateUserService {
  loading = false;
  errorMessage = '';

  constructor(private primaryAuth: AngularFireAuth) {}

  private secondaryApp: FirebaseApp =
    getApps().find(a => a.name === 'admin-helper') ??
    initializeApp(environment.firebase, 'admin-helper');

  private secondaryAuth: FbAuth = getAuth(this.secondaryApp);

  /** סיסמה זמנית באורך 8 תווים */
  private genTempPassword(): string {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8);
  }

  /** יצירת משתמש חדש או שליפת UID אם קיים כבר */
  async createUserIfNotExists(email: string): Promise<{ uid: string; tempPassword: string }> {
    this.errorMessage = '';
    this.loading = true;

    try {
      if (!email) throw new Error('יש להזין כתובת אימייל');
      email = email.trim().toLowerCase();

      // בדיקה אם המשתמש כבר קיים בפיירבייס
      const methods = await fetchSignInMethodsForEmail(this.secondaryAuth, email);

      if (methods?.length) {
        // משתמש כבר קיים → ננסה לשלוף את ה-UID שלו מה-Supabase
        const { data: existingUser, error } = await dbPublic()
          .from('users')
          .select('uid')
          .eq('email', email)
          .single();

        if (error || !existingUser) {
          throw new Error('משתמש קיים בפיירבייס אך לא נמצא בבסיס הנתונים.');
        }

        // נחזיר את ה-UID הקיים, בלי ליצור סיסמה חדשה
        return { uid: existingUser.uid, tempPassword: '' };
      }

      // משתמש לא קיים – ניצור חדש
      const tempPassword = this.genTempPassword();
      const cred = await createUserWithEmailAndPassword(this.secondaryAuth, email, tempPassword);
      const uid = cred.user?.uid;
      if (!uid) throw new Error('לא התקבל UID מהשרת.');

      // ננתק את הסשן המשני כדי לא לשבש את המזכירה
      await fbSignOut(this.secondaryAuth);

      return { uid, tempPassword };
    } catch (e: any) {
      const code = e?.code || '';
      if (code === 'auth/invalid-email') {
        this.errorMessage = 'כתובת דוא"ל לא תקינה.';
      } else if (code === 'auth/operation-not-allowed') {
        this.errorMessage = 'הרשמת אימייל/סיסמה אינה פעילה בפרויקט Firebase.';
      } else if (code === 'auth/weak-password') {
        this.errorMessage = 'הסיסמה חלשה מדי.';
      } else if (code === 'auth/network-request-failed') {
        this.errorMessage = 'שגיאת רשת. בדקי חיבור ונסי שוב.';
      } else {
        this.errorMessage = e?.message || 'אירעה שגיאה ביצירת המשתמש.';
      }
      throw e;
    } finally {
      this.loading = false;
    }
  }
}

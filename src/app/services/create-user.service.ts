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


  // זו השורה שיוצרת מופע Authentication משני (secondary) של Firebase Auth, שמבוסס על ה־app המשני  (secondaryApp).
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

      // 🔹 בדיקה אם כבר יש משתמש עם המייל הזה בפיירבייס
      const methods = await fetchSignInMethodsForEmail(this.secondaryAuth, email);

      if (methods?.length) {
        // 👉 משתמש כבר קיים בפיירבייס
        // מחפשים אותו בטבלת public.users לפי email
        const { data, error } = await dbPublic()
          .from('users')
          .select('uid')
          .eq('email', email)
          .maybeSingle();

        if (error || !data?.uid) {
          console.error('Firebase user exists but missing in public.users', error);
          throw new Error('משתמש עם המייל הזה כבר קיים, אבל לא נמצא בטבלת users.');
        }

        // מחזירים uid קיים, בלי סיסמה זמנית (לא שולחים מייל חדש)
        return { uid: data.uid, tempPassword: '' };
      }

      // 🔹 משתמש לא קיים → יצירה בפיירבייס עם סיסמה זמנית
      const tempPassword = this.genTempPassword();
      const cred = await createUserWithEmailAndPassword(this.secondaryAuth, email, tempPassword);
      const uid = cred.user?.uid;
      if (!uid) throw new Error('לא התקבל UID מהשרת.');

      await fbSignOut(this.secondaryAuth);

      return { uid, tempPassword };
    } catch (e: any) {
      const code = e?.code || '';

      if (code === 'auth/invalid-email') {
        this.errorMessage = 'כתובת דוא"ל לא תקינה.';
      } else if (code === 'auth/network-request-failed') {
        this.errorMessage = 'שגיאת רשת. בדקי חיבור ונסי שוב.';
      } else if (code === 'auth/email-already-in-use') {
        // תיאורטית לא אמור להגיע לפה, כי טיפלנו בזה ב-methods?.length
        this.errorMessage = 'המייל הזה כבר בשימוש במערכת.';
      } else {
        this.errorMessage = e?.message || 'אירעה שגיאה ביצירת המשתמש.';
      }

      throw e;
    } finally {
      this.loading = false;
    }
  }
  
}

// example: src/app/auth/login.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { setTenantContext, getSupabaseClient } from '../../services/supabaseClient';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { auth } from '../../core/firebase.client';




@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})export class LoginComponent {
  email = '';
  password = '';
  errorMessage = ""; 

  constructor(private router: Router) {}

  async login() {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const token = await cred.user.getIdToken(); // מביא את הטוקן מ־Firebase

      const uid = cred.user.uid;
      const supabase = getSupabaseClient(); // ✅ יוצרת את הלקוח רק כשצריך
 
      // 🟣 כאן משתמשים בשורה ששאלת עליה:
      const { data: user, error } = await supabase
        .from('users')
        .select('role')
        .eq('uid', uid)
        .single();
      console.log("AFTER1", supabase );

      if (error || !user) {
        throw new Error('לא נמצאו נתוני משתמש');
      }
      const role = user.role;

      switch (role) {
        case 'parent': this.router.navigate(['/parent']); this.dialogRef.close();
          break;
        case 'instructor': this.router.navigate(['/instructor']); this.dialogRef.close();
          break;
        case 'secretary': this.router.navigate(['/secretary']); this.dialogRef.close();
          break;
        case 'admin': this.router.navigate(['/admin']); this.dialogRef.close();
          break;
        default: throw new Error('תפקיד לא מזוהה');
      }


    } catch (err: any) {
      console.error(err);
      this.errorMessage = 'שגיאה: ' + err.message;
    }
  }
}

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Auth } from '@angular/fire/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getSupabaseClient } from '../../services/supabase.service';
import { MatDialogRef } from '@angular/material/dialog';


@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  email: string = '';
  password: string = '';
  errorMessage: string = '';

  constructor(
    private auth: Auth,
    private router: Router,
    private dialogRef: MatDialogRef<LoginComponent> // ✅ מוסיפים את זה

  ) { }

  async login() {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const uid = cred.user.uid;
      console.log("BEFORE");
      const supabase = getSupabaseClient(); // ✅ יוצרת את הלקוח רק כשצריך
      // 🟣 כאן משתמשים בשורה ששאלת עליה:
      const { data: user, error } = await supabase
        .from('users')
        .select('role')
        .eq('uid', uid)
        .single();
      console.log("AFTER1");

      if (error || !user) {
        throw new Error('לא נמצאו נתוני משתמש');
      }
      console.log("AFTER2");
      const role = user.role;
      console.log("!!!!!!!!" + role);

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

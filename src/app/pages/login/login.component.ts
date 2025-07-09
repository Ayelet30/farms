import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
    private firestore: Firestore,
    private router: Router
  ) {}

  async login() {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      const uid = cred.user.uid;

      const userSnap = await getDoc(doc(this.firestore, 'users', uid));
      const user = userSnap.data();

      if (!user) throw new Error('לא נמצאו נתוני משתמש');

      const role = user['role'];

      switch (role) {
        case 'parent': this.router.navigate(['/parent']); break;
        case 'teacher': this.router.navigate(['/teacher']); break;
        case 'secretary': this.router.navigate(['/secretary']); break;
        case 'admin': this.router.navigate(['/admin']); break;
        default: throw new Error('תפקיד לא מזוהה');
      }
    } catch (err: any) {
      console.error(err);
      this.errorMessage = 'שגיאה: ' + err.message;
    }
  }
}
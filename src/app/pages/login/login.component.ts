// example: src/app/auth/login.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { setTenantContext, getSupabaseClient, determineAndSetTenantByUid } from '../../services/supabaseClient';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { ActivatedRoute } from '@angular/router';
import { CurrentUserService } from '../../core/auth/current-user.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})

export class LoginComponent {
  email = '';
  password = '';
  errorMessage = ""; 
  dialogRef: any;
  private auth = inject(Auth);


  constructor(private router: Router,
  private route: ActivatedRoute,
  private cuSvc: CurrentUserService,
  ) {
  }

  async login() {
  try {
    const cred = await signInWithEmailAndPassword(this.auth, this.email, this.password);
    const uid = cred.user.uid;

    // שליפת role
    const { data: userRow, error } = await getSupabaseClient()
      .from('users')
      .select('role')
      .eq('uid', uid)
      .single();
    if (error || !userRow) throw new Error('לא נמצאו נתוני משתמש');

    // 👇 חובה: לקבוע tenant לפני כל קריאה ל־db()/parents...
    await determineAndSetTenantByUid(uid);

    // לעדכן את ה־CurrentUserService (כדי שה־RoleGuard לא יעיף אותך)
    this.cuSvc.setCurrent({ uid, role: String(userRow.role).toLowerCase() });

    // ניווט לפי Role
    switch (String(userRow.role).toLowerCase()) {
      case 'parent':      this.router.navigate(['/parent']); break;
      case 'instructor':  this.router.navigate(['/instructor']); break;
      case 'secretary':   this.router.navigate(['/secretary']); break;
      case 'admin':       this.router.navigate(['/admin']); break;
      case 'manager':
      case 'coordinator': this.router.navigate(['/ops']); break;
      default: throw new Error('תפקיד לא מזוהה');
    }

  } catch (e: any) {
    console.error(e);
    this.errorMessage = 'שגיאה: ' + (e?.message ?? e);
  }
}

private routeByRole(role: string) {
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
}




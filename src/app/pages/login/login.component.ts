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


    // 1) התחברות בפיירבייס
    console.log("EMAIL : " , this.email  ,"PASSWORD : " ,  this.password 
      , "!!!!!!!!!!!!!!!!!!!!"
    );
    await signInWithEmailAndPassword(auth, this.email, this.password);

    // 2) Firebase ID token
    const idToken = await auth.currentUser?.getIdToken(true);

    console.log("$$$$$$$$ ID-TOKEN" + idToken); 

    // 3) קריאה לפונקציית loginBootstrap
    const resp = await fetch('/api/login-bootstrap', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
      credentials: 'include'
    });
    if (!resp.ok) { console.error('loginBootstrap failed'); return; }
        console.log("$$$$$$$$$$$$$$$"); 

    const { access_token, farm, role_in_tenant } = await resp.json();

    // 4) מזריקים את ה-JWT ומקבלים לקוח מוצמד לסכמה של החווה
    await setTenantContext({ id: farm.id, schema: farm.schema_name, accessToken: access_token });

    // 5) ניווט לפי תפקיד
    this.router.navigate([ this.routeForRole(role_in_tenant) ]);
  }

  private routeForRole(role: string): string {
    switch (role) {
      case 'parent': return '/parent';
      case 'instructor': return '/instructor';
      case 'secretary': return '/secretary';
      default: return '/';
    }
  }
}

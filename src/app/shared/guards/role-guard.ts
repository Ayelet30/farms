import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { getSupabaseClient } from '../../services/supabaseClient';

export const RoleGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);
  const user = auth.currentUser;

  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  const uid = user.uid; // 👈 מזהה שמגיע מ־Firebase בלבד
  const requiredRole = route.data['role'];

  const supabase = getSupabaseClient();
  const { data: userData, error } = await supabase
    .from('users')
    .select('role')
    .eq('uid', uid)
    .single();

  if (error || !userData) {
    console.error('שגיאה בשליפת role מה־Supabase:', error);
    router.navigate(['/login']);
    return false;
  }

  if (userData.role === requiredRole) {
    return true;
  } else {
    router.navigate(['/login']);
    return false;
  }
};

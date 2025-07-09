import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, getAuth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

export const RoleGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);
  const firestore = inject(Firestore);
  const user = auth.currentUser;

  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  const uid = user.uid;
  const userDoc = await getDoc(doc(firestore, 'users', uid));
  const userData = userDoc.data();
  const requiredRole = route.data['role'];

  if (userData && userData['role'] === requiredRole) {
    return true;
  } else {
    router.navigate(['/login']);
    return false;
  }
};

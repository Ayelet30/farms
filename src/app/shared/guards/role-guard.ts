import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CurrentUserService } from '../../core/auth/current-user.service';

export const RoleGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const cuSvc = inject(CurrentUserService);
  const user = cuSvc.current;

  console.log(user);


  if (!user) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const required = (route.data['roles'] ?? route.data['role']) as string | string[] | undefined;

  if (!required) return true;

  const requiredRoles = Array.isArray(required) ? required : [required];
  const ok = !!user.role && requiredRoles.includes(user.role);
  return ok ? true : router.createUrlTree(['/forbidden']);
  
};

import { HttpInterceptorFn, HttpRequest, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { from, Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

export const AuthInterceptor: HttpInterceptorFn = (req, next): Observable<HttpEvent<any>> => {
  if (!req.url.startsWith('/api')) return next(req);

  const auth = inject(Auth);
  const user = auth.currentUser;
  if (!user) return next(req);

  return from(user.getIdToken(true)).pipe(
    switchMap(token =>
      next(
        req.clone({
          setHeaders: { Authorization: `Bearer ${token}` }
        })
      )
    )
  );
};

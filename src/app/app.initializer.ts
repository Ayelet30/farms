// app.initializer.ts
import { APP_INITIALIZER, Provider } from '@angular/core';
import { CurrentUserService } from './core/auth/current-user.service';

export function currentUserInitFactory(svc: CurrentUserService) {
  return () => svc.init(); // מחזיר Promise; אנגולר יחכה לו
}

export const CURRENT_USER_INIT_PROVIDER: Provider = {
  provide: APP_INITIALIZER,
  useFactory: currentUserInitFactory,
  deps: [CurrentUserService],  // <<< חשוב: הזרקה דרך deps
  multi: true,
};

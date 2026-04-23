import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

import { registerLocaleData } from '@angular/common';
import localeHe from '@angular/common/locales/he';

import { LOCALE_ID, DEFAULT_CURRENCY_CODE, isDevMode } from '@angular/core';

import './app/core/firebase.client';
import { provideAnimations } from '@angular/platform-browser/animations';

registerLocaleData(localeHe);

bootstrapApplication(App, {
  providers: [
    provideClientHydration(),
    provideAnimations(),
    { provide: LOCALE_ID, useValue: 'he' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'ILS' },
    ...appConfig.providers,
  ],
}).catch(err => console.error(err));

(() => {
  const tt = (window as any).trustedTypes;
  if (!tt?.createPolicy) return;

  try {
    tt.createPolicy('moachsites', {
      createHTML: (s: string) => s,
      createScript: (s: string) => s,
      createScriptURL: (s: string) => s,
    });
  } catch {}
})();
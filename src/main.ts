// import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
// import { appConfig } from './app/app.config';
// import { App } from './app/app';

// // יבוא חד-פעמי שמאותחל אצלך (אם רלוונטי)
// import './app/core/firebase.client';

// bootstrapApplication(App, {
//   providers: [provideClientHydration(), ...appConfig.providers],
// }).catch(err => console.error(err));

import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// ✅ לוקל עברית
import { registerLocaleData } from '@angular/common';
import localeHe from '@angular/common/locales/he';

// ✅ טוקנים גלובליים (מגדירים לוקל ומטבע ברירת מחדל)
import { LOCALE_ID, DEFAULT_CURRENCY_CODE } from '@angular/core';

// יבוא חד-פעמי שמאותחל אצלך (אם רלוונטי)
import './app/core/firebase.client';

// רישום נתוני הלוקל פעם אחת לפני ה-bootstrap
registerLocaleData(localeHe);

bootstrapApplication(App, {
  providers: [
    provideClientHydration(),
    { provide: LOCALE_ID, useValue: 'he' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'ILS' },
    ...appConfig.providers,
  ],
}).catch(err => console.error(err));

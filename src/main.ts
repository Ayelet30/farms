import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// יבוא חד-פעמי שמאותחל אצלך (אם רלוונטי)
import './app/core/firebase.client';

bootstrapApplication(App, {
  providers: [provideClientHydration(), ...appConfig.providers],
}).catch(err => console.error(err));

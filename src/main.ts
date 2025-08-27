// src/main.ts
import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// 🔹 יבוא חד-פעמי שמבטיח שיש Firebase App מאותחל
import './app/core/firebase.client';

bootstrapApplication(App, {
  providers: [provideClientHydration(), ...appConfig.providers]
}).catch(err => console.error(err));

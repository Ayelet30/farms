import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { importProvidersFrom } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { appConfig } from './app/app.config';
import { App } from './app/app';

import './app/core/firebase.client';

bootstrapApplication(App, {
  providers: [
    provideClientHydration(),                
    importProvidersFrom(BrowserAnimationsModule),
    ...appConfig.providers,               
  ],
}).catch(err => console.error(err));

import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, {
  providers: [provideClientHydration(), ...appConfig.providers]
}).catch(err => console.error(err));



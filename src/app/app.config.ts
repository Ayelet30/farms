import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, LOCALE_ID } from '@angular/core';
import { provideRouter } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { routes } from './app.routes';

import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';

import { environment } from '../environments/environment';
import { CalendarModule, DateAdapter } from 'angular-calendar';
import { adapterFactory } from 'angular-calendar/date-adapters/date-fns';

import { CURRENT_USER_INIT_PROVIDER } from './app.initializer';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AuthInterceptor } from './core/http/auth.interceptor'; // תיקון נתיב

// 🔹 Supabase
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from './core/supabase.token';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([AuthInterceptor])),

    // ✅ Firebase (Modular)
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),

    // ✅ Supabase – Provider גלובלי
    {
      provide: SUPABASE,
      useFactory: (): SupabaseClient =>
        createClient(
          environment.supabaseUrl,
          environment.supabaseAnonKey,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
            },
          }
        ),
    },
    {provide: LOCALE_ID, useValue: 'he-IL' },

    // אתחול משתמש קיים אצלך
    CURRENT_USER_INIT_PROVIDER,

    // מודולים נוספים
    importProvidersFrom(
      FormsModule,
      CalendarModule.forRoot({
        provide: DateAdapter,
        useFactory: adapterFactory,
      })
    ),
  ],
};

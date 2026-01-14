import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// AngularFire Auth (mock)
import { Auth } from '@angular/fire/auth';

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

const authStub: Partial<Auth> = {
  currentUser: Promise.resolve(null),
  onAuthStateChanged: (cb: any) => {
    cb(null);
    return () => {};
  },
} as any;

// "גלובלי" לכל הטסטים – נרשם ל-root injector
beforeEach(() => {
  getTestBed().configureTestingModule({
    providers: [{ provide: Auth, useValue: authStub }],
  });
});

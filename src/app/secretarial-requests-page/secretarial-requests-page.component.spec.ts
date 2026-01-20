import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretarialRequestsPageComponent } from './secretarial-requests-page.component';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { environment } from '../../environments/environment';

describe('SecretarialRequestsPage', () => {
  let component: SecretarialRequestsPageComponent;
  let fixture: ComponentFixture<SecretarialRequestsPageComponent>;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();

    fixture = TestBed.createComponent(SecretarialRequestsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

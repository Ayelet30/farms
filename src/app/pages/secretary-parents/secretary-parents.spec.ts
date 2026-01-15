import { ComponentFixture, TestBed } from '@angular/core/testing';

import {SecretaryParentsComponent} from './secretary-parents';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { environment } from '../../../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';

describe('SecretaryParents', () => {
  let component: SecretaryParentsComponent;
  let fixture: ComponentFixture<SecretaryParentsComponent>;

 beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();

    fixture = TestBed.createComponent(SecretaryParentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

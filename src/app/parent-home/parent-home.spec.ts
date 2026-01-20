import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentHomeComponent } from './parent-home';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { environment } from '../../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';

describe('ParentHome', () => {
  let component: ParentHomeComponent;
  let fixture: ComponentFixture<ParentHomeComponent>;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();

    fixture = TestBed.createComponent(ParentHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

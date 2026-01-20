import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentDetailsComponent } from './parent-details';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { environment } from '../../../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';

describe('ParentDetails', () => {
  let component: ParentDetailsComponent;
  let fixture: ComponentFixture<ParentDetailsComponent>;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();

    fixture = TestBed.createComponent(ParentDetailsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

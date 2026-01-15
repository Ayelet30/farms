import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentMessagesComponent } from './parent-messages';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { environment } from '../../../../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';

describe('ParentMessage', () => {
  let component: ParentMessagesComponent;
  let fixture: ComponentFixture<ParentMessagesComponent>;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();

    fixture = TestBed.createComponent(ParentMessagesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

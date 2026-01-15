import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SliderComponent  } from './slider';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';

describe('Slider', () => {
  let component: SliderComponent ;
  let fixture: ComponentFixture<SliderComponent >;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
    ],
  }).compileComponents();
  fixture = TestBed.createComponent(SliderComponent );
    component = fixture.componentInstance;
    fixture.detectChanges();
});

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

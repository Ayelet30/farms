import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookingComponent } from './booking.component';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { environment } from '../../../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

describe('BookingComponent', () => {
  let component: BookingComponent;
  let fixture: ComponentFixture<BookingComponent>;

  beforeEach(async () => {
  await TestBed.configureTestingModule({
   providers: [
  {
    provide: ActivatedRoute,
    useValue: {
      params: of({}),
      queryParams: of({}),
      snapshot: { params: {}, queryParams: {}, data: {} },
    },
  },
],
  }).compileComponents();

    fixture = TestBed.createComponent(BookingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

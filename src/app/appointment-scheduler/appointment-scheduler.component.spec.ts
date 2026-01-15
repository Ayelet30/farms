import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppointmentSchedulerComponent } from './appointment-scheduler.component';
import { Auth } from '@angular/fire/auth';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

const activatedRouteMock = {
  snapshot: {
    paramMap: { get: (_: string) => null },
    queryParamMap: { get: (_: string) => null },
    data: {},
  },
  params: of({}),
  queryParams: of({}),
  paramMap: of(new Map()),
  queryParamMap: of(new Map()),
  data: of({}),
};


describe('AppointmentScheduler', () => {
  let component: AppointmentSchedulerComponent;
  let fixture: ComponentFixture<AppointmentSchedulerComponent>;

  const authMock = {
  currentUser: null,
  onAuthStateChanged: (_: any) => () => {},
  signOut: () => Promise.resolve(),
};

beforeEach(async () => {
await TestBed.configureTestingModule({
  imports: [AppointmentSchedulerComponent],
  providers: [
    { provide: ActivatedRoute, useValue: activatedRouteMock },
    { provide: Auth, useValue: authMock }
  ],
}).compileComponents();

    fixture = TestBed.createComponent(AppointmentSchedulerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});


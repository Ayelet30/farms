import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppointmentSchedulerComponent } from './appointment-scheduler.component';

describe('AppointmentScheduler', () => {
  let component: AppointmentSchedulerComponent;
  let fixture: ComponentFixture<AppointmentSchedulerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppointmentSchedulerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AppointmentSchedulerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // it('should create', () => {
  //   expect(component).toBeTruthy();
  // });
});
function expect(component: AppointmentSchedulerComponent) {
  throw new Error('Function not implemented.');
}


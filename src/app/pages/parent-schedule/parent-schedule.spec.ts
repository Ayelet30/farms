import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentScheduleComponent } from './parent-schedule';

describe('ParentSchedule', () => {
  let component: ParentScheduleComponent;
  let fixture: ComponentFixture<ParentScheduleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentScheduleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentScheduleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

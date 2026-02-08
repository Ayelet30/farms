import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RequestMakeupLessonDetailsComponent } from './request-makeup-lesson-details.component';

describe('RequestMakeupLessonDetails', () => {
  let component: RequestMakeupLessonDetailsComponent;
  let fixture: ComponentFixture<RequestMakeupLessonDetailsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequestMakeupLessonDetailsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RequestMakeupLessonDetailsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

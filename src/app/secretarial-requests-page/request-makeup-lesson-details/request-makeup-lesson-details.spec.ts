import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RequestMakeupLessonDetails } from './request-makeup-lesson-details';

describe('RequestMakeupLessonDetails', () => {
  let component: RequestMakeupLessonDetails;
  let fixture: ComponentFixture<RequestMakeupLessonDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequestMakeupLessonDetails]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RequestMakeupLessonDetails);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

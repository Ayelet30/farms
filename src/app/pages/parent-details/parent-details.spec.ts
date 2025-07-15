import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentDetails } from './parent-details';

describe('ParentDetails', () => {
  let component: ParentDetails;
  let fixture: ComponentFixture<ParentDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentDetails]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentDetails);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

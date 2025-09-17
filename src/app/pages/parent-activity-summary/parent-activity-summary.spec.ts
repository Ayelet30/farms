import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentActivitySummaryComponent } from './parent-activity-summary';

describe('ParentActivitySummary', () => {
  let component: ParentActivitySummaryComponent;
  let fixture: ComponentFixture<ParentActivitySummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentActivitySummaryComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentActivitySummaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthlySummary } from './monthly-summary';

describe('MonthlySummary', () => {
  let component: MonthlySummary;
  let fixture: ComponentFixture<MonthlySummary>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlySummary]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthlySummary);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

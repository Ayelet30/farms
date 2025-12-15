import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MonthlySummaryComponent } from './monthly-summary';


describe('MonthlySummary', () => {
  let component: MonthlySummaryComponent;
  let fixture: ComponentFixture<MonthlySummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlySummaryComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthlySummaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

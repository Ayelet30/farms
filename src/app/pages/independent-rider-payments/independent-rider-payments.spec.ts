import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IndependentRiderPayments } from './independent-rider-payments';

describe('IndependentRiderPayments', () => {
  let component: IndependentRiderPayments;
  let fixture: ComponentFixture<IndependentRiderPayments>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IndependentRiderPayments]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IndependentRiderPayments);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

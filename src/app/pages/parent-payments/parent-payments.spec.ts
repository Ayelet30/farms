import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentPayments } from './parent-payments.component';

describe('ParentPayments', () => {
  let component: ParentPayments;
  let fixture: ComponentFixture<ParentPayments>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentPayments]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentPayments);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

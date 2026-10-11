import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminBilling } from './admin-billing';

describe('AdminBilling', () => {
  let component: AdminBilling;
  let fixture: ComponentFixture<AdminBilling>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminBilling]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AdminBilling);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

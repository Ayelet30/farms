import { TestBed } from '@angular/core/testing';

import { AdminBilling } from './admin-billing';

describe('AdminBilling', () => {
  let service: AdminBilling;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AdminBilling);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

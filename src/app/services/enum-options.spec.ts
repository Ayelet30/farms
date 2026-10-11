import { TestBed } from '@angular/core/testing';

import { EnumOptions } from './enum-options';

describe('EnumOptions', () => {
  let service: EnumOptions;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnumOptions);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

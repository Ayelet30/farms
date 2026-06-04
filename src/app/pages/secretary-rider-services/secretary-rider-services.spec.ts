import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretaryRiderServices } from './secretary-rider-services';

describe('SecretaryRiderServices', () => {
  let component: SecretaryRiderServices;
  let fixture: ComponentFixture<SecretaryRiderServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryRiderServices]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretaryRiderServices);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

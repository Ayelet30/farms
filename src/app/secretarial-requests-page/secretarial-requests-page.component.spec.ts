import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretarialRequestsPage } from './secretarial-requests-page';

describe('SecretarialRequestsPage', () => {
  let component: SecretarialRequestsPage;
  let fixture: ComponentFixture<SecretarialRequestsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretarialRequestsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretarialRequestsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

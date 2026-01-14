import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretarialRequestsPageComponent } from './secretarial-requests-page.component';

describe('SecretarialRequestsPage', () => {
  let component: SecretarialRequestsPageComponent;
  let fixture: ComponentFixture<SecretarialRequestsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretarialRequestsPageComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretarialRequestsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClaimsPage } from './claims-page';

describe('ClaimsPage', () => {
  let component: ClaimsPage;
  let fixture: ComponentFixture<ClaimsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClaimsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

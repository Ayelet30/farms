import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgreementsAdminComponent } from './agreements-admin.component';

describe('AgreementsAdminComponent', () => {
  let component: AgreementsAdminComponent;
  let fixture: ComponentFixture<AgreementsAdminComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgreementsAdminComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AgreementsAdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

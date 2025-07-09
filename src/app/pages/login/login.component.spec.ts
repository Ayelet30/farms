import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoginComponen } from './login.component';

describe('LoginComponen', () => {
  let component: LoginComponen;
  let fixture: ComponentFixture<LoginComponen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponen]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoginComponen);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

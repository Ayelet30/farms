import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LogoutConfirmationComponent } from './logout-confirmation';

describe('LogoutConfirmation', () => {
  let component: LogoutConfirmationComponent;
  let fixture: ComponentFixture<LogoutConfirmationComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogoutConfirmationComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LogoutConfirmationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// src/app/your-path/logout-confirmation/logout-confirmation.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';

import { LogoutConfirmationComponent } from './logout-confirmation';

describe('LogoutConfirmationComponent', () => {
  let fixture: ComponentFixture<LogoutConfirmationComponent>;
  let component: LogoutConfirmationComponent;

  const dialogRefSpy = jasmine.createSpyObj<MatDialogRef<LogoutConfirmationComponent>>(
    'MatDialogRef',
    ['close']
  );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogoutConfirmationComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LogoutConfirmationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    dialogRefSpy.close.calls.reset();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should inject MatDialogRef', () => {
    expect(component.dialogRef).toBe(dialogRefSpy as any);
  });

  it('confirmLogout should close dialog with true', () => {
    component.confirmLogout();
    expect(dialogRefSpy.close).toHaveBeenCalledOnceWith(true);
  });

  it('cancel should close dialog with false', () => {
    component.cancel();
    expect(dialogRefSpy.close).toHaveBeenCalledOnceWith(false);
  });

  it('should not auto-close on init', () => {
    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });
});

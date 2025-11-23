import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  standalone: true,
  selector: 'app-reset-password-confirm-dialog',
  templateUrl: './reset-password-confirm-dialog.component.html',
  styleUrls: ['./reset-password-confirm-dialog.component.scss'],
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
})
export class ResetPasswordConfirmDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<ResetPasswordConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { email: string }
  ) {}

  onCancel() {
    this.dialogRef.close(false);
  }

  onConfirm() {
    this.dialogRef.close(true);
  }
}

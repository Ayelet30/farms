import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-logout-confirmation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './logout-confirmation.html',
  styleUrls: ['./logout-confirmation.scss']
})
export class LogoutConfirmationComponent {
  constructor(public dialogRef: MatDialogRef<LogoutConfirmationComponent>) {}

  confirmLogout() {
    this.dialogRef.close(true);
  }

  cancel() {
    this.dialogRef.close(false);
  }
}

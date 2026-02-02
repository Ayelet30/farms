import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';


type ConfirmDialogData = {
  title?: string;
  message?: string;
};

@Component({
  standalone: true,
  selector: 'app-confirm-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <div dir="rtl">
<h3 class="title">{{ data.title || 'אישור' }}</h3>
      <p class="msg">{{ data.message || 'האם להמשיך?' }}</p>

      <div class="actions">
        <button mat-button class="btn-cancel" type="button" (click)="close(false)">
          לא
        </button>

        <button mat-raised-button class="btn-ok" type="button" (click)="close(true)">
          כן
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  private ref = inject(MatDialogRef<ConfirmDialogComponent>);
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  close(v: boolean) {
    this.ref.close(v);
  }
}

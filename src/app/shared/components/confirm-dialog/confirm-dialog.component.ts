import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule],
  template: `
  <div dir="rtl" class="dlg">
    <h3 class="title">{{ data.title }}</h3>
    <p class="msg">{{ data.message }}</p>

    <div class="actions">
    <button
  mat-button
  class="btn-cancel"
  *ngIf="data.showCancel"
  (click)="close(false)"
>
  {{ data.cancelText }}
</button>

<button
  mat-flat-button
  class="btn-ok"
  (click)="close(true)"
>
  {{ data.okText }}
</button>

    </div>
  </div>
  `,
  styles: [`
    .dlg { padding: 10px 6px; }
    .title { margin: 0 0 10px; font-weight: 800; }
    .msg { margin: 0 0 16px; line-height: 1.4; font-weight: 600; }
    .actions { display:flex; gap:8px; justify-content:flex-end; }
  `],
})
export class ConfirmDialogComponent {
  constructor(
    private ref: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}
  close(v: boolean) { this.ref.close(v); }
}

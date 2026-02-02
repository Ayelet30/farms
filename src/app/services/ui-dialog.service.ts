import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

export type UiConfirmOptions = {
  title: string;
  message: string;
  okText?: string;
  cancelText?: string;
  showCancel?: boolean; // ברירת מחדל true
};

@Injectable({ providedIn: 'root' })
export class UiDialogService {
  private dialog = inject(MatDialog);

  async alert(message: string, title = 'הודעה'): Promise<void> {
    await this.confirm({
      title,
      message,
      okText: 'אישור',
      showCancel: false,
    });
  }

  async confirm(opts: UiConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
     panelClass: 'ui-confirm-dialog',
     backdropClass: 'ui-backdrop',      
      data: {
        title: opts.title,
        message: opts.message,
        okText: opts.okText ?? 'אישור',
        cancelText: opts.cancelText ?? 'ביטול',
        showCancel: opts.showCancel ?? true,
      },
    });

    const result = await firstValueFrom(ref.afterClosed());
    return !!result;
  }
}

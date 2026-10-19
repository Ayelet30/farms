import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';


export type UiConfirmOptions = {
  title: string;
  message: string;
  okText?: string;
  dangerText?: string;
  cancelText?: string;
  showCancel?: boolean;

  // מיקום בתור - רק להודעות שמירה של רשימת המתנה
  queuePosition?: {
    priority: number;
    priorityPosition: number;
    overallPosition: number;
  };
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
    // בדיקת מצב התפריט הצדדי
    const layout = document.querySelector('.body-layout');

    const sidebarWidth = layout
      ? layout.classList.contains('menu-collapsed')
        ? 72
        : 280
      : 0;

    // חישוב מרכז אזור התוכן ללא התפריט
    const contentWidth = window.innerWidth - sidebarWidth;
    const dialogWidth = Math.min(420, window.innerWidth - 32);
    const dialogLeft = Math.max(
      0,
      (contentWidth - dialogWidth) / 2
    );

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      maxWidth: 'calc(100vw - 32px)',
      disableClose: true,
      panelClass: 'ui-confirm-dialog',
      backdropClass: 'ui-backdrop',

      // מיקום ביחס לאזור התוכן
      position: {
        left: `${dialogLeft}px`,
      },


      data: {
        title: opts.title,
        message: opts.message,
        okText: opts.okText ?? 'אישור',
        dangerText: opts.dangerText,
        cancelText: opts.cancelText ?? 'ביטול',
        showCancel: opts.showCancel ?? true,
        queuePosition: opts.queuePosition,
      },

    });



    const result = await firstValueFrom(ref.afterClosed());
    return !!result;
  }

}

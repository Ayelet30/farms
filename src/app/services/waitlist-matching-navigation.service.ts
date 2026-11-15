import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UiDialogService } from './ui-dialog.service';

@Injectable({ providedIn: 'root' })
export class WaitlistMatchingNavigationService {
  private readonly router = inject(Router);
  private readonly ui = inject(UiDialogService);

  async offerSearch(successMessage?: string): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: 'חיפוש התאמות',
            message: successMessage
        ? `${successMessage}\n\nלחפש התאמות לילדים אחרים מרשימת ההמתנה?`
        : 'לחפש התאמות לילדים אחרים מרשימת ההמתנה?',
      okText: 'כן, חפשי התאמות',
      cancelText: 'לא',
      showCancel: true,
    });

    if (!confirmed) return;

    await this.router.navigate(['/secretary', 'waitlist'], {
      queryParams: { searchMatches: '1' },
    });
  }
}
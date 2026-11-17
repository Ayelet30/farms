import { A11yModule } from '@angular/cdk/a11y';
import {
  Component, DestroyRef, EventEmitter, Injector, Input, Output,
  afterNextRender, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatchingBookingService } from '../../../services/matching-booking.service';
import type { WeeklyMatchingCandidate } from '../../../services/matching.service';
import { UiDialogService } from '../../../services/ui-dialog.service';
import {
  RequestMatchingDialogComponent,
  RequestMatchingDialogData
} from './request-matching-dialog.component';

@Component({
  selector: 'app-request-matching-dialog-host',
  standalone: true,
  imports: [A11yModule, RequestMatchingDialogComponent],
  template: `
    <div
      class="matching-backdrop"
      [class.wl-booking-flow-open]="bookingOpen()"
      [attr.inert]="bookingOpen() ? '' : null"
      (click)="closed.emit()">

      <div
        class="matching-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-matching-title"
        [cdkTrapFocus]="!bookingOpen()"
        [cdkTrapFocusAutoCapture]="true"
        (click)="$event.stopPropagation()"
        (keydown.escape)="$event.stopPropagation(); closed.emit()">

        <app-request-matching-dialog
          [data]="data"
          (closed)="closed.emit()"
          (bookingRequested)="book($event)">
        </app-request-matching-dialog>
      </div>
    </div>
  `,
  styles: [`
    .matching-backdrop {
      position: fixed;
      inset: 92px 0 0;
      z-index: 30000;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 16px 20px;
      overflow: hidden;
    }

    .matching-backdrop::before {
      content: '';
      position: fixed;
      inset: 0;
      z-index: -1;
      background: rgba(31, 41, 27, 0.42);
      pointer-events: none;
    }

    :host-context(.body-layout:not(.menu-collapsed)) .matching-backdrop {
      right: 280px;
    }

    :host-context(.body-layout.menu-collapsed) .matching-backdrop {
      right: 72px;
    }

    .matching-modal {
      display: flex;
      flex-direction: column;
      width: min(760px, 100%);
      max-height: 100%;
      min-height: 0;
      box-sizing: border-box;
      overflow: hidden;
      direction: rtl;
      background: #fffdf8;
      border: 1px solid #d5dcc1;
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }

    @media (max-width: 700px) {
      :host-context(.body-layout:not(.menu-collapsed)) .matching-backdrop,
      :host-context(.body-layout.menu-collapsed) .matching-backdrop {
        right: 0;
      }
    }
  `]
})
export class RequestMatchingDialogHostComponent {
  @Input({ required: true }) data!: RequestMatchingDialogData;
  @Input({ required: true }) childId!: string;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly bookingSaved = new EventEmitter<void>();

  private readonly booking = inject(MatchingBookingService);
  private readonly ui = inject(UiDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly bookingOpen = signal(false);

  book(event: {
    candidate: WeeklyMatchingCandidate;
    button: HTMLButtonElement;
  }): void {
    const { candidate, button } = event;

    if (
      this.bookingOpen() ||
      candidate.request_source !== 'internal' ||
      candidate.request_id !== this.data.requestId
    ) {
      return;
    }

    const instructorName = this.data.instructors.find(
      instructor => instructor.id_number === candidate.instructor_id
    )?.name ?? candidate.instructor_id;

    this.bookingOpen.set(true);

    this.booking.open(candidate, this.childId, instructorName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: saved => {
          this.bookingOpen.set(false);

          if (saved) {
            this.bookingSaved.emit();
            this.closed.emit();
          } else {
            afterNextRender(() => button.focus(), { injector: this.injector });
          }
        },
        error: async () => {
          try {
            await this.ui.alert(
              'לא ניתן היה לפתוח את חלון השיבוץ.',
              'פתיחת שיבוץ'
            );
          } finally {
            this.bookingOpen.set(false);
          }
        }
      });
  }
}
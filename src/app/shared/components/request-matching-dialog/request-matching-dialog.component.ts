import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, EventEmitter, Input, Output } from '@angular/core';
import {
    MatchingService,
    SavedRequestMatchingRun,
    WeeklyMatchingCandidate
} from '../../../services/matching.service';

export interface RequestMatchingDialogData {
    requestId: string;
    childName: string;
    instructors: { id_number: string; name: string }[];
}

@Component({
    selector: 'app-request-matching-dialog',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './request-matching-dialog.component.html',
    styleUrls: ['./request-matching-dialog.component.scss']

})
export class RequestMatchingDialogComponent implements OnInit {
    @Input({ required: true }) data!: RequestMatchingDialogData;
    @Output() readonly closed = new EventEmitter<void>();
    @Output() readonly bookingRequested = new EventEmitter<{
        candidate: WeeklyMatchingCandidate;
        button: HTMLButtonElement;
    }>();
    private readonly matchingService = inject(MatchingService);

    readonly run = signal<SavedRequestMatchingRun | null>(null);
    readonly selectedCandidate = signal<WeeklyMatchingCandidate | null>(null);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    ngOnInit(): void {
        void this.loadRun(false);
    }

    async loadRun(searchAgain: boolean): Promise<void> {
        if (this.loading()) return;

        this.loading.set(true);
        this.error.set(null);

        try {
            await this.matchingService.loadFarmTimezone();
            const savedRun = searchAgain
                ? null
                : await this.matchingService.loadLatestRequestRun(this.data.requestId);

            const run = savedRun
                ?? await this.matchingService.searchAndSaveRequestRun(this.data.requestId);

            this.run.set(run);
            this.selectedCandidate.set(null);
        } catch (error: unknown) {
            const message =
                typeof error === 'object' && error !== null && 'message' in error
                    ? error.message
                    : null;

            this.error.set(
                typeof message === 'string' && message
                    ? message
                    : 'לא ניתן לטעון את ההתאמות. אפשר לנסות שוב.'
            );
        } finally {
            this.loading.set(false);
        }
    }

    isExpired(startDate: string, startTime: string): boolean {
  return this.matchingService.isExpired(startDate, startTime);
}

    dayName(day: number): string {
        return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][day]
            ?? String(day);
    }

    instructorName(instructorId: string): string {
        return this.data.instructors.find(instructor => instructor.id_number === instructorId)?.name
            ?? instructorId;
    }
}
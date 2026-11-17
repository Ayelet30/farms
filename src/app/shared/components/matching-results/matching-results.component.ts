import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  inject,
  EventEmitter,
  Output,
  signal,
  HostListener
} from '@angular/core';
import { Subscription } from 'rxjs';
import { MatchingBookingService } from '../../../services/matching-booking.service';
import { CommonModule } from '@angular/common';
import {
  MatchingService,
  WeeklyMatchingCandidate
} from '../../../services/matching.service';
import { ExternalWaitlistRequest } from '../../../services/waitlist.service';
import { UiDialogService } from '../../../services/ui-dialog.service';
import { WaitlistEntry } from '../../../Types/waitlist.types';
import { QuickAppointmentComponent } from '../../../pages/schedule/secretary-schedule/quick-appointment/quick-appointment.component';
interface MatchingSlot {
  key: string;
  dayOfWeek: number;
  instructorId: string;
  startTime: string;
  endTime: string;
  ridingType: string;
  slotKind: 'existing_group' | 'new_slot';
  firstDate: string;
  participants: WeeklyMatchingCandidate['group_participants'];
  candidates: WeeklyMatchingCandidate[];
}

@Component({
  selector: 'app-matching-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './matching-results.component.html',
  styleUrls: ['./matching-results.component.scss']
})
export class MatchingResultsComponent implements OnChanges, OnDestroy {
  @Input() searchVersion = 0;
  @Input() active = false;
  @Input() internalEntries: WaitlistEntry[] = [];
  @Input() externalEntries: ExternalWaitlistRequest[] = [];
  @Input() childNamesById: Record<string, string> = {};
  @Input() instructors: { id_number: string; name: string }[] = [];
  @Input() priorityQueuePositions: Record<string, number> = {};
  @Output() bookingSaved = new EventEmitter<void>();

  private readonly matchingService = inject(MatchingService);
  private readonly ui = inject(UiDialogService);
  private readonly matchingBooking = inject(MatchingBookingService);
  private bookingSubscription: Subscription | null = null;



  private searchSequence = 0;
  private searchPending = false;

  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly error = signal<string | null>(null);
  readonly results = signal<WeeklyMatchingCandidate[]>([]);
  readonly expandedSlotKey = signal<string | null>(null);
  readonly searchText = signal('');
  readonly childSearchText = signal('');
  private readonly bookingListsRevision = signal(0);
  readonly selectedDay = signal('all');
  readonly selectedKind = signal('all');
  readonly lastRunAt = signal<string | null>(null);
  readonly searching = signal(false);
  readonly showLoadingPanel = signal(false);

  readonly slots = computed<MatchingSlot[]>(() => {
    const grouped = new Map<string, MatchingSlot>();

    this.bookingListsRevision();

    const activeInternalIds = new Set(
      this.internalEntries
        .filter(entry => entry.status === 'active')
        .map(entry => entry.id)
    );

    const openExternalIds = new Set(
      this.externalEntries
        .filter(entry => entry.status === 'open')
        .map(entry => entry.id)
    );

    for (const candidate of this.results()) {
      if (!candidate.is_viable_candidate) continue;
      const eligibleRequestIds = candidate.request_source === 'external'
        ? openExternalIds
        : activeInternalIds;

      if (!eligibleRequestIds.has(candidate.request_id)) continue;

      const key = [
        candidate.series_start_date,
        candidate.day_of_week,
        candidate.instructor_id,
        candidate.start_time,
        candidate.end_time,
        candidate.riding_type_id,
        candidate.initial_slot_kind
      ].join('|');

      let slot = grouped.get(key);
      if (!slot) {
        slot = {
          key,
          dayOfWeek: candidate.day_of_week,
          instructorId: candidate.instructor_id,
          startTime: candidate.start_time,
          endTime: candidate.end_time,
          ridingType: candidate.riding_type,
          slotKind: candidate.initial_slot_kind,
          firstDate: candidate.series_start_date,
          participants: candidate.group_participants ?? [],
          candidates: []
        };
        grouped.set(key, slot);
      }
      slot.candidates.push(candidate);
    }

    for (const slot of grouped.values()) {
      slot.candidates.sort((a, b) =>
        b.priority - a.priority ||
        (this.queuePosition(a) ?? Number.MAX_SAFE_INTEGER) -
        (this.queuePosition(b) ?? Number.MAX_SAFE_INTEGER)
      );
    }

    return [...grouped.values()].sort((a, b) =>
      a.firstDate.localeCompare(b.firstDate) ||
      a.startTime.localeCompare(b.startTime) ||
      a.instructorId.localeCompare(b.instructorId)
    );
  });

  readonly filteredSlots = computed(() => {
    const text = this.searchText().trim().toLocaleLowerCase();
    const day = this.selectedDay();
    const kind = this.selectedKind();
    const searchingByChild = this.childSearchText().trim().length > 0;

    return this.slots().filter(slot => {
      if (day !== 'all' && slot.dayOfWeek !== Number(day)) return false;
      if (kind !== 'all' && slot.slotKind !== kind) return false;

      if (searchingByChild && !slot.candidates.some(candidate => this.matchesChildSearch(candidate))) {
        return false;
      }

      if (!text) return true;

      return [
        this.instructorName(slot.instructorId),
        slot.ridingType,
        this.dayName(slot.dayOfWeek),
        slot.startTime,
        slot.endTime,
        slot.firstDate
      ].some(value => value.toLocaleLowerCase().includes(text));
    });
  });

  readonly selectedSlot = computed(() =>
    this.filteredSlots().find(slot => slot.key === this.expandedSlotKey()) ?? null
  );

  readonly hasFilters = computed(() =>
    !!this.childSearchText().trim() ||
    !!this.searchText().trim() ||
    this.selectedDay() !== 'all' ||
    this.selectedKind() !== 'all'

  );


  async openMatchingBooking(candidate: WeeklyMatchingCandidate): Promise<void> {
    const slot = this.selectedSlot();

    if (!slot?.candidates.includes(candidate) ||
      (this.bookingSubscription && !this.bookingSubscription.closed)) {
      return;
    }

    if (candidate.request_source === 'external') {
      await this.ui.alert(
        'יש להוסיף את הילד/ה למערכת לפני ביצוע השיבוץ.',
        'נדרש רישום ילד/ה'
      );
      return;
    }

    const request = this.internalEntries.find(entry => entry.id === candidate.request_id);

    if (!request?.child_uuid) {
      await this.ui.alert(
        'פרטי הילד/ה אינם זמינים. רענני את רשימת ההמתנה ונסי שוב.',
        'לא ניתן לפתוח שיבוץ'
      );
      return;
    }

    this.bookingSubscription = this.matchingBooking.open(
      candidate,
      request.child_uuid,
      this.instructorName(candidate.instructor_id)
    ).subscribe({
      next: saved => {
        if (!saved) return;

        this.results.update(results =>
          results.filter(result =>
            result.request_source !== 'internal' ||
            result.request_id !== candidate.request_id
          )
        );

        this.bookingSaved.emit();
        void this.search();
      },
      error: () => {
        void this.ui.alert('לא ניתן היה לפתוח את חלון השיבוץ.', 'פתיחת שיבוץ');
      }
    });
  }

  ngOnDestroy(): void {
    this.searchPending = false;
    this.bookingSubscription?.unsubscribe();
  }

  toggleSlot(slotKey: string): void {
    this.expandedSlotKey.update(current => current === slotKey ? null : slotKey);
  }

  closeSlot(): void {
    this.expandedSlotKey.set(null);
  }

  clearFilters(): void {
    this.searchText.set('');
    this.selectedDay.set('all');
    this.selectedKind.set('all');
    this.childSearchText.set('');
  }

  @HostListener('window:focus')
reloadLatestRunOnFocus(): void {
  if (this.active && !this.loading() && !this.searching()) {
    void this.loadRun(false);
  }
}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['internalEntries']) {
  const pausedRequestIds = new Set(
    this.internalEntries
      .filter(entry => entry.status === 'paused')
      .map(entry => entry.id)
  );

  if (pausedRequestIds.size > 0) {
    this.results.update(results =>
      results.filter(candidate =>
        candidate.request_source !== 'internal' ||
        !pausedRequestIds.has(candidate.request_id)
      )
    );
  }
}
    if (
      changes['internalEntries'] ||
      changes['externalEntries'] ||
      changes['childNamesById'] ||
      changes['priorityQueuePositions'] ||
      changes['instructors']
    ) {
      this.bookingListsRevision.update(revision => revision + 1);
    }
    if (changes['active']?.previousValue === true && !this.active) {
      this.clearFilters();
      this.closeSlot();
      return;
    }
    if (changes['searchVersion'] && this.searchVersion > 0) {
  void this.search(true);
  return;
}

    if (changes['active'] && this.active && !this.searching()) {
      void this.loadRun(false);
    }
  }

  async search(queueIfBusy = false): Promise<void> {
  if (this.searching()) {
    if (queueIfBusy) this.searchPending = true;
    return;
  }

  do {
    this.searchPending = false;
    this.closeSlot();
    await this.loadRun(true);
  } while (this.searchPending);
}

  private async loadRun(runNewSearch: boolean): Promise<void> {
    const sequence = ++this.searchSequence;

    this.loading.set(true);
    this.searching.set(runNewSearch);
    this.error.set(null);

    this.showLoadingPanel.set(runNewSearch);

    const loadingTimer = runNewSearch
      ? undefined
      : setTimeout(() => {
        if (sequence === this.searchSequence && this.loading()) {
          this.showLoadingPanel.set(true);
        }
      }, 250);

    try {
      await this.matchingService.loadFarmTimezone();
      const run = runNewSearch
        ? await this.matchingService.searchAndSaveRun()
        : await this.matchingService.loadLatestRun();

      if (sequence !== this.searchSequence) return;

      this.results.set(run?.candidates ?? []);
      this.lastRunAt.set(run?.completed_at ?? null);
      this.searched.set(run !== null);

      if (this.expandedSlotKey() && !this.selectedSlot()) {
        this.closeSlot();
      }
    } catch (error) {
      if (sequence !== this.searchSequence) return;

      console.error('Matching run request failed:', error);
      this.error.set(
        runNewSearch
          ? 'החיפוש לא הושלם. אפשר לנסות שוב.'
          : 'לא ניתן לטעון את תוצאות ההרצה האחרונה.'
      );
    } finally {
      if (loadingTimer !== undefined) {
        clearTimeout(loadingTimer);
      }

      if (sequence === this.searchSequence) {
        this.showLoadingPanel.set(false);
        this.loading.set(false);
        this.searching.set(false);
      }
    }
  }

  queuePosition(candidate: WeeklyMatchingCandidate): number | null {
    if (candidate.request_source === 'external') {
      return this.externalEntries.find(
        entry => entry.id === candidate.request_id
      )?.position ?? null;
    }

    return this.priorityQueuePositions[candidate.request_id] ?? null;
  }

  matchesChildSearch(candidate: WeeklyMatchingCandidate): boolean {
    const query = this.childSearchText().trim().toLocaleLowerCase();
    return query.length > 0 && this.childName(candidate).toLocaleLowerCase().includes(query);
  }

  childName(candidate: WeeklyMatchingCandidate): string {
    if (candidate.request_source === 'external') {
      const request = this.externalEntries.find(entry => entry.id === candidate.request_id);
      return request
        ? `${request.first_name} ${request.last_name}`.trim()
        : 'בקשה חיצונית';
    }

    const request = this.internalEntries.find(entry => entry.id === candidate.request_id);
    return request
      ? this.childNamesById[request.child_uuid] ?? 'ילד/ה'
      : 'בקשה פנימית';
  }

  instructorName(instructorId: string): string {
    return this.instructors.find(instructor => instructor.id_number === instructorId)?.name || instructorId;
  }

  isExpired(startDate: string, startTime: string): boolean {
  return this.matchingService.isExpired(startDate, startTime);
}

  dayName(day: number): string {
    return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][day] ?? String(day);
  }

  shortTime(value: string): string {
    return value?.slice(0, 5) ?? '';
  }

  dateLabel(value: string): string {
    const parts = value?.split('-');
    return parts?.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  priorityName(priority: number): string {
    return priority === 2 ? 'גבוהה' : priority === 1 ? 'בינונית' : 'נמוכה';
  }

  slotWarningCount(slot: MatchingSlot): number {
    return slot.candidates.filter(candidate => candidate.warning_weeks > 0).length;
  }

  trackSlot(_: number, slot: MatchingSlot): string {
    return slot.key;
  }

  trackCandidate(_: number, candidate: WeeklyMatchingCandidate): string {
    return `${candidate.request_source}:${candidate.request_id}:${candidate.series_start_date}`;
  }
}

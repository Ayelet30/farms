import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MatchingService,
  WeeklyMatchingCandidate
} from '../../../services/matching.service';
import { ExternalWaitlistRequest } from '../../../services/waitlist.service';
import { WaitlistEntry } from '../../../Types/waitlist.types';

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
export class MatchingResultsComponent implements OnChanges {
  @Input() searchVersion = 0;
  @Input() internalEntries: WaitlistEntry[] = [];
  @Input() externalEntries: ExternalWaitlistRequest[] = [];
  @Input() childNamesById: Record<string, string> = {};
  @Input() instructors: { id_number: string; name: string }[] = [];

  private readonly matchingService = inject(MatchingService);
  private searchSequence = 0;

  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly error = signal<string | null>(null);
  readonly results = signal<WeeklyMatchingCandidate[]>([]);
  readonly expandedSlotKey = signal<string | null>(null);
  readonly searchText = signal('');
  readonly selectedDay = signal('all');
  readonly selectedKind = signal('all');

  readonly slots = computed<MatchingSlot[]>(() => {
    const grouped = new Map<string, MatchingSlot>();

    for (const candidate of this.results()) {
      if (!candidate.is_viable_candidate) continue;

      const key = [
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
        Number(a.queue_position ?? Infinity) - Number(b.queue_position ?? Infinity)
      );
    }

    return [...grouped.values()].sort((a, b) =>
      a.dayOfWeek - b.dayOfWeek ||
      a.startTime.localeCompare(b.startTime) ||
      a.instructorId.localeCompare(b.instructorId)
    );
  });

  readonly matchingCount = computed(() =>
    this.slots().reduce((sum, slot) => sum + slot.candidates.length, 0)
  );

  readonly filteredSlots = computed(() => {
    const text = this.searchText().trim().toLocaleLowerCase();
    const day = this.selectedDay();
    const kind = this.selectedKind();

    return this.slots().filter(slot => {
      if (day !== 'all' && slot.dayOfWeek !== Number(day)) return false;
      if (kind !== 'all' && slot.slotKind !== kind) return false;
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
    this.slots().find(slot => slot.key === this.expandedSlotKey()) ?? null
  );

  readonly hasFilters = computed(() =>
    !!this.searchText().trim() ||
    this.selectedDay() !== 'all' ||
    this.selectedKind() !== 'all'
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['searchVersion'] && this.searchVersion > 0) {
      void this.search();
    }
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
  }

  async search(): Promise<void> {
    const sequence = ++this.searchSequence;
    this.closeSlot();
    this.loading.set(true);
    this.error.set(null);

    try {
      const today = new Date();
      const fromDate = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0')
      ].join('-');

      const data = await this.matchingService.searchWeeklyMatches(fromDate, 14);
      if (sequence !== this.searchSequence) return;

      this.results.set(data);
      this.searched.set(true);
    } catch (error) {
      if (sequence !== this.searchSequence) return;
      console.error('Matching search failed:', error);
      this.error.set('לא ניתן לטעון את ההתאמות. בדקי את הרשאות הגישה ונסי שוב.');
    } finally {
      if (sequence === this.searchSequence) this.loading.set(false);
    }
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

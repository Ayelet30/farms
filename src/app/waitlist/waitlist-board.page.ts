
import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, ensureTenantContextReady, getSupabaseClient } from '../services/legacy-compat';
import { WaitingListDialog } from '../shared/components/waiting-list-dialog/waiting-list-dialog';
import { inject } from '@angular/core';
import { UiDialogService } from '../services/ui-dialog.service';
import { MatSidenavModule } from '@angular/material/sidenav';
import {
  CdkDragDrop,
  DragDropModule
} from '@angular/cdk/drag-drop';

import { WaitlistEntry } from '../Types/waitlist.types';
import { WaitlistService } from '../services/waitlist.service';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Priority = 0 | 1 | 2;

@Component({
  selector: 'app-waitlist-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    WaitingListDialog,
    MatSidenavModule
  ],
  templateUrl: './waitlist-board.page.html',
  styleUrls: ['./waitlist-board.page.scss'],
})
export class WaitlistBoardPage implements OnInit, OnDestroy {

  loading = signal(false);
  saving = signal(false);
  errorText = signal<string | null>(null);

  entries = signal<WaitlistEntry[]>([]);
  private readonly ui = inject(UiDialogService);

  // שמות הילדים לפי child_uuid
  childNamesById = signal<Record<string, string>>({});

  // קבלת שם הילד להצגה במסך
  childName(childUuid: string): string {
    return this.childNamesById()[childUuid] ?? 'ילד/ה לא נמצא/ה';
  }

  selectedRidingTypeId = signal<string>('all');
  selectedInstructorId = signal<string>('all');
  childSearch = signal<string>('');

  // אפשרויות הסינון
  filterRidingTypes = signal<{
    id: string;
    name: string;
  }[]>([]);

  filterInstructors = signal<{
    id_number: string;
    name: string;
  }[]>([]);

  // ההעדפות שנשמרו לכל בקשת המתנה
  ridingTypesByEntry = signal<Record<string, string[]>>({});
  instructorsByEntry = signal<Record<string, string[]>>({});

  // איזו לשונית מוצגת
  selectedTab = signal<'active' | 'paused'>('active');

  // איזו בקשה פתוחה להצגת פרטים
  expandedEntryId = signal<string | null>(null);

  selectedEntry = computed(() =>
    this.entries().find(e => e.id === this.expandedEntryId()) ?? null
  );

  closeDetails(): void {
    ++this.detailsLoadId;
    this.expandedEntryId.set(null);
    this.detailsLoading.set(false);
    this.detailsError.set(null);
    this.detailsAvailability.set([]);
    this.detailsQueuePosition.set(null);
  }

  private matchesFilters(entry: WaitlistEntry): boolean {
    const search = this.childSearch().trim().toLowerCase();
    const ridingTypeId = this.selectedRidingTypeId();
    const instructorId = this.selectedInstructorId();

    // חיפוש לפי שם הילד
    if (search) {
      const name = this.childName(entry.child_uuid).toLowerCase();
      if (!name.includes(search)) return false;
    }

    // סינון לפי סוג רכיבה
    if (ridingTypeId !== 'all') {
      const matchesRiding =
        entry.all_riding_types ||
        (this.ridingTypesByEntry()[entry.id] ?? [])
          .includes(ridingTypeId);

      if (!matchesRiding) return false;
    }

    // סינון לפי מדריך
    if (instructorId !== 'all') {
      const matchesInstructor =
        entry.all_instructors ||
        (this.instructorsByEntry()[entry.id] ?? [])
          .includes(instructorId);

      if (!matchesInstructor) return false;
    }

    return true;
  }

  // בקשות פעילות
  activeEntries = computed(() =>
    this.entries()
      .filter(e =>
        e.status === 'active' &&
        this.matchesFilters(e)
      )
      .sort((a, b) =>
        b.priority - a.priority ||
        Number(a.position) - Number(b.position) ||
        a.id.localeCompare(b.id)
      )
  );

  // בקשות מושהות
  pausedEntries = computed(() =>
    this.entries()
      .filter(e =>
        e.status === 'paused' &&
        this.matchesFilters(e)
      )
      .sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      )
  );

  highPriorityEntries = computed(() =>
    this.activeEntries().filter(e => e.priority === 2)
  );

  mediumPriorityEntries = computed(() =>
    this.activeEntries().filter(e => e.priority === 1)
  );

  lowPriorityEntries = computed(() =>
    this.activeEntries().filter(e => e.priority === 0)
  );

  // =========================================
  // ADD CHILD TO WAITLIST FROM BOARD
  // =========================================

  showChildPicker = signal(false);
  showAddWaitlistDialog = signal(false);

  loadingFarmChildren = signal(false);
  childPickerError = signal<string | null>(null);
  childPickerSearch = signal('');

  farmChildren = signal<{
    child_uuid: string;
    parent_uid: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
  }[]>([]);

  selectedWaitlistChild = signal<{
    child_uuid: string;
    parent_uid: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
  } | null>(null);

  waitlistInstructors: {
    id_number: string;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  }[] = [];

  getFarmChildName(child: {
    first_name: string | null;
    last_name: string | null;
  }): string {
    return [
      child.first_name,
      child.last_name
    ].filter(Boolean).join(' ').trim() || 'ללא שם';
  }

  filteredFarmChildren = computed(() => {
    const search = this.childPickerSearch()
      .trim()
      .toLowerCase();

    return this.farmChildren().filter(child =>
      this.getFarmChildName(child)
        .toLowerCase()
        .includes(search)
    );
  });

  getFarmChildAge(birthDate: string | null): number | null {
    if (!birthDate) return null;

    const parts = birthDate.slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
      return null;
    }

    const [year, month, day] = parts;
    const today = new Date();

    let age = today.getFullYear() - year;

    if (
      today.getMonth() + 1 < month ||
      (
        today.getMonth() + 1 === month &&
        today.getDate() < day
      )
    ) {
      age--;
    }

    return age >= 0 ? age : null;
  }

  async openChildPicker(): Promise<void> {
    if (this.saving() || this.loadingFarmChildren()) return;

    this.closeDetails();
    this.childPickerSearch.set('');
    this.childPickerError.set(null);
    this.selectedWaitlistChild.set(null);

    this.showChildPicker.set(true);
    this.loadingFarmChildren.set(true);

    try {
      const children = await this.wl.listAllFarmChildren();

      this.farmChildren.set(
        [...children].sort((a, b) =>
          this.getFarmChildName(a).localeCompare(
            this.getFarmChildName(b),
            'he'
          )
        )
      );

    } catch (error: any) {
      console.error('Error loading farm children:', error);

      this.childPickerError.set(
        error?.message ?? 'שגיאה בטעינת ילדי החווה'
      );

    } finally {
      this.loadingFarmChildren.set(false);
    }
  }

  closeChildPicker(): void {
    if (this.loadingFarmChildren()) return;

    this.showChildPicker.set(false);
    this.childPickerSearch.set('');
    this.childPickerError.set(null);
  }

  async selectChildForWaitlist(
    child: {
      child_uuid: string;
      parent_uid: string;
      first_name: string | null;
      last_name: string | null;
      birth_date: string | null;
    }
  ): Promise<void> {

    if (!child.parent_uid) {
      this.childPickerError.set(
        'לילד זה לא משויך הורה. לא ניתן להוסיף אותו לרשימת ההמתנה.'
      );
      return;
    }

    // לא יוצרים בקשה נוספת לילד שכבר נמצא ברשימה
    try {
      const existing = await this.wl.listAllEntries();

      if (existing.some(e => e.child_uuid === child.child_uuid)) {
        this.childPickerError.set(
          'לילד זה כבר קיימת בקשה פעילה או מושהית ברשימת ההמתנה.'
        );
        return;
      }

      this.childPickerError.set(null);

      await ensureTenantContextReady();

      const { data, error } = await dbTenant()
        .from('instructors')
        .select('id_number, first_name, last_name')
        .order('first_name', { ascending: true });

      if (error) throw error;

      this.waitlistInstructors = (data ?? []).map((i: any) => ({
        ...i,
        name: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
      }));

      this.selectedWaitlistChild.set(child);
      this.showChildPicker.set(false);
      this.showAddWaitlistDialog.set(true);

    } catch (error: any) {
      console.error('Error selecting waitlist child:', error);

      this.childPickerError.set(
        error?.message ?? 'שגיאה בהכנת טופס ההמתנה'
      );
    }
  }

  private boardWaitlistSaveCompleted = false;

  async onBoardWaitlistSaved(): Promise<void> {
    this.boardWaitlistSaveCompleted = true;

    this.showAddWaitlistDialog.set(false);
    this.selectedWaitlistChild.set(null);
    this.showChildPicker.set(false);

    await this.refresh();
  }

  closeBoardWaitlistDialog(): void {
    this.showAddWaitlistDialog.set(false);
    this.selectedWaitlistChild.set(null);

    // אחרי שמירה מוצלחת לא חוזרים לחלון הבחירה
    if (this.boardWaitlistSaveCompleted) {
      this.boardWaitlistSaveCompleted = false;
      return;
    }

    // בביטול חוזרים לבחירת ילד אחר
    this.childPickerError.set(null);
    this.showChildPicker.set(true);
  }


  // =========================================
  // WAITLIST - SUPABASE REALTIME
  // =========================================

  private waitlistChannel: RealtimeChannel | null = null;
  private realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  private realtimeRefreshRunning = false;
  private realtimeRefreshPending = false;
  private realtimeDestroyed = false;

  private async startWaitlistRealtime(): Promise<void> {
    await ensureTenantContextReady();

    if (this.realtimeDestroyed || this.waitlistChannel) return;

    // הסכמה של החווה הנוכחית
    const tenantSchema = 'moacha_atarim_app';

    const sb = getSupabaseClient();

    this.waitlistChannel = sb
      .channel(`waitlist-board-${tenantSchema}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: tenantSchema,
          table: 'waitlist_entries'
        },
        (payload) => {
          console.log(
            'WAITLIST REALTIME EVENT:',
            payload.eventType,
            payload
          );

          this.scheduleRealtimeRefresh();
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Waitlist Realtime error:', err);
        }

        if (status === 'SUBSCRIBED') {
          console.log('Waitlist Realtime connected');
        }
      });
  }

  private scheduleRealtimeRefresh(): void {
    if (this.realtimeDestroyed) return;

    if (this.realtimeRefreshTimer) {
      clearTimeout(this.realtimeRefreshTimer);
    }

    // ממתינות מעט כדי לאחד שינויים שמגיעים ברצף
    this.realtimeRefreshTimer = setTimeout(() => {
      this.realtimeRefreshTimer = null;
      void this.runRealtimeRefresh();
    }, 350);
  }

  private async runRealtimeRefresh(): Promise<void> {
    if (this.realtimeDestroyed) return;

    if (this.realtimeRefreshRunning || this.saving()) {
      this.realtimeRefreshPending = true;
      return;
    }

    this.realtimeRefreshRunning = true;

    try {
      do {
        this.realtimeRefreshPending = false;

        if (this.realtimeDestroyed) return;

        await this.refresh();

      } while (
        this.realtimeRefreshPending &&
        !this.realtimeDestroyed &&
        !this.saving()
      );

    } finally {
      this.realtimeRefreshRunning = false;
    }
  }

  ngOnDestroy(): void {
    this.realtimeDestroyed = true;

    if (this.realtimeRefreshTimer) {
      clearTimeout(this.realtimeRefreshTimer);
      this.realtimeRefreshTimer = null;
    }

    if (this.waitlistChannel) {
      void getSupabaseClient().removeChannel(this.waitlistChannel);
      this.waitlistChannel = null;
    }
  }


  constructor(private wl: WaitlistService) { }

  async loadFilterData(): Promise<void> {
    try {
      const data = await this.wl.loadWaitlistFilterData();


      this.filterRidingTypes.set(data.ridingTypes);
      this.filterInstructors.set(data.instructors);

      this.ridingTypesByEntry.set(data.ridingTypesByEntry);
      this.instructorsByEntry.set(data.instructorsByEntry);

    } catch (error: any) {
      console.error('שגיאה בטעינת נתוני הסינון:', error);

      this.errorText.set(
        error?.message ?? 'לא ניתן לטעון את נתוני הסינון'
      );
    }
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
    await this.startWaitlistRealtime();
  }


  async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorText.set(null);

    try {
      // טעינת כל בקשות ההמתנה
      const list = await this.wl.listAllEntries();

      // חילוץ מזהי הילדים מתוך הבקשות
      const childIds = list.map(entry => entry.child_uuid);

      // טעינת השמות לפי המזהים
      const names = await this.wl.listChildNames(childIds);

      // עדכון המידע שמוצג במסך
      this.childNamesById.set(names);
      this.entries.set(list);
      await this.loadFilterData();

    } catch (error: any) {
      console.error('שגיאה בטעינת רשימת ההמתנה:', error);

      this.errorText.set(
        error?.message ??
        'אירעה שגיאה בטעינת רשימת ההמתנה.'
      );

    } finally {
      this.loading.set(false);
    }
  }


  changeTab(tab: 'active' | 'paused'): void {
    this.selectedTab.set(tab);
    this.expandedEntryId.set(null);
  }

  // ==========================================
  // WAITLIST DETAILS - VIEW MODE
  // ==========================================

  detailsLoading = signal(false);
  detailsError = signal<string | null>(null);

  detailsAvailability = signal<{
    day_of_week: number;
    all_day: boolean;
    time_from: string | null;
    time_to: string | null;
  }[]>([]);

  detailsQueuePosition = signal<{
    priorityPosition: number;
    overallPosition: number;
  } | null>(null);

  private detailsLoadId = 0;

  toggleExpanded(entryId: string): void {
    const current = this.expandedEntryId();

    if (current === entryId) {
      this.closeDetails();
      return;
    }

    this.expandedEntryId.set(entryId);
    void this.loadEntryDetails(entryId);
  }

  async loadEntryDetails(entryId: string): Promise<void> {
    const loadId = ++this.detailsLoadId;

    this.detailsLoading.set(true);
    this.detailsError.set(null);
    this.detailsAvailability.set([]);
    this.detailsQueuePosition.set(null);

    try {
      await ensureTenantContextReady();

      const entry = this.entries().find(e => e.id === entryId);
      if (!entry) return;

      const db = dbTenant();

      // טעינת הזמינות הספציפית
      if (!entry.all_times) {
        const { data, error } = await db
          .from('waitlist_entry_availability')
          .select('day_of_week, all_day, time_from, time_to')
          .eq('waitlist_entry_id', entryId)
          .order('day_of_week');

        if (error) throw error;

        if (loadId !== this.detailsLoadId) return;
        this.detailsAvailability.set(data ?? []);
      }

      // מיקומים מחושבים רק לבקשה פעילה
      if (entry.status === 'active') {
        const { data, error } = await db.rpc(
          'waitlist_get_queue_position',
          { p_entry_id: entryId }
        );

        if (error) throw error;

        const position = Array.isArray(data)
          ? data[0]
          : data;

        if (
          loadId === this.detailsLoadId &&
          position?.priority_position != null &&
          position?.overall_position != null
        ) {
          this.detailsQueuePosition.set({
            priorityPosition: Number(position.priority_position),
            overallPosition: Number(position.overall_position)
          });
        }
      }

    } catch (error: any) {
      if (loadId !== this.detailsLoadId) return;

      console.error('Failed loading waitlist details:', error);

      this.detailsError.set(
        'לא ניתן לטעון את כל פרטי הבקשה. נסי לפתוח אותה מחדש.'
      );

    } finally {
      if (loadId === this.detailsLoadId) {
        this.detailsLoading.set(false);
      }
    }
  }

  getSelectedRidingTypeNames(entryId: string): string[] {
    const ids = this.ridingTypesByEntry()[entryId] ?? [];

    return ids.map(id =>
      this.filterRidingTypes().find(type => type.id === id)?.name ?? id
    );
  }

  getSelectedInstructorNames(entryId: string): string[] {
    const ids = this.instructorsByEntry()[entryId] ?? [];

    return ids.map(id =>
      this.filterInstructors().find(i => i.id_number === id)?.name ?? id
    );
  }

  getAvailabilityDayName(day: number): string {
    const days: Record<number, string> = {
      1: 'ראשון',
      2: 'שני',
      3: 'שלישי',
      4: 'רביעי',
      5: 'חמישי',
      6: 'שישי',
      7: 'שבת'
    };

    return days[day] ?? String(day);
  }

  getAvailabilitySummary(): string[] {
    return this.detailsAvailability().map(item => {
      const day = this.getAvailabilityDayName(item.day_of_week);

      if (item.all_day || (!item.time_from && !item.time_to)) {
        return `יום ${day}: כל השעות`;
      }

      const from = item.time_from?.slice(0, 5);
      const to = item.time_to?.slice(0, 5);

      if (from && to) {
        return `יום ${day}: ${from}–${to}`;
      }

      if (from) return `יום ${day}: משעה ${from}`;
      if (to) return `יום ${day}: עד שעה ${to}`;

      return `יום ${day}: כל השעות`;
    });
  }

  isExpanded(entryId: string): boolean {
    return this.expandedEntryId() === entryId;
  }

  priorityLabel(priority: number): string {
    switch (priority) {
      case 2: return 'גבוהה';
      case 1: return 'בינונית';
      default: return 'נמוכה';
    }
  }

  preferenceLabel(
    allFlag: boolean,
    selectedLabel: string,
    allLabel: string
  ): string {
    return allFlag ? allLabel : selectedLabel;
  }


  onPriorityChange(entry: WaitlistEntry, value: string): void {
    const priority = Number(value);

    if (priority !== 0 && priority !== 1 && priority !== 2) {
      return;
    }

    void this.changePriority(entry, priority);
  }


  // שינוי עדיפות: מכניס לסוף הקבוצה החדשה
  async changePriority(
    entry: WaitlistEntry,
    priority: Priority
  ): Promise<void> {
    if (this.saving() || entry.priority === priority) return;

    this.saving.set(true);
    this.errorText.set(null);

    try {
      await this.wl.changeWaitlistPriority(entry.id, priority);
      await this.refresh();
    } catch (error: any) {
      console.error('שגיאה בשינוי עדיפות:', error);
      this.errorText.set(
        error?.message ?? 'לא ניתן לשנות את העדיפות.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  // חסימת הגרירה ברגע שסינון מופעל
  get hasActiveFilters(): boolean {
    return (
      this.selectedRidingTypeId() !== 'all' ||
      this.selectedInstructorId() !== 'all' ||
      this.childSearch().trim() !== ''
    );
  }

  // השהיה או החזרה לפעיל
  async togglePause(entry: WaitlistEntry): Promise<void> {
    if (this.saving()) return;

    this.saving.set(true);
    this.errorText.set(null);

    const newStatus =
      entry.status === 'paused' ? 'active' : 'paused';

    try {
      await this.wl.changeWaitlistStatus(entry.id, newStatus);
      this.expandedEntryId.set(null);
      await this.refresh();
    } catch (error: any) {
      console.error('שגיאה בשינוי סטטוס:', error);
      this.errorText.set(
        error?.message ?? 'לא ניתן לעדכן את סטטוס הבקשה.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  // מחיקה - עם אישור לפני פעולה בלתי הפיכה
  async deleteRequest(entry: WaitlistEntry): Promise<void> {
    if (this.saving()) return;

    const confirmed = await this.ui.confirm({
      title: 'מחיקת בקשת המתנה',
      message:
        'האם למחוק את בקשת ההמתנה של ' +
        this.childName(entry.child_uuid) +
        '?\n\n' +
        'הבקשה וכל העדפותיה יימחקו לצמיתות.\n' +
        'כרטיס הילד/ה במערכת לא יימחק.',
      okText: 'כן, למחוק',
      cancelText: 'ביטול',
      showCancel: true,
    });

    if (!confirmed) return;

    this.saving.set(true);
    this.errorText.set(null);

    try {
      await this.wl.deleteWaitlistRequest(entry.id);
      this.expandedEntryId.set(null);
      await this.refresh();
    } catch (error: any) {
      console.error('שגיאה במחיקת בקשה:', error);
      this.errorText.set(
        error?.message ?? 'לא ניתן למחוק את הבקשה.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  // גרירה רק בתוך אותה קבוצת עדיפות
  async drop(
    event: CdkDragDrop<WaitlistEntry[]>,
    priority: Priority
  ): Promise<void> {
    if (this.hasActiveFilters) return;
    if (this.saving()) return;
    if (event.previousIndex === event.currentIndex) return;

    const items = [...event.container.data];
    const moved = items[event.previousIndex];

    if (!moved ||
      moved.status !== 'active' ||
      moved.priority !== priority ||
      event.previousContainer !== event.container) {
      return;
    }

    this.saving.set(true);
    this.errorText.set(null);

    try {
      await this.wl.reorderWaitlistEntry(
        moved.id,
        event.currentIndex + 1
      );

      await this.refresh();
    } catch (error: any) {
      console.error('שגיאה בשינוי מיקום:', error);
      this.errorText.set(
        error?.message ?? 'לא ניתן לשנות את המיקום בתור.'
      );

      await this.refresh();
    } finally {
      this.saving.set(false);
    }
  }

  showFilteredDragMessage(): void {
    if (!this.hasActiveFilters) return;

    this.ui.alert(
      'לא ניתן לגרור רשומות כאשר מופעל סינון.',
      'גרירה אינה זמינה'
    );
  }

}

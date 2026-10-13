
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule
} from '@angular/cdk/drag-drop';

import { WaitlistEntry } from '../Types/waitlist.types';
import { WaitlistService } from '../services/waitlist.service';

type Priority = 0 | 1 | 2;

@Component({
  selector: 'app-waitlist-board',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './waitlist-board.page.html',
  styleUrls: ['./waitlist-board.page.scss'],
})
export class WaitlistBoardPage implements OnInit {

  loading = signal(false);
  saving = signal(false);
  errorText = signal<string | null>(null);

  entries = signal<WaitlistEntry[]>([]);
  
  // שמות הילדים לפי child_uuid
  childNamesById = signal<Record<string, string>>({});

  // קבלת שם הילד להצגה במסך
  childName(childUuid: string): string {
    return this.childNamesById()[childUuid] ?? 'ילד/ה לא נמצא/ה';
  }

  selectedRidingTypeId = signal<string>('all');
  selectedInstructorId = signal<string>('all');
  childSearch = signal<string>('');

  // איזו לשונית מוצגת
  selectedTab = signal<'active' | 'paused'>('active');

  // איזו בקשה פתוחה להצגת פרטים
  expandedEntryId = signal<string | null>(null);

  selectedEntry = computed(() =>
    this.entries().find(e => e.id === this.expandedEntryId()) ?? null
  );

  expandedSection = signal<'high' | 'medium' | 'low' | 'paused' | null>(null);



  toggleSectionSize(
    section: 'high' | 'medium' | 'low' | 'paused'
  ): void {
    this.expandedSection.update(current =>
      current === section ? null : section
    );
  }



  isSectionExpanded(section: 'high' | 'medium' | 'low' | 'paused'): boolean {
    return this.expandedSection() === section;
  }

  closeDetails(): void {
    this.expandedEntryId.set(null);
  }

  // כל הבקשות הפעילות
  activeEntries = computed(() =>
    this.entries()
      .filter(e => e.status === 'active')
      .sort((a, b) =>
        b.priority - a.priority ||
        Number(a.position) - Number(b.position) ||
        a.id.localeCompare(b.id)
      )
  );

  // בקשות מושהות - רשימה אחת
  pausedEntries = computed(() =>
    this.entries()
      .filter(e => e.status === 'paused')
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

  constructor(private wl: WaitlistService) { }

  async ngOnInit(): Promise<void> {
    await this.refresh();
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

  toggleExpanded(entryId: string): void {
    this.expandedEntryId.update(current =>
      current === entryId ? null : entryId
    );
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

    const confirmed = window.confirm(
      'האם למחוק את בקשת ההמתנה?\n\n' +
      'הבקשה וכל העדפותיה יימחקו לצמיתות.\n' +
      'כרטיס הילד/ה במערכת לא יימחק.'
    );

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

}

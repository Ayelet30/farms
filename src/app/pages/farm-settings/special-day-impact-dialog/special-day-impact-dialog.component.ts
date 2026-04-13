import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface SpecialDayImpactRow {
  lesson_id: string;
  occur_date: string;
  start_time: string | null;
  end_time: string | null;
  child_id: string;
  child_name: string;
  parent_uid: string | null;
  parent_name: string | null;
  parent_email: string | null;
  lesson_type: string | null;
  instructor_id: string | null;
}

export interface SpecialDayImpactDialogData {
  reason: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  rows: SpecialDayImpactRow[];
}

type ChildGroup = {
  childId: string;
  childName: string;
  parentName: string;
  parentEmail: string;
  lessons: SpecialDayImpactRow[];
};

@Component({
  selector: 'app-special-day-impact-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './special-day-impact-dialog.component.html',
  styleUrls: ['./special-day-impact-dialog.component.scss'],
})
export class SpecialDayImpactDialogComponent {
  readonly data = inject<SpecialDayImpactDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SpecialDayImpactDialogComponent>);

  get totalLessons(): number {
    return this.data.rows?.length ?? 0;
  }

  get totalChildren(): number {
    return new Set((this.data.rows ?? []).map(r => r.child_id)).size;
  }

  get totalParents(): number {
    return new Set(
      (this.data.rows ?? [])
        .map(r => (r.parent_email ?? '').trim())
        .filter(Boolean)
    ).size;
  }

  get groupedRows(): ChildGroup[] {
    const map = new Map<string, ChildGroup>();

    for (const row of this.data.rows ?? []) {
      const childId = row.child_id;
      const childName = row.child_name || 'ללא שם';
      const parentName = row.parent_name || 'ללא הורה';
      const parentEmail = row.parent_email || 'ללא אימייל';

      if (!map.has(childId)) {
        map.set(childId, {
          childId,
          childName,
          parentName,
          parentEmail,
          lessons: [],
        });
      }

      map.get(childId)!.lessons.push(row);
    }

    return Array.from(map.values())
      .map(group => ({
        ...group,
        lessons: [...group.lessons].sort((a, b) => {
          const ad = `${a.occur_date} ${a.start_time ?? ''}`;
          const bd = `${b.occur_date} ${b.start_time ?? ''}`;
          return ad.localeCompare(bd);
        }),
      }))
      .sort((a, b) => a.childName.localeCompare(b.childName, 'he'));
  }

  formatHour(value: string | null): string {
    if (!value) return '';
    return String(value).slice(0, 5);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    this.dialogRef.close(true);
  }

  trackByChild = (_: number, item: ChildGroup) => item.childId;
  trackByLesson = (_: number, item: SpecialDayImpactRow) =>
    `${item.lesson_id}_${item.occur_date}`;
}
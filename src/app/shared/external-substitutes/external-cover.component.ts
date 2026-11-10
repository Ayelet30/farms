import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  inject,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PayrollApiService,
} from '../../services/payroll-api.service';

import {
  ExternalSubstitute,
  ExternalSubstitutesComponent,
} from './external-substitutes.component';

interface Candidate {
  lesson_id: string;
  child_name: string;
  start_time: string;
  end_time: string;
  status: string | null;
  is_cancellation: boolean | null;
  canceller_role: string | null;
  fully_covered: boolean;
  external_id: string | null;
  external_name: string | null;
  fingerprint: string;

  selected: boolean;
  restore: boolean;
}

@Component({
  selector: 'app-external-cover',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
    ExternalSubstitutesComponent,
  ],

  template: `
    <section dir="rtl" class="cover">
      <h3>שיבוץ מחליף חיצוני</h3>

      <p>
        בחרי מדריך נעדר, תאריך וטווח כיסוי.
        שעות השיעורים עצמן אינן משתנות.
      </p>

      <p *ngIf="error" class="error" role="alert">
        {{ error }}
      </p>

      <p *ngIf="success" class="success" role="status">
        {{ success }}
      </p>

      <p *ngIf="busy" role="status">
        {{ saving ? 'שומר שיבוץ…' : 'טוען…' }}
      </p>

      <fieldset [disabled]="busy">
        <div class="fields">
          <label>
            מדריך מקורי

            <select
              [(ngModel)]="instructorId"
              (ngModelChange)="clearPreview()"
            >
              <option value="">בחרי מדריך</option>

              <option
                *ngFor="let instructor of instructors"
                [value]="instructor.id"
              >
                {{ instructor.name }}
              </option>
            </select>
          </label>

          <label>
            תאריך

            <input
              type="date"
              [(ngModel)]="date"
              (ngModelChange)="clearPreview()"
            />
          </label>

          <label>
            משעה

            <input
              type="time"
              [(ngModel)]="start"
              (ngModelChange)="clearPreview()"
            />
          </label>

          <label>
            עד שעה

            <input
              type="time"
              [(ngModel)]="end"
              (ngModelChange)="clearPreview()"
            />
          </label>
        </div>

        <div class="person">
          <strong>מחליף נבחר:</strong>
          {{ chosen?.full_name || 'טרם נבחר מחליף' }}

          <button
            type="button"
            (click)="pickerOpen = !pickerOpen"
          >
            {{ pickerOpen ? 'סגירת הרשימה' : 'בחירה / הוספת מחליף' }}
          </button>
        </div>

        <app-external-substitutes
          *ngIf="pickerOpen"
          [selectionMode]="true"
          (selected)="choose($event)"
          (substituteSaved)="choose($event)"
        ></app-external-substitutes>

        <button
          type="button"
          (click)="preview()"
          [disabled]="!instructorId || !date || !start || !end"
        >
          בדיקת שיעורים בטווח
        </button>

        <ng-container *ngIf="previewLoaded">
          <p *ngIf="!candidates.length">
            לא נמצאו שיעורים בטווח שנבחר.
          </p>

          <p *ngIf="candidates.length">
            בחירת שיעור בוחרת גם את יתר השיעורים הניתנים
            לשיבוץ באותה משבצת.
          </p>

          <div class="table-wrap" *ngIf="candidates.length">
            <table>
              <thead>
                <tr>
                  <th>בחירה</th>
                  <th>ילד</th>
                  <th>שעות</th>
                  <th>מצב</th>
                  <th>החזרת שיעור מבוטל</th>
                </tr>
              </thead>

              <tbody>
                <tr *ngFor="let row of candidates">
                  <td>
                    <input
                      type="checkbox"
                      [checked]="row.selected"
                      [disabled]="!canSelect(row)"
                      (change)="toggleSlot(row)"
                      [attr.aria-label]="'בחירת שיעור של ' + row.child_name"
                    />
                  </td>

                  <td>{{ row.child_name }}</td>

                  <td dir="ltr">
                    {{ row.start_time.slice(0, 5) }}–{{
                      row.end_time.slice(0, 5)
                    }}
                  </td>

                  <td>
                    {{ row.status || 'ללא סטטוס' }}

                    <span *ngIf="!row.fully_covered">
                      — חורג מטווח הכיסוי
                    </span>

                    <span *ngIf="row.external_id">
                      — משויך ל־{{ row.external_name }}
                    </span>
                  </td>

                  <td>
                    <label
                      class="check"
                      *ngIf="isCancelled(row) && canSelect(row)"
                    >
                      <input
                        type="checkbox"
                        [(ngModel)]="row.restore"
                        [disabled]="!row.selected"
                      />

                      להחזיר ולרשום הודעת
                      ״נמצא מחליף והשיעור הוחזר״
                    </label>

                    <span
                      *ngIf="
                        isCancelled(row) &&
                        row.canceller_role !== 'secretary'
                      "
                    >
                      ביטול זה אינו מוחזר בפעולה זו
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p *ngIf="selectedCount">
            נבחרו {{ selectedCount }} שיעורים.
            שעותיהם יירשמו למחליף החיצוני
            ולא למדריך המקורי.
          </p>

          <button
            type="button"
            (click)="save()"
            [disabled]="!chosen || !selectedCount"
          >
            שמירת השיבוץ
          </button>
        </ng-container>
      </fieldset>
    </section>
  `,

  styles: [`
    :host {
      display: block;
    }

    .cover {
      padding: 18px;
      color: #30382a;
    }

    p {
      line-height: 1.7;
    }

    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }

    .fields {
      display: grid;
      grid-template-columns:
        repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    input,
    select,
    button {
      font: inherit;
    }

    input,
    select {
      padding: 9px;
      border: 1px solid #ced7c5;
      border-radius: 8px;
      min-width: 0;
    }

    button {
      padding: 9px 14px;
      margin: 8px 0;
      border: 1px solid #cbd7b9;
      border-radius: 8px;
      background: #f6f8f1;
      color: #344227;
      cursor: pointer;
    }

    button:disabled {
      opacity: .5;
      cursor: default;
    }

    .person {
      padding: 12px;
      margin-bottom: 12px;
      background: #f4f7ef;
      border-radius: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .table-wrap {
      overflow-x: auto;
      margin: 12px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      text-align: right;
      padding: 10px;
      border-bottom: 1px solid #e6eadd;
    }

    th {
      background: #f4f7ef;
    }

    .check {
      flex-direction: row;
      align-items: center;
    }

    .error,
    .success {
      padding: 12px;
      border-radius: 8px;
    }

    .error {
      color: #a52222;
      background: #fff1f0;
    }

    .success {
      color: #315d27;
      background: #eff9eb;
    }
  `],
})
export class ExternalCoverComponent implements OnInit {
  @Input() initialInstructor = '';
  @Input() initialDate = '';
  @Input() initialStart = '';
  @Input() initialEnd = '';

  @Output() saved = new EventEmitter<void>();
  @Output() busyChange = new EventEmitter<boolean>();

  private readonly api = inject(PayrollApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  instructors: Array<{ id: string; name: string }> = [];

  instructorId = '';
  date = '';
  start = '08:00';
  end = '12:00';

  chosen: ExternalSubstitute | null = null;
  pickerOpen = false;

  candidates: Candidate[] = [];

  previewLoaded = false;
  private previewKey = '';

  busy = false;
  saving = false;

  error = '';
  success = '';

  ngOnInit(): void {
    this.instructorId = this.initialInstructor;
    this.date = this.initialDate;

    this.start = this.initialStart || '08:00';
    this.end = this.initialEnd || '12:00';

    void this.loadInstructors();
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    this.busyChange.emit(value);
    this.cdr.markForCheck();
  }

  private currentKey(): string {
    return JSON.stringify([
      this.instructorId,
      this.date,
      this.start,
      this.end,
    ]);
  }

  private validateRange(): void {
    if (!this.instructorId || !this.date) {
      throw new Error('יש לבחור מדריך ותאריך');
    }

    if (!this.start || !this.end || this.start >= this.end) {
      throw new Error(
        'יש לבחור טווח שעות תקין באותו יום',
      );
    }
  }

  private async loadInstructors(): Promise<void> {
    this.setBusy(true);

    try {
      const data = await this.api.call<{
        instructors: Array<{ id: string; name: string }>;
      }>('reference');

      this.instructors = data.instructors ?? [];
    } catch (error: any) {
      this.error =
        error?.message || 'טעינת המדריכים נכשלה';
    } finally {
      this.setBusy(false);
    }
  }

  clearPreview(): void {
    this.candidates = [];
    this.previewLoaded = false;
    this.previewKey = '';
    this.error = '';
    this.success = '';
  }

  choose(person: ExternalSubstitute): void {
    if (!person.is_active) {
      this.error = 'המחליף אינו פעיל לשיבוצים חדשים';
      return;
    }

    this.chosen = person;
    this.pickerOpen = false;
    this.error = '';
    this.success = '';
  }

  isCancelled(row: Candidate): boolean {
    return (
      row.status === 'בוטל' ||
      row.is_cancellation === true
    );
  }

  canSelect(row: Candidate): boolean {
    if (!row.fully_covered || row.external_id) {
      return false;
    }

    if (this.isCancelled(row)) {
      return row.canceller_role === 'secretary';
    }

    return (
      row.status === 'אושר' ||
      row.status === 'הושלם'
    );
  }

  toggleSlot(row: Candidate): void {
    if (!this.canSelect(row)) {
      return;
    }

    const nextValue = !row.selected;

    for (const candidate of this.candidates) {
      const sameSlot =
        candidate.start_time === row.start_time &&
        candidate.end_time === row.end_time;

      if (sameSlot && this.canSelect(candidate)) {
        candidate.selected = nextValue;

        if (!nextValue) {
          candidate.restore = false;
        }
      }
    }
  }

  get selectedCount(): number {
    return this.candidates.filter(row => row.selected).length;
  }

  async preview(): Promise<void> {
    if (this.busy) {
      return;
    }

    this.error = '';
    this.success = '';
    this.candidates = [];
    this.previewLoaded = false;
    this.previewKey = '';

    try {
      this.validateRange();
      this.setBusy(true);

      const key = this.currentKey();

      const rows = await this.api.call<
        Array<Omit<Candidate, 'selected' | 'restore'>>
      >('preview', {
        instructor_id: this.instructorId,
        date: this.date,
        start: this.start,
        end: this.end,
      });

      this.candidates = rows.map(row => ({
        ...row,
        selected: false,
        restore: false,
      }));

      this.previewKey = key;
      this.previewLoaded = true;
    } catch (error: any) {
      this.error =
        error?.message || 'בדיקת השיעורים נכשלה';
    } finally {
      this.setBusy(false);
    }
  }

  async save(): Promise<void> {
    if (this.busy) {
      return;
    }

    this.error = '';
    this.success = '';

    try {
      this.validateRange();

      if (!this.chosen?.is_active) {
        throw new Error('יש לבחור מחליף פעיל');
      }

      if (
        !this.previewLoaded ||
        this.previewKey !== this.currentKey()
      ) {
        throw new Error('יש לבצע שוב בדיקת שיעורים');
      }

      const selected = this.candidates.filter(
        row => row.selected,
      );

      if (!selected.length) {
        throw new Error('יש לבחור שיעורים לשיבוץ');
      }

      if (selected.some(row => !this.canSelect(row))) {
        throw new Error('נבחר שיעור שאינו ניתן לשיבוץ');
      }

      if (
        selected.some(
          row => this.isCancelled(row) && !row.restore,
        )
      ) {
        throw new Error(
          'יש לאשר במפורש החזרה של כל שיעור מבוטל שנבחר',
        );
      }

      this.saving = true;
      this.setBusy(true);

      const result = await this.api.call<{
        assigned: number;
        restored: number;
      }>('assign', {
        instructor_id: this.instructorId,
        date: this.date,
        start: this.start,
        end: this.end,
        external_id: this.chosen.id,

        items: selected.map(row => ({
          lesson_id: row.lesson_id,
          fingerprint: row.fingerprint,
          restore: row.restore,
        })),
      });

      this.candidates = [];
      this.previewLoaded = false;
      this.previewKey = '';

      this.success =
        `שויכו ${result.assigned} שיעורים למחליף. ` +
        `הוחזרו ${result.restored} שיעורים מבוטלים.` +
        (
          result.restored > 0
            ? ' הודעות ההחזרה נרשמו וממתינות למנגנון השליחה.'
            : ''
        );

      this.saved.emit();
    } catch (error: any) {
      this.error =
        error?.message || 'שמירת השיבוץ נכשלה';
    } finally {
      this.saving = false;
      this.setBusy(false);
    }
  }
}
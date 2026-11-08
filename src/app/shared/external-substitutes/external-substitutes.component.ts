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

export interface ExternalSubstitute {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
}

@Component({
  selector: 'app-external-substitutes',
  standalone: true,
  imports: [CommonModule, FormsModule],

  template: `
    <section class="substitutes" dir="rtl">
      <header>
        <h3>מחליפים חיצוניים</h3>

        <button
          type="button"
          (click)="startNew()"
          [disabled]="busy"
        >
          הוספת מחליף
        </button>
      </header>

      <p *ngIf="loading" role="status">
        טוען מחליפים…
      </p>

      <p *ngIf="error" class="error" role="alert">
        {{ error }}
      </p>

      <p *ngIf="success" class="success" role="status">
        {{ success }}
      </p>

      <label class="search">
        חיפוש מחליף

        <input
          type="search"
          [(ngModel)]="search"
          placeholder="שם, טלפון או מייל"
        />
      </label>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              <th>מייל</th>
              <th>סטטוס</th>
              <th>פעולות</th>
            </tr>
          </thead>

          <tbody>
            <tr *ngFor="let person of filteredPeople">
              <td>{{ person.full_name }}</td>

              <td>
                <span dir="ltr">{{ person.phone || '—' }}</span>
              </td>

              <td>{{ person.email || '—' }}</td>

              <td>
                {{ person.is_active ? 'פעיל' : 'לא פעיל' }}
              </td>

              <td class="actions">
                <button
                  type="button"
                  (click)="edit(person)"
                  [disabled]="busy"
                >
                  עריכה
                </button>
                <button
  type="button"
  (click)="showLessons(person)"
  [disabled]="busy || lessonsLoading"
>
  שיעורים ששויכו
</button>

                <button
                  *ngIf="selectionMode && person.is_active"
                  type="button"
                  (click)="selected.emit(person)"
                  [disabled]="busy"
                >
                  בחירה
                </button>
              </td>
            </tr>

            <tr *ngIf="!loading && !filteredPeople.length">
              <td colspan="5">
                לא נמצאו מחליפים.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div *ngIf="viewedPerson" class="editor">
  <header>
    <h4>
      שיעורים ששויכו ל־{{ viewedPerson.full_name }}
    </h4>

    <button
      type="button"
      (click)="closeLessons()"
      [disabled]="lessonsLoading"
    >
      סגירה
    </button>
  </header>

  <p *ngIf="lessonsLoading" role="status">
    טוען שיעורים…
  </p>

  <p
    *ngIf="lessonsError"
    class="error"
    role="alert"
  >
    {{ lessonsError }}
  </p>

  <p
    *ngIf="
      !lessonsLoading &&
      !lessonsError &&
      !assignedLessons.length
    "
  >
    עדיין לא שויכו שיעורים למחליף זה.
  </p>

  <div
    class="table-wrap"
    *ngIf="assignedLessons.length"
  >
    <table>
      <thead>
        <tr>
          <th>תאריך</th>
          <th>שעות</th>
          <th>ילד</th>
          <th>סוג רכיבה</th>
          <th>מדריך מקורי</th>
          <th>מצב נוכחי</th>
        </tr>
      </thead>

      <tbody>
        <tr *ngFor="let lesson of assignedLessons">
          <td>
            {{ lesson.occur_date | date:'dd/MM/yyyy' }}
          </td>

          <td dir="ltr">
            {{ lesson.start_time.slice(0, 5) }}–{{
              lesson.end_time.slice(0, 5)
            }}
          </td>

          <td>{{ lesson.child_name || '—' }}</td>

          <td>
            {{ lesson.riding_type_name || '—' }}
          </td>

          <td>
            {{ lesson.original_instructor_name || '—' }}
          </td>

          <td>
            {{
              !lesson.exists_in_schedule
                ? 'לא נמצא בלוח — לבדיקה'
                : lesson.is_cancellation
                  ? 'בוטל'
                  : lesson.status || 'ללא סטטוס'
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <p *ngIf="assignedLessons.length">
    זו רשימת השיעורים לפי ילדים.
    בדוח השעות זמן של משבצת זוגית או קבוצתית
    ייספר פעם אחת.
  </p>
</div>

      <div *ngIf="editorOpen" class="editor">
        <h4>
          {{ editingId ? 'עריכת מחליף' : 'מחליף חדש' }}
        </h4>

        <fieldset [disabled]="busy">
          <div class="fields">
            <label>
              שם מלא *

              <input
                [(ngModel)]="draft.full_name"
                maxlength="160"
                autocomplete="name"
              />
            </label>

            <label>
              טלפון

              <input
                type="tel"
                [(ngModel)]="draft.phone"
                maxlength="60"
              />
            </label>

            <label>
              מייל

              <input
                type="email"
                [(ngModel)]="draft.email"
                maxlength="254"
              />
            </label>

            <label class="notes">
              הערות

              <textarea
                [(ngModel)]="draft.notes"
                maxlength="4000"
                rows="3"
              ></textarea>
            </label>
          </div>

          <label class="checkbox">
            <input
              type="checkbox"
              [(ngModel)]="draft.is_active"
            />

            פעיל לבחירה בשיבוצים חדשים
          </label>

          <div class="actions">
            <button
              type="button"
              (click)="save()"
              [disabled]="!draft.full_name.trim()"
            >
              {{ busy ? 'שומר…' : 'שמירה' }}
            </button>

            <button
              type="button"
              (click)="cancelEdit()"
            >
              ביטול
            </button>
          </div>
        </fieldset>
      </div>
    </section>
  `,

  styles: [`
    :host {
      display: block;
    }

    .substitutes {
      padding: 20px;
      background: white;
      border: 1px solid #e3e8dc;
      border-radius: 14px;
      color: #30382a;
    }

    header,
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    header {
      justify-content: space-between;
    }

    button,
    input,
    textarea {
      font: inherit;
    }

    button {
      padding: 8px 14px;
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

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    input,
    textarea {
      padding: 9px;
      border: 1px solid #ced7c5;
      border-radius: 8px;
      box-sizing: border-box;
      min-width: 0;
    }

    .search {
      max-width: 420px;
      margin: 14px 0;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      text-align: right;
      padding: 12px;
      border-bottom: 1px solid #e6eadd;
    }

    th {
      background: #f4f7ef;
    }

    .editor {
      margin-top: 20px;
      padding: 16px;
      border: 1px solid #e3e8dc;
      border-radius: 12px;
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
        repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }

    .notes {
      grid-column: 1 / -1;
    }

    .checkbox {
      flex-direction: row;
      align-items: center;
      margin: 16px 0;
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
export class ExternalSubstitutesComponent implements OnInit {
  @Input() selectionMode = false;

  @Output()
  selected = new EventEmitter<ExternalSubstitute>();

  @Output()
  substituteSaved = new EventEmitter<ExternalSubstitute>();

  private readonly api = inject(PayrollApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  people: ExternalSubstitute[] = [];

  search = '';
  loading = false;
  busy = false;

  error = '';
  success = '';

  editorOpen = false;
  editingId: string | null = null;

  draft = this.emptyDraft();

  ngOnInit(): void {
    void this.load();
  }

  private emptyDraft() {
    return {
      full_name: '',
      phone: '',
      email: '',
      notes: '',
      is_active: true,
    };
  }

  get filteredPeople(): ExternalSubstitute[] {
    const term = this.search.trim().toLowerCase();

    const matches = this.people.filter(person => {
      if (!term) {
        return true;
      }

      return [
        person.full_name,
        person.phone,
        person.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });

    return [...matches].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, 'he'),
    );
  }

  viewedPerson: ExternalSubstitute | null = null;
assignedLessons: any[] = [];
lessonsLoading = false;
lessonsError = '';

async showLessons(
  person: ExternalSubstitute,
): Promise<void> {
  if (this.busy || this.lessonsLoading) {
    return;
  }

  this.viewedPerson = person;
  this.assignedLessons = [];
  this.lessonsError = '';
  this.lessonsLoading = true;

  try {
    this.assignedLessons = await this.api.call<any[]>(
      'externalLessons',
      {
        external_id: person.id,
      },
    );
  } catch (error: any) {
    this.lessonsError =
      error?.message || 'טעינת השיעורים נכשלה';
  } finally {
    this.lessonsLoading = false;
    this.cdr.markForCheck();
  }
}

closeLessons(): void {
  if (this.lessonsLoading) {
    return;
  }

  this.viewedPerson = null;
  this.assignedLessons = [];
  this.lessonsError = '';
}

  async load(): Promise<void> {
    if (this.loading || this.busy) {
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const result = await this.api.call<{
        externals: ExternalSubstitute[];
      }>('reference');

      this.people = result.externals ?? [];
    } catch (error: any) {
      this.error =
        error?.message || 'טעינת המחליפים נכשלה';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  startNew(): void {
    if (this.busy) {
      return;
    }

    this.editingId = null;
    this.draft = this.emptyDraft();

    this.error = '';
    this.success = '';
    this.editorOpen = true;
  }

  edit(person: ExternalSubstitute): void {
    if (this.busy) {
      return;
    }

    this.editingId = person.id;

    this.draft = {
      full_name: person.full_name,
      phone: person.phone ?? '',
      email: person.email ?? '',
      notes: person.notes ?? '',
      is_active: person.is_active,
    };

    this.error = '';
    this.success = '';
    this.editorOpen = true;
  }

  cancelEdit(): void {
    if (this.busy) {
      return;
    }

    this.editingId = null;
    this.draft = this.emptyDraft();
    this.editorOpen = false;
  }

  async save(): Promise<void> {
    if (this.busy) {
      return;
    }

    const fullName = this.draft.full_name.trim();

    if (!fullName) {
      this.error = 'יש להזין שם מלא';
      return;
    }

    this.busy = true;
    this.error = '';
    this.success = '';

    try {
      const person =
        await this.api.call<ExternalSubstitute>(
          'saveExternal',
          {
            ...this.draft,
            full_name: fullName,

            ...(this.editingId
              ? { id: this.editingId }
              : {}),
          },
        );

      const index = this.people.findIndex(
        existing => existing.id === person.id,
      );

      if (index >= 0) {
        this.people = this.people.map(existing =>
          existing.id === person.id
            ? person
            : existing,
        );
      } else {
        this.people = [...this.people, person];
      }

      this.editingId = null;
      this.draft = this.emptyDraft();
      this.editorOpen = false;

      this.success = 'פרטי המחליף נשמרו בהצלחה';

      this.substituteSaved.emit(person);
    } catch (error: any) {
      this.error =
        error?.message || 'שמירת המחליף נכשלה';
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
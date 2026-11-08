import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  inject,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PayrollApiService,
} from '../../services/payroll-api.service';

interface PaymentType {
  id: string;
  name: string;
  is_active: boolean;
}

interface RidingType {
  id: string;
  name: string;
  is_active: boolean;
}

interface PaymentRule {
  id: string;
  riding_type_id: string;
  payment_type_id: string;
  min_participants: number;
  max_participants: number;
  is_active: boolean;
}

interface HourlyRate {
  id: string;
  instructor_id: string;
  payment_type_id: string | null;
  hourly_agorot: number;
  effective_from: string;
}

interface PayrollReference {
  paymentTypes: PaymentType[];
  ridingTypes: RidingType[];
  paymentRules: PaymentRule[];
  rates: HourlyRate[];
}

interface RateEditorRow {
  paymentType: PaymentType;
  hourly: number | null;
  effectiveFrom: string | null;
}

@Component({
  selector: 'app-instructor-payroll',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
  ],

  template: `
    <section class="payroll" dir="rtl">
      <h3>תעריפי שכר — {{ instructorName }}</h3>

      <p class="error" *ngIf="error" role="alert">
        {{ error }}
      </p>

      <p class="success" *ngIf="success" role="status">
        {{ success }}
      </p>

      <p *ngIf="busy" role="status">טוען / שומר…</p>

      <fieldset [disabled]="busy">
        <nav aria-label="תעריפי שכר">
          <button
            type="button"
            [class.active]="tab === 'rates'"
            (click)="tab = 'rates'"
          >
            תעריפי המדריך
          </button>

          <button
            type="button"
            [class.active]="tab === 'types'"
            (click)="tab = 'types'"
          >
            סוגי תשלום
          </button>

          <button
            type="button"
            [class.active]="tab === 'rules'"
            (click)="tab = 'rules'"
          >
            שיוך לסוגי רכיבה
          </button>
        </nav>

        <!-- תעריפי המדריך -->
        <div *ngIf="tab === 'rates'">
          <label class="date-field">
            תאריך תחולה לתעריפים שנשמור

            <input
              type="date"
              [(ngModel)]="rateDate"
              (ngModelChange)="rebuildRateRows()"
            />
          </label>

          <p>
            התעריפים הם בשקלים לשעה.
            מוצג התעריף האחרון שבתוקף לתאריך שנבחר.
            שמירה מוסיפה גרסת תעריף מאותו תאריך.
          </p>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>סוג תשלום</th>
                  <th>₪ לשעה</th>
                  <th>בתוקף מתאריך</th>
                  <th>פעולה</th>
                </tr>
              </thead>

              <tbody>
                <tr *ngFor="let row of rateRows">
                  <td>{{ row.paymentType.name }}</td>

                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      [(ngModel)]="row.hourly"
                      placeholder="חסר תעריף"
                      [attr.aria-label]="
                        'תעריף לשעה עבור ' + row.paymentType.name
                      "
                    />
                  </td>

                  <td>
                    {{
                      row.effectiveFrom
                        ? (row.effectiveFrom | date:'dd/MM/yyyy')
                        : 'טרם הוגדר'
                    }}
                  </td>

                  <td>
                    <button
                      type="button"
                      (click)="saveRate(row)"
                    >
                      שמירה
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            הפסקה המשויכת ל״פרטי״ מקבלת את אותו תעריף.
            אינטק נכלל בסוג השיעור הרגיל.
          </p>
        </div>

        <!-- סוגי תשלום משותפים לחווה -->
        <div *ngIf="tab === 'types'">
          <p>
            רשימת סוגי התשלום משותפת לכל מדריכי החווה.
            התעריף עצמו נקבע בנפרד לכל מדריך.
          </p>

          <button type="button" (click)="newType()">
            הוספת סוג תשלום
          </button>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מצב</th>
                  <th>פעולה</th>
                </tr>
              </thead>

              <tbody>
                <tr *ngFor="let type of reference.paymentTypes">
                  <td>{{ type.name }}</td>
                  <td>{{ type.is_active ? 'פעיל' : 'לא פעיל' }}</td>
                  <td>
                    <button type="button" (click)="editType(type)">
                      עריכה
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="editor" *ngIf="typeEditorOpen">
            <h4>
              {{ typeEdit.id ? 'עריכת סוג תשלום' : 'סוג תשלום חדש' }}
            </h4>

            <label>
              שם סוג התשלום
              <input [(ngModel)]="typeEdit.name" maxlength="100" />
            </label>

            <label class="check">
              <input type="checkbox" [(ngModel)]="typeEdit.is_active" />
              פעיל
            </label>

            <button type="button" (click)="saveType()">שמירה</button>

            <button type="button" (click)="typeEditorOpen = false">
              ביטול
            </button>
          </div>
        </div>

        <!-- שיוכים משותפים לחווה -->
        <div *ngIf="tab === 'rules'">
          <p>
            כאן קובעים איזה סוג תשלום מתאים לסוג הרכיבה
            ולמספר הילדים במשבצת. השיוכים משותפים לחווה.
          </p>

          <button type="button" (click)="newRule()">
            הוספת שיוך
          </button>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>סוג רכיבה</th>
                  <th>ממספר ילדים</th>
                  <th>עד מספר ילדים</th>
                  <th>סוג תשלום</th>
                  <th>מצב</th>
                  <th>פעולה</th>
                </tr>
              </thead>

              <tbody>
                <tr *ngFor="let rule of reference.paymentRules">
                  <td>{{ ridingName(rule.riding_type_id) }}</td>
                  <td>{{ rule.min_participants }}</td>
                  <td>{{ rule.max_participants }}</td>
                  <td>{{ paymentName(rule.payment_type_id) }}</td>
                  <td>{{ rule.is_active ? 'פעיל' : 'לא פעיל' }}</td>
                  <td>
                    <button type="button" (click)="editRule(rule)">
                      עריכה
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="editor" *ngIf="ruleEditorOpen">
            <h4>{{ ruleEdit.id ? 'עריכת שיוך' : 'שיוך חדש' }}</h4>

            <div class="fields">
              <label>
                סוג רכיבה

                <select [(ngModel)]="ruleEdit.riding_type_id">
                  <option value="">בחרי סוג רכיבה</option>

                  <option
                    *ngFor="let riding of reference.ridingTypes"
                    [value]="riding.id"
                  >
                    {{ riding.name }}{{ riding.is_active ? '' : ' (לא פעיל)' }}
                  </option>
                </select>
              </label>

              <label>
                ממספר ילדים
                <input
                  type="number"
                  min="0"
                  step="1"
                  [(ngModel)]="ruleEdit.min_participants"
                />
              </label>

              <label>
                עד מספר ילדים
                <input
                  type="number"
                  min="0"
                  step="1"
                  [(ngModel)]="ruleEdit.max_participants"
                />
              </label>

              <label>
                סוג תשלום

                <select [(ngModel)]="ruleEdit.payment_type_id">
                  <option value="">בחרי סוג תשלום</option>

                  <option
                    *ngFor="let type of reference.paymentTypes"
                    [value]="type.id"
                  >
                    {{ type.name }}{{ type.is_active ? '' : ' (לא פעיל)' }}
                  </option>
                </select>
              </label>
            </div>

            <label class="check">
              <input type="checkbox" [(ngModel)]="ruleEdit.is_active" />
              שיוך פעיל
            </label>

            <button type="button" (click)="saveRule()">שמירה</button>

            <button type="button" (click)="ruleEditorOpen = false">
              ביטול
            </button>
          </div>

          <p>
            דוגמה: ״זוגי או פרטי״ עם טווח 1–1 משויך לפרטי,
            ועם טווח 2–2 משויך לזוגי.
            הפסקה משויכת לפרטי בטווח 0–0.
          </p>
        </div>
      </fieldset>
    </section>
  `,

  styles: [`
    :host { display: block; }

    .payroll {
      padding: 18px;
      color: #30382a;
    }

    nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }

    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    input, select, button {
      font: inherit;
    }

    input, select {
      padding: 9px;
      border: 1px solid #ced7c5;
      border-radius: 8px;
      min-width: 0;
      box-sizing: border-box;
    }

    input[type=number] {
      width: 140px;
    }

    button {
      padding: 8px 14px;
      margin: 4px;
      border: 1px solid #cbd7b9;
      border-radius: 8px;
      background: #f6f8f1;
      color: #344227;
      cursor: pointer;
    }

    button.active {
      background: #738b48;
      color: white;
    }

    button:disabled {
      opacity: .5;
      cursor: default;
    }

    .date-field {
      max-width: 280px;
    }

    .table-wrap {
      overflow-x: auto;
      margin: 16px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      text-align: right;
      padding: 12px;
      border-bottom: 1px solid #e6eadd;
    }

    th {
      background: #f4f7ef;
    }

    .editor {
      padding: 16px;
      border: 1px solid #e3e8dc;
      border-radius: 12px;
      margin: 16px 0;
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }

    .check {
      flex-direction: row;
      align-items: center;
      margin: 14px 0;
    }

    p {
      line-height: 1.7;
    }

    .error, .success {
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
export class InstructorPayrollComponent implements OnChanges {
  @Input() instructorId = '';
  @Input() instructorName = '';

  @Output() busyChange = new EventEmitter<boolean>();

  private readonly api = inject(PayrollApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  tab: 'rates' | 'types' | 'rules' = 'rates';

  busy = false;
  error = '';
  success = '';

  reference: PayrollReference = {
    paymentTypes: [],
    ridingTypes: [],
    paymentRules: [],
    rates: [],
  };

  rateDate = this.today();
  rateRows: RateEditorRow[] = [];

  typeEditorOpen = false;
  typeEdit = {
    id: '',
    name: '',
    is_active: true,
  };

  ruleEditorOpen = false;
  ruleEdit = {
    id: '',
    riding_type_id: '',
    payment_type_id: '',
    min_participants: 1 as number | null,
    max_participants: 1 as number | null,
    is_active: true,
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['instructorId']) {
      this.rebuildRateRows();

      if (this.instructorId) {
        void this.run(async () => {
          await this.refreshReference();
        });
      }
    }
  }

  private today(): string {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }

    this.busy = true;
    this.busyChange.emit(true);
    this.error = '';
    this.success = '';

    try {
      await action();
    } catch (error: any) {
      this.error = error?.message || 'הפעולה נכשלה';
    } finally {
      this.busy = false;
      this.busyChange.emit(false);
      this.cdr.markForCheck();
    }
  }

  private async refreshReference(): Promise<void> {
    this.reference =
      await this.api.call<PayrollReference>('reference');

    this.rebuildRateRows();
  }

  rebuildRateRows(): void {
    this.rateRows = this.reference.paymentTypes
      .filter(type => type.is_active)
      .map(paymentType => {
        const latest = this.reference.rates
          .filter(rate =>
            rate.instructor_id === this.instructorId &&
            rate.payment_type_id === paymentType.id &&
            rate.effective_from <= this.rateDate,
          )
          .sort((a, b) =>
            b.effective_from.localeCompare(a.effective_from),
          )[0];

        return {
          paymentType,
          hourly: latest ? latest.hourly_agorot / 100 : null,
          effectiveFrom: latest?.effective_from ?? null,
        };
      });
  }

  async saveRate(row: RateEditorRow): Promise<void> {
    await this.run(async () => {
      if (!this.instructorId || !this.rateDate) {
        throw new Error('חסר מדריך או תאריך תחולה');
      }

      const value = row.hourly;

      if (
        value === null ||
        !Number.isFinite(value) ||
        value < 0 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
      ) {
        throw new Error(
          'יש להזין תעריף תקין בשקלים, עד שתי ספרות אחרי הנקודה',
        );
      }

      const saved = await this.api.call<HourlyRate>(
        'savePaymentRate',
        {
          instructor_id: this.instructorId,
          payment_type_id: row.paymentType.id,
          hourly_agorot: Math.round(value * 100),
          effective_from: this.rateDate,
        },
      );

      this.reference.rates = [...this.reference.rates, saved];
      row.effectiveFrom = saved.effective_from;

      this.success = `התעריף עבור ${row.paymentType.name} נשמר`;
    });
  }

  paymentName(id: string): string {
    return this.reference.paymentTypes
      .find(type => type.id === id)?.name ?? 'סוג לא נמצא';
  }

  ridingName(id: string): string {
    return this.reference.ridingTypes
      .find(type => type.id === id)?.name ?? 'סוג לא נמצא';
  }

  newType(): void {
    this.typeEdit = {
      id: '',
      name: '',
      is_active: true,
    };

    this.typeEditorOpen = true;
  }

  editType(type: PaymentType): void {
    this.typeEdit = {
      id: type.id,
      name: type.name,
      is_active: type.is_active,
    };

    this.typeEditorOpen = true;
  }

  async saveType(): Promise<void> {
    await this.run(async () => {
      if (!this.typeEdit.name.trim()) {
        throw new Error('יש להזין שם לסוג התשלום');
      }

      const saved = await this.api.call<PaymentType>(
        'savePaymentType',
        { ...this.typeEdit },
      );

      this.reference.paymentTypes = [
        ...this.reference.paymentTypes.filter(type => type.id !== saved.id),
        saved,
      ].sort((a, b) => a.name.localeCompare(b.name, 'he'));

      this.rebuildRateRows();
      this.typeEditorOpen = false;
      this.success = 'סוג התשלום נשמר';
    });
  }

  newRule(): void {
    this.ruleEdit = {
      id: '',
      riding_type_id: '',
      payment_type_id: '',
      min_participants: 1,
      max_participants: 1,
      is_active: true,
    };

    this.ruleEditorOpen = true;
  }

  editRule(rule: PaymentRule): void {
    this.ruleEdit = { ...rule };
    this.ruleEditorOpen = true;
  }

  async saveRule(): Promise<void> {
    await this.run(async () => {
      const row = { ...this.ruleEdit };

      if (!row.riding_type_id || !row.payment_type_id) {
        throw new Error('יש לבחור סוג רכיבה וסוג תשלום');
      }

      if (
        row.min_participants === null ||
        row.max_participants === null ||
        !Number.isInteger(row.min_participants) ||
        !Number.isInteger(row.max_participants) ||
        row.min_participants < 0 ||
        row.max_participants < row.min_participants
      ) {
        throw new Error('יש להזין טווח תקין של מספר ילדים');
      }

      const saved = await this.api.call<PaymentRule>(
        'savePaymentRule',
        row,
      );

      this.reference.paymentRules = [
        ...this.reference.paymentRules.filter(rule => rule.id !== saved.id),
        saved,
      ];

      this.ruleEditorOpen = false;
      this.success = 'השיוך נשמר';
    });
  }
}
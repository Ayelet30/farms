// src/app/pages/secretary-children/add-child-dialog/add-child-dialog.component.ts
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
  FormControl,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';

import { MatDialogRef } from '@angular/material/dialog';
import { Component, ViewEncapsulation, OnInit } from '@angular/core';

import { ensureTenantContextReady, dbTenant } from '../../../services/legacy-compat';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
//  Angular Material
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatOptionModule } from '@angular/material/core';

export type AddChildPayload = {
  first_name: string;
  last_name: string;
  parent_uid: string;
  gov_id?: string;
  birth_date?: string;
  gender?: string;
  health_fund?: string;
  status?: string;
  medical_notes?: string;
  behavior_notes?: string;
};

// למעלה: הטייפ
type ParentOption = {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  gov_id: string | null;
};

// ✅ ולידטור לתעודת זהות ישראלית (9 ספרות + ספרת ביקורת)
function israeliIdValidator(control: AbstractControl): ValidationErrors | null {
  let id = (control.value || '').toString().trim();

  // אם ריק – לא נטפל פה, זה תפקיד ה-Validators.required
  if (!id) return null;

  // רק ספרות
  id = id.replace(/\D/g, '');

  if (id.length > 9 || id.length < 5) {
    return { invalidIsraeliId: true };
  }

  // השלמה ל-9 ספרות משמאל
  id = id.padStart(9, '0');

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let num = Number(id[i]) * ((i % 2) + 1); // כפול 1,2,1,2...
    if (num > 9) num = (num % 10) + 1;       // סכימת ספרות
    sum += num;
  }

  return sum % 10 === 0 ? null : { invalidIsraeliId: true };
}


@Component({
  selector: 'app-add-child-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatOptionModule,
  ],
  templateUrl: './add-child-dialog.component.html',
  styleUrls: ['./add-child-dialog.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class AddChildDialogComponent implements OnInit {
  form!: FormGroup;
  submitting = false;

  /** כל ההורים מהחווה */
  parents: ParentOption[] = [];

  /** רשימת הורים מסוננת לפי הטקסט שהמזכירה מקלידה */
  filteredParents: ParentOption[] = [];

  /** 🌟 שדה החיפוש – יכול להיות טקסט או האובייקט של ההורה */
parentSearchControl = new FormControl<ParentOption | string>('', { nonNullable: true });


  loadingParents = true;
  parentsError: string | null = null;

   genderOptions: string[] = ['זכר', 'נקבה'];

   healthFundOptions: string[] = ['כללית', 'מכבי', 'מאוחדת', 'לאומית', 'אחר'];

   statusOptions = [
 { value: 'Active', label: 'פעיל' },
  ];

  constructor(
    private fb: FormBuilder,
    private ref: MatDialogRef<AddChildDialogComponent>
  ) {
    this.form = this.fb.group({
  first_name: ['', [Validators.required, Validators.minLength(2)]],
  last_name: ['', [Validators.required, Validators.minLength(2)]],

  // חייב לבחור הורה
  parent_uid: ['', [Validators.required]],

  // תעודת זהות – חובה + בדיקת תקינות
  gov_id: ['', [Validators.required, israeliIdValidator]],

   birth_date: ['', [Validators.required]],


  // מין – חובה
  gender: ['', [Validators.required]],

  // קופת חולים – חובה
  health_fund: ['', [Validators.required]],

  // סטטוס – חובה (כרגע יש רק 'Active')
  status: ['', [Validators.required]],

  medical_notes: [''],
  behavior_notes: [''],
});
 }

  async ngOnInit() {
    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const { data, error } = await db
        .from('parents')
        .select('uid, first_name, last_name, id_number')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      // ממפים id_number ל-gov_id כדי שיתאים לטייפ שלנו
      this.parents =
        (data ?? []).map((p: any) => ({
          uid: p.uid,
          first_name: p.first_name,
          last_name: p.last_name,
          gov_id: p.id_number ?? null,
        })) ?? [];

      this.filteredParents = [...this.parents];

      // כל שינוי בטקסט → סינון רשימת ההורים
      this.parentSearchControl.valueChanges.subscribe((term) => {
        // אם term הוא אובייקט – קודם הופכים אותו לטקסט יפה
        const asText =
          typeof term === 'string' ? term : this.displayParent(term);
        const q = (asText || '').trim().toLowerCase();

        if (!q) {
          this.filteredParents = [...this.parents];
          return;
        }

        this.filteredParents = this.parents.filter((p) => {
          const fullName =
            `${p.first_name ?? ''} ${p.last_name ?? ''}`.toLowerCase();
          const gov = (p.gov_id ?? '').toLowerCase();
          return fullName.includes(q) || gov.includes(q);
        });
      });
    } catch (e: any) {
      console.error(e);
      this.parentsError = e?.message || 'נכשלה טעינת רשימת ההורים';
    } finally {
      this.loadingParents = false;
    }
  }

  /** פונקציה שמחזירה טקסט יפה להצגה */
 displayParent(p?: ParentOption | string | null): string {
  if (!p) return '';
  if (typeof p === 'string') return p;

  const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
  if (p.gov_id) return `${full} (${p.gov_id})`;
  return full || p.uid;
}

  /** ✅ כשנבחר הורה מהרשימה */

onParentSelected(event: MatAutocompleteSelectedEvent) {
  const p = event.option.value as ParentOption;
  if (!p) return;

  // בטופס נשמר רק ה-uid של ההורה
  this.form.patchValue({ parent_uid: p.uid });

  // בשדה החיפוש מוצג הטקסט היפה
  this.parentSearchControl.setValue(this.displayParent(p), { emitEvent: false });
}

  // ✅ מסיכת תאריך לידה – DD/MM/YYYY
  onBirthDateInput(event: Event) {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, ''); // משאירים רק מספרים

    // מקסימום 8 ספרות: DDMMYYYY
    if (value.length > 8) {
      value = value.slice(0, 8);
    }

    let result = '';

    if (value.length >= 1) {
      // יום – אם יש ספרה אחת, לא נוסיף אפס עדיין, רק נשמור
      result = value.slice(0, 2);
    }
    if (value.length > 2) {
      result = value.slice(0, 2) + '/' + value.slice(2, 4);
    }
    if (value.length > 4) {
      result = value.slice(0, 2) + '/' + value.slice(2, 4) + '/' + value.slice(4);
    }

    input.value = result;
    this.form.patchValue({ birth_date: result }, { emitEvent: false });
  }


  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const ok = confirm('האם את בטוחה שברצונך לשמור את השינויים?');
    if (!ok) return;

    this.submitting = true;

    const v = this.form.value as any;

    const payload: AddChildPayload = {
      first_name: v.first_name,
      last_name: v.last_name,
      parent_uid: v.parent_uid,
      gov_id: v.gov_id || undefined,
      birth_date: v.birth_date || undefined,
      gender: v.gender || undefined,
      health_fund: v.health_fund || undefined,
      status: v.status || undefined,
      medical_notes: v.medical_notes || undefined,
      behavior_notes: v.behavior_notes || undefined,
    };

    this.ref.close(payload);
  }

  cancel() {
    const ok = confirm('האם את בטוחה שברצונך לבטל את השינויים?');
    if (!ok) return;
    this.ref.close();
  }
}

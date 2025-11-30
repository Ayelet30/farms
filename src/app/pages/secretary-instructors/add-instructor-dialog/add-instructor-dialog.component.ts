import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Component, ViewEncapsulation } from '@angular/core';

export type AddInstructorPayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  id_number: string;
  address?: string;
  gender?: string;       // "זכר" / "נקבה" / אחר
  license_id?: string;
  education?: string;
  about?: string;
};

@Component({
  selector: 'app-add-instructor-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './add-instructor-dialog.component.html',
  styleUrls: ['./add-instructor-dialog.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class AddInstructorDialogComponent {
  form!: FormGroup;
  submitting = false;

  constructor(
    private fb: FormBuilder,
    private ref: MatDialogRef<AddInstructorDialogComponent>
  ) {
    this.form = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required]],
      id_number: ['', [Validators.required]],
      address: [''],
      gender: [''],      // לא חובה
      license_id: [''],  // רישיון מדריך
      education: [''],   // השכלה / קורסים
      about: [''],       // טקסט חופשי
    });
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const ok = confirm('להוסיף את המדריך למערכת?');
    if (!ok) return;

    this.submitting = true;

    const v = this.form.value as any;

    const payload: AddInstructorPayload = {
      first_name: v.first_name,
      last_name: v.last_name,
      email: v.email,
      phone: v.phone || undefined,
      id_number: v.id_number,
      address: v.address || undefined,
      gender: v.gender || undefined,
      license_id: v.license_id || undefined,
      education: v.education || undefined,
      about: v.about || undefined,
    };

    this.ref.close(payload);
  }

  cancel() {
    const ok = confirm('לבטל ללא שמירה?');
    if (!ok) return;

    this.ref.close();
  }
}

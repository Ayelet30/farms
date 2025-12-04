import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Component, ViewEncapsulation } from '@angular/core';

export type AddParentPayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  id_number?: string;
  address?: string;
  extra_notes?: string;
  message_preferences?: string[]; // ['inapp','email','sms','whatsapp']
};

@Component({
  selector: 'app-add-parent-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './add-parent-dialog.component.html',
  styleUrls: ['./add-parent-dialog.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class AddParentDialogComponent {
  form!: FormGroup;
  submitting = false; // בשביל [disabled]="submitting" ב-HTML

  constructor(
    private fb: FormBuilder,
    private ref: MatDialogRef<AddParentDialogComponent>
  ) {
   this.form = this.fb.group({
  first_name: [
    '',
    [
      Validators.required,
      Validators.minLength(2),
      Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/) // רק אותיות עברית/אנגלית
    ]
  ],
  last_name: [
    '',
    [
      Validators.required,
      Validators.minLength(2),
      Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/)
    ]
  ],
  email: [
    '',
    [
      Validators.required,
      Validators.email
    ]
  ],
  phone: [
    '',
    [
      Validators.required,
      Validators.pattern(/^05\d{8}$/) // טלפון ישראלי
    ]
  ],
  id_number: [
    '',
    [
      Validators.required,
      Validators.pattern(/^\d{9}$/) // רק ספרות — 9 תווים
    ]
  ],
  address: ['', Validators.required],

  extra_notes: [''],

  prefs: this.fb.group({
    inapp: [{ value: true, disabled: true }], 
    email: [false],
    sms: [false],
    whatsapp: [false],
  })
});

  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const ok = confirm('האם את בטוחה שברצונך לשמור את השינויים?');
    if (!ok) return;

    this.submitting = true;

    const v = this.form.getRawValue() as any; // getRawValue כי inapp disabled
    const prefsGroup = v.prefs || {};

    const prefs: string[] = ['inapp'];
    ['email', 'sms', 'whatsapp'].forEach((k) => {
      if (prefsGroup[k]) prefs.push(k);
    });

    const payload: AddParentPayload = {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      email: v.email.trim(),
      phone: v.phone?.trim() || undefined,
      id_number: v.id_number?.trim() || undefined,
      address: v.address?.trim() || undefined,
      extra_notes: v.extra_notes?.trim() || undefined,
      message_preferences: prefs,
    };

    this.ref.close(payload);
  }

  cancel() {
    const ok = confirm('האם את בטוחה שברצונך לבטל את השינויים?');
    if (!ok) return;

    this.ref.close();
  }
}

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
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required]],
      id_number: ['', [Validators.required]],
      address: ['', [Validators.required]],
      extra_notes: [''],
      prefs: this.fb.group({
        inapp: [{ value: true, disabled: true }], // תמיד מסומן ואי אפשר לבטל
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

    // 🔔 פופ־אפ לפני שמירה
    const ok = confirm('האם את בטוחה שברצונך לשמור את השינויים?');
    if (!ok) return;

    this.submitting = true;

    const v = this.form.getRawValue() as any; // getRawValue כי inapp disabled
    const prefsGroup = v.prefs || {};

    // תמיד מוסיפים inapp
    const prefs: string[] = ['inapp'];
    ['email', 'sms', 'whatsapp'].forEach((k) => {
      if (prefsGroup[k]) prefs.push(k);
    });

    const payload: AddParentPayload = {
      first_name: v.first_name,
      last_name: v.last_name,
      email: v.email,
      phone: v.phone || undefined,
      id_number: v.id_number || undefined,
      address: v.address || undefined,
      extra_notes: v.extra_notes || undefined,
      message_preferences: prefs,
    };

    this.ref.close(payload);
  }

  cancel() {
    // 🔔 פופ־אפ ביטול
    const ok = confirm('האם את בטוחה שברצונך לבטל את השינויים?');
    if (!ok) return;

    this.ref.close();
  }
}

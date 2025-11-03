
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Component, ViewEncapsulation } from '@angular/core';

export type AddParentPayload = {
  full_name: string;
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

  constructor(private fb: FormBuilder, private ref: MatDialogRef<AddParentDialogComponent>) {
    this.form = this.fb.group({
  full_name: ['', [Validators.required, Validators.minLength(2)]],
  email: ['', [Validators.required, Validators.email]],
  phone: ['', [Validators.required]],
  id_number: ['', [Validators.required]],
  address: ['', [Validators.required]],
  extra_notes: ['', [Validators.required]],
  prefs: this.fb.group({
    inapp: [true],
    email: [true],     
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

  const v = this.form.value as any;
  const prefsGroup = v.prefs || {};
  const prefs: string[] = Object.keys(prefsGroup).filter(k => !!prefsGroup[k]);

  const payload: AddParentPayload = {
    full_name: v.full_name,
    email: v.email,
    phone: v.phone || undefined,
    id_number: v.id_number || undefined,
    address: v.address || undefined,
    extra_notes: v.extra_notes || undefined,
    message_preferences: prefs.length ? prefs : ['inapp'],
  };

  this.ref.close(payload);
}


  cancel() { this.ref.close(); }
}

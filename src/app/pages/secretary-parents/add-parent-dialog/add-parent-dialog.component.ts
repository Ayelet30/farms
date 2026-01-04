import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import {
  Component,
  ViewEncapsulation,
  OnInit,           
} from '@angular/core';

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
  encapsulation: ViewEncapsulation.None,
})
export class AddParentDialogComponent implements OnInit {  // ✅ חדש: implements OnInit
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
          Validators.maxLength(15), // 👈 שם פרטי עד 15 תווים
          Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/), // עברית/אנגלית בלבד
        ],
      ],
      last_name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(20), // 👈 שם משפחה עד 20 תווים
          Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/),
        ],
      ],
      email: [
        '',
        [
          Validators.required,
          Validators.email,
          Validators.maxLength(60), // 👈 אימייל עד 60 תווים
        ],
      ],
      phone: [
        '',
        [
          Validators.required,
          Validators.pattern(/^05\d{8}$/), // טלפון ישראלי 05XXXXXXXX
          // regex כבר מבטיח 10 ספרות
        ],
      ],
      id_number: [
        '',
        [
          Validators.required,
          Validators.pattern(/^\d{9}$/), // 9 ספרות בלבד
        ],
      ],
      address: [
        '',
        [
          Validators.required,
          Validators.maxLength(60), // 👈 כתובת עד 60 תווים
        ],
      ],
      extra_notes: [
        '',
        [
          Validators.maxLength(300), // 👈 הערות עד 300 תווים
        ],
      ],
      prefs: this.fb.group({
        inapp: [{ value: true, disabled: true }],
        email: [false],
        sms: [false],
        whatsapp: [false],
      }),
    });
  }

  // ✅ חדש: חיבור הקליק מחוץ לחלון לאותה לוגיקת ביטול
  ngOnInit(): void {
    this.ref.backdropClick().subscribe(() => {
      this.cancel(); // יתנהג כמו לחיצה על "ביטול"
    });
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const ok = confirm('האם אתה בטוח שברצונך לשמור את השינויים?');
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
    const ok = confirm('האם אתה בטוח שברצונך לבטל את השינויים?');
    if (!ok) return;

    this.ref.close();
  }
}

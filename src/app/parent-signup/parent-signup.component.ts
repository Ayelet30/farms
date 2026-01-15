import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-parent-public-signup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './parent-signup.component.html',
  styleUrls: ['./parent-signup.component.scss'],
})
export class ParentPublicSignupComponent {
  submitting = false;
  done = false;
  errorMsg = '';
  farmCode = 'bereshit_farm';

  form!: FormGroup;

  constructor(private fb: FormBuilder, private route: ActivatedRoute) {

    this.farmCode = (this.route.snapshot.paramMap.get('farm') || 'bereshit_farm').toLowerCase();

    this.form = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(15), Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/)]],
      last_name:  ['', [Validators.required, Validators.minLength(2), Validators.maxLength(20), Validators.pattern(/^[A-Za-z\u0590-\u05FF\s]+$/)]],
      email:      ['', [Validators.required, Validators.email, Validators.maxLength(60)]],
      phone:      ['', [Validators.required, Validators.pattern(/^05\d{8}$/)]],
      id_number:  ['', [Validators.required, Validators.pattern(/^\d{9}$/)]],
      address:    ['', [Validators.required, Validators.maxLength(60)]],
      extra_notes:['', [Validators.maxLength(300)]],
      prefs: this.fb.group({
        inapp: [{ value: true, disabled: true }],
        email: [false],
        sms: [false],
        whatsapp: [false],
      }),
    });
  }

  private buildPrefs(v: any): string[] {
    const prefsGroup = v.prefs || {};
    const prefs: string[] = ['inapp'];
    ['email', 'sms', 'whatsapp'].forEach((k) => prefsGroup[k] && prefs.push(k));
    return prefs;
  }

  async submit() {
    this.errorMsg = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    try {
      const v: any = this.form.getRawValue();

      const payload = {
        farmCode: this.farmCode,
        first_name: v.first_name.trim(),
        last_name: v.last_name.trim(),
        email: v.email.trim().toLowerCase(),
        phone: v.phone.trim(),
        id_number: v.id_number.trim(),
        address: v.address.trim(),
        extra_notes: (v.extra_notes || '').trim() || null,
        message_preferences: this.buildPrefs(v),
        referral_url: window.location.href,
      };

     const res = await fetch(
        '/api/publicCreateParentSignupRequest',
        {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        }
        );

        const json = await res.json();

        if (!res.ok) {
        throw new Error(json?.error || 'שגיאה בשליחת הבקשה');
}


      this.done = true;
      this.form.disable();
    } catch (e: any) {
      this.errorMsg = e?.message || 'שגיאה לא צפויה. נסי שוב.';
    } finally {
      this.submitting = false;
    }
  }
}

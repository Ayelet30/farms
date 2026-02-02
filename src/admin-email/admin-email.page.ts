import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { CurrentUserService } from '../app/core/auth/current-user.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

type GmailAttachment = {
  filename: string;
  contentBase64: string;   // base64 נקי (בלי data:...)
  contentType?: string;
};

@Component({
  selector: 'app-admin-email',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-email.page.html',
})
export class AdminEmailPage {
  // חובה
  tenantSchema = '';

  // connectGmailForFarm
  senderEmail = '';
  refreshToken = '';
  gmailClientId = '';
  gmailClientSecret = '';

  // sendEmailGmail
  testTo = '';
  testSubject = 'בדיקת מייל';
  testText = 'בדיקה טקסט';
  testHtml = '<p>בדיקה</p>';
  useHtml = true;

  // attachments
  attachments: GmailAttachment[] = [];

  private cu = inject(CurrentUserService);

  // מומלץ לשים ב-environment, אבל כרגע קבוע
  private readonly CONNECT_URL =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/connectGmailForFarm';

  private readonly SEND_URL =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';

  constructor(private http: HttpClient) {}

  private async authHeaders() {
    const token = await this.cu.getIdToken(true);
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
  }

  private assertTenant() {
    if (!this.tenantSchema?.trim()) {
      throw new Error('חסר tenantSchema (למשל: bereshit_farm)');
    }
  }

  private cleanEmail(s: string) {
    return String(s || '').trim();
  }

  private showHttpError(e: any) {
    // Cloud Function שלך מחזירה: { error: 'Internal error', message: '...' }
    const msg =
      e?.error?.message ||
      e?.error?.error ||
      e?.message ||
      JSON.stringify(e?.error || e, null, 2);

    console.error('HTTP ERROR:', e);
    alert(`שגיאה:\n${msg}`);
  }

  async connectGmail() {
    try {
      this.assertTenant();

      const opts = await this.authHeaders();
      const body = {
        tenantSchema: this.tenantSchema.trim(),
        senderEmail: this.cleanEmail(this.senderEmail),
        refreshToken: String(this.refreshToken || '').trim(),
        gmailClientId: String(this.gmailClientId || '').trim(),
        gmailClientSecret: String(this.gmailClientSecret || '').trim(),
      };

      const resp = await firstValueFrom(this.http.post(this.CONNECT_URL, body, opts));
      console.log('connectGmail resp:', resp);

      alert('Gmail חובר בהצלחה');
    } catch (e: any) {
      this.showHttpError(e);
    }
  }

  async sendTestMail() {
    try {
      this.assertTenant();

      const to = this.cleanEmail(this.testTo);
      if (!to) throw new Error('חסר אימייל יעד (testTo)');
      if (!this.testSubject?.trim()) throw new Error('חסר נושא');

      const opts = await this.authHeaders();

      // חובה לשלוח text או html (אחד מהם לפחות)
      const payload: any = {
        tenantSchema: this.tenantSchema.trim(),
        to: [to],
        subject: this.testSubject.trim(),
      };

      if (this.useHtml) {
        payload.html = this.testHtml?.trim() || '<p>בדיקה</p>';
      } else {
        payload.text = this.testText?.trim() || 'בדיקה';
      }

      if (this.attachments.length) {
        payload.attachments = this.attachments;
      }

      const resp = await firstValueFrom(this.http.post(this.SEND_URL, payload, opts));
      console.log('sendEmailGmail resp:', resp);

      alert('מייל נשלח');
    } catch (e: any) {
      this.showHttpError(e);
    }
  }

  // ===== attachments helpers =====

  async onFilesSelected(ev: Event) {
    try {
      const input = ev.target as HTMLInputElement;
      const files = Array.from(input.files || []);
      if (!files.length) return;

      // מגבלה אצלך בשרת: max 5
      if (files.length + this.attachments.length > 5) {
        throw new Error('מקסימום 5 קבצים מצורפים');
      }

      for (const f of files) {
        const contentBase64 = await this.fileToBase64(f); // נקי בלי prefix
        this.attachments.push({
          filename: f.name,
          contentType: f.type || undefined,
          contentBase64,
        });
      }

      // כדי שאפשר לבחור שוב את אותו קובץ
      input.value = '';
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  removeAttachment(i: number) {
    this.attachments.splice(i, 1);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('קריאת קובץ נכשלה'));
      reader.onload = () => {
        const res = String(reader.result || '');
        // res הוא DataURL: data:application/pdf;base64,XXXX
        const idx = res.indexOf('base64,');
        if (idx >= 0) return resolve(res.slice(idx + 'base64,'.length));
        // אם משום מה זה לא DataURL, ננסה להחזיר כמו שהוא
        resolve(res);
      };
      reader.readAsDataURL(file);
    });
  }
  
}


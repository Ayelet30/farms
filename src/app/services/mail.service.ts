// src/app/services/mail.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CurrentUserService } from '../core/auth/current-user.service'; // ← התאימי נתיב אם שונה

export type SendEmailGmailPayload = {
  tenantSchema: string;

  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];

  subject: string;

  // חייב לפחות אחד:
  text?: string;
  html?: string;

  replyTo?: string;

  attachments?: Array<{
    filename: string;
    contentBase64: string; // base64 נקי בלי data:...;base64,
    contentType?: string;
  }>;
};

@Injectable({ providedIn: 'root' })
export class MailService {
  private cu = inject(CurrentUserService);

  // כמו אצלך בדף שעובד:
  private readonly SEND_URL =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';

  constructor(private http: HttpClient) {}

  private asArray(x: string | string[] | undefined | null): string[] {
    if (!x) return [];
    return Array.isArray(x) ? x : [x];
  }

  async sendEmailGmail(payload: SendEmailGmailPayload): Promise<any> {
    // ולידציות בסיסיות כמו בשרת
    const tenantSchema = String(payload.tenantSchema || '').trim();
    if (!tenantSchema) throw new Error('Missing tenantSchema');

    const to = this.asArray(payload.to).map(s => String(s || '').trim()).filter(Boolean);
    if (!to.length) throw new Error('Missing "to"');
    if (!String(payload.subject || '').trim()) throw new Error('Missing "subject"');
    if (!String(payload.text || '').trim() && !String(payload.html || '').trim()) {
      throw new Error('Provide "text" or "html"');
    }

    const token = await this.cu.getIdToken(true);

    const opts = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    // התאמה לפורמט שהפונקציה שלך מצפה לו
    const body: any = {
      tenantSchema,
      to, // חשוב: לשלוח מערך כמו בדוגמה שעובדת
      subject: String(payload.subject || '').trim(),
    };

    const cc = this.asArray(payload.cc).map(s => String(s || '').trim()).filter(Boolean);
    const bcc = this.asArray(payload.bcc).map(s => String(s || '').trim()).filter(Boolean);
    if (cc.length) body.cc = cc;
    if (bcc.length) body.bcc = bcc;

    const replyTo = String(payload.replyTo || '').trim();
    if (replyTo) body.replyTo = replyTo;

    const text = String(payload.text || '').trim();
    const html = String(payload.html || '').trim();
    if (html) body.html = html;
    else body.text = text;

    if (payload.attachments?.length) body.attachments = payload.attachments;

    return await firstValueFrom(this.http.post(this.SEND_URL, body, opts));
  }
}

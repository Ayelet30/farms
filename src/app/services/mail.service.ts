import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class MailService {
  // שימי את ה-URL של הפונקציה שלך
  private readonly endpoint =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmail';

  async sendEmail(args: {
    tenantSchema: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
  }) {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated');

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.message || json?.error || 'sendEmail failed');
    return json;
  }
}

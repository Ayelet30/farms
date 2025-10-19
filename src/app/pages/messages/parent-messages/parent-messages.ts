import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  dbTenant,
  getCurrentUserData,
  ensureTenantContextReady,
} from '../../../services/supabaseClient.service';

@Component({
  selector: 'app-parent-notes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-messages.html',
  styleUrls: ['./parent-messages.css']
})
export class ParentMessagesComponent implements OnInit {
  newNote = { subject: '', content: '' };
  confirmationMessage = '';
  showHistory = false;
  noteHistory: any[] = [];
  error: string | undefined;

  // ✅ if the column is sender_uid (שכיח מאוד במדיניות) – נעדכן גם כאן
  private readonly MESSAGE_SELECT =
    'id, title, content, to_role, date_sent, sent_by_uid, status';

  private userUid: string | null = null;

  async ngOnInit() {
    try {
      // ✅ חובה לפני כל קריאות ל-DB של הטננט
      await ensureTenantContextReady();

      const user = await getCurrentUserData();
      this.userUid = user?.uid ?? null;

      await this.loadMessagesHistory();
    } catch (e: any) {
      console.error(e);
      this.error = e?.message ?? 'שגיאה באתחול ההודעות';
    }
  }

  async submitMessage() {
    this.error = undefined;

    if (!this.newNote.subject || !this.newNote.content) return;
    if (!this.userUid) {
      this.error = 'משתמש לא מזוהה';
      return;
    }

    try {
      // ✅ נוודא שוב הקשר טננט (מקרי קצה של החלפת חווה/רענון)
      await ensureTenantContextReady();

      const dbc = dbTenant();

      // ⬇⬇ שינוי קריטי: sent_by_uid → sender_uid כדי להתאים ל-RLS המקובל
      const payload = {
        title: this.newNote.subject,
        content: this.newNote.content,
        to_role: 'secretary',
        sent_by_uid: this.userUid, 
        date_sent: new Date().toISOString(),
        status: 'received'
      };

      console.log('!!שליחת הודעה:!!', payload);

      // המלצה: הפרדת insert מ-select כדי לזהות מקור חסימה
      const ins = await dbc.from('messages').insert(payload);
      if (ins.error) {
        console.error('שגיאה בשליחת הודעה:', ins.error, { payload });
        this.error = ins.error.message ?? 'אירעה שגיאה בשליחת ההודעה';
        return;
      }

      this.confirmationMessage = 'הודעתך התקבלה. נעדכן אותך בהמשך.';
      this.newNote = { subject: '', content: '' };
      await this.loadMessagesHistory();

    } catch (e: any) {
      console.error('שגיאה בשליחת הודעה:', e);
      this.error = e?.message ?? 'אירעה שגיאה בשליחת ההודעה';
    }
  }

  async loadMessagesHistory() {
    if (!this.userUid) return;

    try {
      await ensureTenantContextReady();

      const dbc = dbTenant();
      const { data, error } = await dbc
        .from('messages')
        .select(this.MESSAGE_SELECT)
        .order('date_sent', { ascending: false });

      if (error) {
        console.error('Error loading messages:', error);
        this.error = error.message ?? 'שגיאה בטעינת היסטוריית ההודעות';
        this.noteHistory = [];
        return;
      }

      this.noteHistory = data ?? [];
      this.error = undefined;

    } catch (e: any) {
      console.error('Error loading messages:', e);
      this.error = e?.message ?? 'שגיאה בטעינת היסטוריית ההודעות';
      this.noteHistory = [];
    }
  }

  toggleHistory() {
    this.showHistory = !this.showHistory;
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'received':
        return '⚪ התקבלה';
      case 'in_progress':
        return '🟡 בטיפול';
      case 'resolved':
        return '✅ טופלה';
      default:
        return status;
    }
  }

  statusClass(status: string): string {
    switch (status) {
      case 'received':
        return 'status-received';
      case 'in_progress':
        return 'status-in-progress';
      case 'resolved':
        return 'status-resolved';
      default:
        return '';
    }
  }
}

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  dbTenant,            
  getCurrentUserData   
} from '../../services/supabaseClient.service';

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

  private readonly MESSAGE_SELECT =
  'id, title, content, to_role, date_sent, sent_by_uid, status';

  private userUid: string | null = null;

  async ngOnInit() {
    const user = await getCurrentUserData();
    this.userUid = user?.uid ?? null;

    await this.loadMessagesHistory();
  }

  async submitMessage() {
    if (!this.newNote.subject || !this.newNote.content) return;
    if (!this.userUid) {
      this.error = 'משתמש לא מזוהה';
      return;
    }

    const dbc = dbTenant();
   const payload = {
  title: this.newNote.subject,             
  content: this.newNote.content,
  to_role: 'secretary',                    
  sent_by_uid: this.userUid,               
  date_sent: new Date().toISOString(),     
  status: 'received'                       
};

const { error } = await dbTenant().from('messages').insert(payload);

    if (error) {
      console.error('שגיאה בשליחת הודעה:', error);
      this.error = error.message ?? 'אירעה שגיאה בשליחת ההודעה';
      return;
    }

    this.confirmationMessage = 'הודעתך התקבלה. נעדכן אותך בהמשך.';
    this.newNote = { subject: '', content: '' };
    await this.loadMessagesHistory();
  }

  async loadMessagesHistory() {
    if (!this.userUid) return;

    const dbc = dbTenant();
    const { data, error } = await dbc
      .from('messages')
      .select(this.MESSAGE_SELECT)
      .eq('sent_by_uid', this.userUid)
      .order('date_sent', { ascending: false });

    if (error) {
      console.error('Error loading messages:', error);
      this.error = error.message ?? 'שגיאה בטעינת היסטוריית ההודעות';
      this.noteHistory = [];
      return;
    }

    this.noteHistory = data ?? [];
    this.error = undefined;
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

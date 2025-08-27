import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getCurrentUserData, getSupabaseClient } from '../../services/supabaseClient';

@Component({
  selector: 'app-parent-notes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-notes.html',
  styleUrls: ['./parent-notes.css']
})
export class ParentNotesComponent implements OnInit {
  newNote = { subject: '', content: '' };
  confirmationMessage = '';
  showHistory = false;
  noteHistory: any[] = [];
  userData: any = null;
  supabase = getSupabaseClient();


  async ngOnInit() {
    this.userData = JSON.parse(localStorage.getItem('userData') || '{}');
    this.loadNoteHistory();
    console.log('USER DATA', this.userData);

  }

  async submitNote() {
  if (!this.newNote.subject || !this.newNote.content) return;

  const user = await getCurrentUserData(); // 🟣 חשוב: ודא/י שיש ייבוא
  const farmId = await this.getFarmId();   // 🔵 את זו תצטרכי להוסיף אם אין עדיין

  const { error } = await this.supabase
    .from('messages')
    .insert({
      title: this.newNote.subject,
      content: this.newNote.content,
      to_role: 'secretary',
      sent_by_uid: user?.uid,
      farm_id: farmId,
      date_sent: new Date().toISOString()
    });

  if (!error) {
    this.confirmationMessage = 'הודעתך התקבלה. נעדכן אותך בהמשך.';
    this.newNote = { subject: '', content: '' };
    this.loadNoteHistory();
    //להוסיף שליחת הודעה למזכירה - לאחר בירור כיצד הם רוצים שזה יופיע ולמי 
  }
}
async getFarmId(): Promise<string> {
  const user = await getCurrentUserData();
  const { data, error } = await this.supabase
    .from('users')
    .select('farm_id')
    .eq('uid', user?.uid)
    .single();

  return data?.farm_id || '';
}

async loadNoteHistory() {
  const user = await getCurrentUserData();

  console.log('Loading history for UID:', user?.uid);

  const { data, error } = await this.supabase
    .from('messages')
    .select('*')
    .eq('sent_by_uid', user?.uid)
    .order('date_sent', { ascending: false });

  if (error) {
    console.error('Error loading messages:', error);
  } else {
    console.log('Loaded messages:', data);
    this.noteHistory = data || [];
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

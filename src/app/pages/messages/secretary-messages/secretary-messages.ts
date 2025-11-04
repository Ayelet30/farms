import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getAuth } from 'firebase/auth';
import { db, ensureTenantContextReady, replyToThread } from '../../../services/supabaseClient.service';
 
type Tab = 'inbox' | 'compose' | 'sent';
 
type Conversation = {
  id: string;
  subject: string | null;
  status: 'open' | 'pending' | 'closed';
  opened_by_parent_uid: string | null;
  created_at: string;
  updated_at: string;
};
 
type ConversationMessage = {
  id: string;
  conversation_id: string;
  body_md: string;
  sender_role: 'parent' | 'secretary' | 'instructor' | 'manager' | 'admin';
  sender_uid: string | null;
  created_at: string;
};
 
type SentMsg = {
  id: string;
  subject: string | null;
  status: 'scheduled' | 'sent' | 'failed';
  sent_at: string | null;
  scheduled_at: string | null;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_sms: boolean;
};
 
@Component({
  selector: 'app-secretary-messages',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-messages.html',
  styleUrls: ['./secretary-messages.css']
})
export class SecretaryMessagesComponent implements OnInit {
  tab = signal<Tab>('inbox');
 
  // Inbox
  loadingInbox = signal(false);
  inbox = signal<Conversation[]>([]);
  activeConv = signal<Conversation | null>(null);
  thread = signal<ConversationMessage[]>([]);
  replyText: string = '';  
 
  // Compose (שידור)
  compose = {
    subject: '',
    body: '',
    channels: { inapp: true, email: false, sms: false },
    audience: 'all' as 'all' | 'manual' | 'single',
    manualUids: '' as string,
    singleUid: '' as string,
    scheduledAt: '' as string
  };
  sending = signal(false);
  toast = signal<string | null>(null);
 
  // Sent
  loadingSent = signal(false);
  sent = signal<SentMsg[]>([]);
 
  async ngOnInit() {
    await ensureTenantContextReady();
    await this.loadInbox();
  }
 
  private myUid(): string {
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('No logged-in user');
    return uid;
  }
 
  // ===== Inbox / Threads =====
  async loadInbox() {
    this.loadingInbox.set(true);
    try {
      const { data, error } = await db()
        .from('conversations')
        .select('id, subject, status, opened_by_parent_uid, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      this.inbox.set((data ?? []) as Conversation[]);
      if (!this.activeConv() && this.inbox().length) this.openConversation(this.inbox()[0]);
    } finally {
      this.loadingInbox.set(false);
    }
  }
 
  async openConversation(c: Conversation) {
    this.activeConv.set(c);
    const { data, error } = await db()
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    this.thread.set((data ?? []) as ConversationMessage[]);
  }
 
  async sendReply() {
    const txt = this.replyText.trim();
    if (!txt || !this.activeConv()) return;
    const msg = await replyToThread(this.activeConv()!.id, txt);
    this.thread.update(arr => [...arr, msg]);
    this.replyText = '';
  }
 
  // ===== Broadcast =====
  async doSendBroadcast() {
    this.sending.set(true);
    try {
      // 1) יצירת הודעה
      const { data: msg, error: e1 } = await db().from('messages').insert({
        subject: this.compose.subject?.trim() || null,
        body_md: this.compose.body.trim(),
        channel_inapp: !!this.compose.channels.inapp,
        channel_email: !!this.compose.channels.email,
        channel_sms: !!this.compose.channels.sms,
        audience_type: this.compose.audience,
        audience_ref: this.compose.audience === 'all'
          ? { type: 'all' }
          : this.compose.audience === 'single'
            ? { type: 'single', singleUid: this.compose.singleUid?.trim() || null }
            : { type: 'manual', parentUids: (this.compose.manualUids || '').split(',').map(s => s.trim()).filter(Boolean) },
        scheduled_at: this.compose.scheduledAt?.trim() || null,
        status: this.compose.scheduledAt ? 'scheduled' : 'sent',
        sent_at: this.compose.scheduledAt ? null : new Date().toISOString()
      }).select().single();
      if (e1) throw e1;
 
      // 2) בניית נמענים
      let parentUids: string[] = [];
      if (this.compose.audience === 'all') {
        const { data: parents } = await db().from('parents').select('uid').eq('is_active', true);
        parentUids = (parents ?? []).map((p: any) => p.uid).filter(Boolean);
      } else if (this.compose.audience === 'manual') {
        parentUids = (this.compose.manualUids || '').split(',').map(s => s.trim()).filter(Boolean);
      } else if (this.compose.audience === 'single' && this.compose.singleUid?.trim()) {
        parentUids = [this.compose.singleUid.trim()];
      }
      parentUids = Array.from(new Set(parentUids));
 
      if (parentUids.length) {
        const rows = parentUids.map(uid => ({
          message_id: (msg as any).id,
          recipient_parent_uid: uid,
          delivery_status: this.compose.scheduledAt ? 'pending' : 'sent'
        }));
        const { error: e2 } = await db().from('message_recipients').insert(rows);
        if (e2) throw e2;
      }
 
      this.toast.set('נשלח!');
      this.compose.body = '';
      this.compose.subject = '';
      this.tab.set('sent');
      await this.loadSent();
    } catch (e: any) {
      this.toast.set(`שגיאה בשליחה: ${e?.message || e}`);
    } finally {
      this.sending.set(false);
      setTimeout(() => this.toast.set(null), 4000);
    }
  }
 
  async loadSent() {
    this.loadingSent.set(true);
    try {
      const { data, error } = await db()
        .from('messages')
        .select('id, subject, status, sent_at, scheduled_at, channel_inapp, channel_email, channel_sms')
        .order('sent_at', { ascending: false });
      if (error) throw error;
      this.sent.set((data ?? []) as SentMsg[]);
    } finally {
      this.loadingSent.set(false);
    }
  }
}
 
 
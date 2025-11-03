import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type { Conversation, ConversationMessage, Message } from '../../../models/messsage.model';

import { listInbox, getThread, replyToThread, sendBroadcast, listSent } from '../../../services/supabaseClient.service';

type Tab = 'inbox' | 'compose' | 'sent';

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
  replyText = signal('');

  // ✅ proxy לשימוש עם [(ngModel)]
  get replyTextModel(): string { return this.replyText(); }
  set replyTextModel(v: string) { this.replyText.set(v ?? ''); }

  // Compose (שידור)
  compose = {
    subject: '',
    body: '',
    channelInApp: true,
    channelEmail: false,
    channelSms: false,
    audienceType: 'all' as 'all' | 'manual' | 'single',
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
    const { msgs } = await getThread(c.id);
    this.thread.set(msgs);
    this.replyText.set('');
  }

  async sendReply() {
    const txt = this.replyText().trim();
    const conv = this.activeConv();
    if (!txt || !conv) return;
    const msg = await replyToThread(conv.id, txt);
    this.thread.update(arr => [...arr, msg]);
    this.replyText.set('');
  }

  // ===== Broadcast =====
  async doSendBroadcast() {
    this.sending.set(true);
    try {
      // 1) יצירת הודעה
      const { data: msg, error: e1 } = await db().from('messages').insert({
        subject: this.compose.subject?.trim() || null,
        body_md: this.compose.body.trim(),
        channels: {
          inapp: this.compose.channelInApp,
          email: this.compose.channelEmail,
          sms: this.compose.channelSms
        },
        audience:
          this.compose.audienceType === 'all'
            ? { type: 'all' }
            : this.compose.audienceType === 'single'
              ? { type: 'single', singleUid: this.compose.singleUid?.trim() || null }
              : { type: 'manual', parentUids: (this.compose.manualUids || '')
                    .split(',').map(s => s.trim()).filter(Boolean) },
        scheduled_at: this.compose.scheduledAt?.trim() || null
      });
      this.toast.set(`נשלח! הודעה ${res.message.id} ל-${res.recipients} נמענים`);
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

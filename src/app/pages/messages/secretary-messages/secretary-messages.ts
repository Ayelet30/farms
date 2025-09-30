import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type { Conversation, ConversationMessage, Message } from '../../../models/messsage.model';
import { listInbox, getThread, replyToThread, sendBroadcast, listSent } from '../../../services/supabaseClient.service';

type Tab = 'inbox' | 'compose' | 'sent';


@Component({
  selector: 'app-secretary-notes',
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

  // Compose
  compose = {
    subject: '',
    body: '',
    channelInApp: true,
    channelEmail: false,
    channelSms: false,
    audienceType: 'all' as 'all' | 'manual' | 'single',
    manualUids: '' as string, // comma-separated
    singleUid: '' as string,
    scheduledAt: '' as string
  };
  sending = signal(false);
  toast = signal<string | null>(null);

  // Sent
  loadingSent = signal(false);
  sent = signal<(Message & { recipients_count?: number })[]>([]);

  async ngOnInit() {
    await this.loadInbox();
  }

  async loadInbox() {
    this.loadingInbox.set(true);
    try {
      const rows = await listInbox({ status: ['open', 'pending'] });
      this.inbox.set(rows);
    } finally {
      this.loadingInbox.set(false);
    }
  }

  async openConversation(c: Conversation) {
    this.activeConv.set(c);
    const { msgs } = await getThread(c.id);
    this.thread.set(msgs);
  }

  async sendReply() {
    const txt = this.replyText.trim();
    if (!txt || !this.activeConv()) return;
    const msg = await replyToThread(this.activeConv()!.id, txt);
    this.thread.update(arr => [...arr, msg]);
    this.replyText = '';
  }

  // Compose
  async doSend() {
    this.sending.set(true);
    try {
      const res = await sendBroadcast({
        subject: this.compose.subject?.trim() || null,
        body_md: this.compose.body.trim(),
        channels: { inapp: this.compose.channelInApp, email: this.compose.channelEmail, sms: this.compose.channelSms },
        audience: this.compose.audienceType === 'all'
          ? { type: 'all' }
          : this.compose.audienceType === 'single'
            ? { type: 'single', singleUid: this.compose.singleUid?.trim() || null }
            : { type: 'manual', parentUids: (this.compose.manualUids || '').split(',').map(s => s.trim()).filter(Boolean) },
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
      this.sent.set(await listSent());
    } finally {
      this.loadingSent.set(false);
    }
  }
}

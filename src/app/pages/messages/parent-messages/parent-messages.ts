import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getAuth } from 'firebase/auth';
import { db, ensureTenantContextReady } from '../../../services/supabaseClient.service';


type Tab = 'threads' | 'new' | 'announcements';

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

type Announcement = {
  id: string;
  subject: string | null;
  body_md: string | null;
  sent_at: string | null;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_sms: boolean;
};

@Component({
  selector: 'app-parent-messages',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parent-messages.html',
  styleUrls: ['./parent-messages.css']
})
export class ParentMessagesComponent implements OnInit {
  tab = signal<Tab>('threads');

  // שיחות
  loadingThreads = signal(false);
  threads = signal<Conversation[]>([]);
  activeConv = signal<Conversation | null>(null);
  messages = signal<ConversationMessage[]>([]);
  replyText = ''; // <-- לא signal כדי לעבוד עם ngModel

  // פתיחת שיחה חדשה
  newSubject = ''; // <-- לא signal
  newBody = '';    // <-- לא signal
  creating = signal(false);
  toast = signal<string | null>(null);

  // הודעות שידור
  loadingAnn = signal(false);
  announcements = signal<Announcement[]>([]);

  async ngOnInit() {
    await ensureTenantContextReady();
    await Promise.all([this.loadThreads(), this.loadAnnouncements()]);
  }

  private myUid(): string {
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('No logged-in user');
    return uid;
  }

  async loadThreads() {
    this.loadingThreads.set(true);
    try {
      const uid = this.myUid();
      const { data, error } = await db()
        .from('conversations')
        .select('id, subject, status, opened_by_parent_uid, created_at, updated_at')
        .eq('opened_by_parent_uid', uid)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      this.threads.set((data ?? []) as Conversation[]);
      if (!this.activeConv() && this.threads().length) {
        await this.openConversation(this.threads()[0]);
      }
    } finally {
      this.loadingThreads.set(false);
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
    this.messages.set((data ?? []) as ConversationMessage[]);
  }

  async sendReply() {
    const body = (this.replyText || '').trim();
    if (!body || !this.activeConv()) return;
    const uid = this.myUid();

    const { data, error } = await db()
      .from('conversation_messages')
      .insert({
        conversation_id: this.activeConv()!.id,
        body_md: body,
        sender_role: 'parent',
        sender_uid: uid,
        has_attachment: false
      })
      .select()
      .single();
    if (error) throw error;

    // כשהורה עונה – נשאיר את הסטטוס open
    await db().from('conversations')
      .update({ status: 'open' })
      .eq('id', this.activeConv()!.id);

    this.messages.update(arr => [...arr, data as ConversationMessage]);
    this.replyText = '';
  }

  async createConversation() {
    if (!this.newBody.trim()) return;
    this.creating.set(true);
    try {
      const uid = this.myUid();
      const { data: conv, error: e1 } = await db()
        .from('conversations')
        .insert({
          subject: this.newSubject.trim() || null,
          status: 'open',
          opened_by_parent_uid: uid
        })
        .select()
        .single();
      if (e1) throw e1;

      const { error: e2 } = await db()
        .from('conversation_messages')
        .insert({
          conversation_id: (conv as any).id,
          body_md: this.newBody.trim(),
          sender_role: 'parent',
          sender_uid: uid,
          has_attachment: false
        });
      if (e2) throw e2;

      this.newSubject = '';
      this.newBody = '';
      this.toast.set('השיחה נפתחה ונשלחה');
      setTimeout(() => this.toast.set(null), 3000);

      await this.loadThreads();
      const just = this.threads().find(t => t.id === (conv as any).id);
      if (just) await this.openConversation(just);
      this.tab.set('threads');
    } finally {
      this.creating.set(false);
    }
  }

  async loadAnnouncements() {
    this.loadingAnn.set(true);
    try {
      const uid = this.myUid();

      // IDs של הודעות שקיבלתי
      const { data: recs, error: e1 } = await db()
        .from('message_recipients')
        .select('message_id')
        .eq('recipient_parent_uid', uid);
      if (e1) throw e1;

      const ids = Array.from(new Set((recs ?? []).map((r: any) => r.message_id))) as string[];
      if (!ids.length) { this.announcements.set([]); return; }

      const { data: msgs, error } = await db()
        .from('messages')
        .select('id, subject, body_md, sent_at, channel_inapp, channel_email, channel_sms')
        .in('id', ids)
        .order('sent_at', { ascending: false });
      if (error) throw error;

      this.announcements.set((msgs ?? []) as Announcement[]);
    } finally {
      this.loadingAnn.set(false);
    }
  }
}

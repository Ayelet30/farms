import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getAuth } from 'firebase/auth';
import { db, ensureTenantContextReady } from '../../../services/legacy-compat';
import { dbTenant } from '../../../services/supabaseClient.service';
import { fetchMyChildren } from '../../../services/supabaseClient.service';


type Tab = 'threads' | 'new' | 'announcements';
type FarmSettingsContact = {
  main_phone: string | null;
  main_mail: string | null;
  main_address: string | null;

};
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

type WorkingHourRow = {
  day_of_week: number; // 1..7
  is_open: boolean; // חווה
  is_offical_open: boolean; // משרד
  farm_start: string | null;
  farm_end: string | null;
  office_start: string | null;
  office_end: string | null;
};

type WorkingHourVm = WorkingHourRow & {
  dayLabel: string;
  isAnyOpen: boolean;
  farmRangeText: string;
  officeRangeText: string;
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

  
  get whatsappLink(): string {
  // אם אין טלפון ב-Supabase, נשתמש במספר ברירת מחדל לבדיקה
  const phone = this.farmSettings?.main_phone || '0501234567'; 
  
  // מנקים תווים שהם לא מספרים
  let cleanPhone = phone.replace(/\D/g, '');   
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent('שלום, אני פונה מהאתר של החווה')}`;
}

  // פתיחת שיחה חדשה
  newSubject = ''; // <-- לא signal
  newBody = '';    // <-- לא signal
  creating = signal(false);
  toast = signal<string | null>(null);
  selectedFile: File | null = null;
  selectedKidId: string = ''; // ישמור את ה-ID של הילד שנבחר
  kids = signal<any[]>([]);
  activeThread = signal<any>(null); // שומר את השיחה שכרגע פתוחה במסך
  messages = signal<any[]>([]);


  // הודעות שידור
  loadingAnn = signal(false);
  announcements = signal<Announcement[]>([]);

   farmSettings: FarmSettingsContact | null = null;
    workingHours = signal<WorkingHourVm[]>([]);


  // אופציונלי: אם תרצי להציג ספינר/שגיאה
  loading = signal<boolean>(false);
  errorMsg = signal<string | null>(null);

 
  async ngOnInit() {
  await Promise.all([
      this.loadFarmSettingsContact(),
      this.loadWorkingHours(),
    ]);
    await ensureTenantContextReady();
    await Promise.all([
      this.loadThreads(), 
      this.loadAnnouncements(), 
      this.loadKids() 
    ]);
  }

  async loadKids() {
  // הפעלת הפונקציה המוכנה של המערכת
    const res = await fetchMyChildren('child_uuid, first_name, last_name, status');

    if (!res.ok) {
      console.error("שגיאה בטעינת ילדים:", res.error);
      return;
    }

    // המרת הנתונים לפורמט שה-HTML שלנו מכיר
    // אנחנו משלבים שם פרטי ומשפחה לתוך student_name
    const mappedKids = (res.data ?? []).map((child: any) => ({
    id: child.child_uuid,
    student_name: `${child.first_name} ${child.last_name}`
    }));

    console.log("הילדים נטענו בהצלחה:", mappedKids);
    this.kids.set(mappedKids);
  }

  private async loadWorkingHours(): Promise<void> {
    try {
      const dbc = await dbTenant();

   const { data, error } = await dbc
  .from('farm_working_hours')
  .select('day_of_week,is_open,is_offical_open,farm_start,farm_end,office_start,office_end')
  .order('day_of_week', { ascending: true });

if (error) throw error;

const rows = (data ?? []) as WorkingHourRow[];

this.workingHours.set(
  rows.map((r) => {
    const isAnyOpen = !!(r.is_open || r.is_offical_open);

    return {
      ...r,
      dayLabel: this.dayLabel(r.day_of_week),
      isAnyOpen,

      // חווה נשלטת ע"י is_open
      farmRangeText: r.is_open ? this.rangeText(r.farm_start, r.farm_end) : '—',

      // משרד נשלט ע"י is_offical_open
      officeRangeText: r.is_offical_open
        ? this.rangeText(r.office_start, r.office_end)
        : '—',
    };
  })
);

    } catch (e: any) {
      console.error('Failed to load farm_working_hours:', e);
      // לא חייבים להפיל את כל הדף — אפשר פשוט לא להציג טבלה
    }
   }
    private dayLabel(d: number): string {
    // 1..7 לפי הטבלה שלך
    switch (d) {
      case 1: return 'ראשון';
      case 2: return 'שני';
      case 3: return 'שלישי';
      case 4: return 'רביעי';
      case 5: return 'חמישי';
      case 6: return 'שישי';
      case 7: return 'שבת';
      default: return `יום ${d}`;
    }
  }

  private rangeText(start: string | null, end: string | null): string {
    if (!start || !end) return 'לא עודכן';
    return `${this.hhmm(start)}–${this.hhmm(end)}`;
    // שימי לב: זה מציג HH:MM ולא HH:MM:SS
  }

  private hhmm(t: string): string {
    // "HH:MM:SS" -> "HH:MM"
    return t.slice(0, 5);
  }

private async loadFarmSettingsContact(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set(null);

    try {
      const dbc = await dbTenant();

      // אם בטבלה יש רק שורה אחת - single() מעולה.
      // אם יש מצב ליותר משורה - אנחנו לוקחים "הכי מעודכן"
      const { data, error } = await dbc
        .from('farm_settings')
        .select('main_phone, main_mail, main_address , updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      this.farmSettings = {
        main_phone: data?.main_phone ?? null,
        main_mail: data?.main_mail ?? null,
         main_address: data?.main_address ?? null,

      };
    } catch (e: any) {
      console.error('Failed to load farm_settings contact:', e);
      this.farmSettings = { main_phone: null, main_mail: null , main_address: null};
      this.errorMsg.set('לא הצלחנו לטעון את פרטי יצירת הקשר. נסי שוב מאוחר יותר.');
    } finally {
      this.loading.set(false);
    }
  }
  todayDow = signal<number>(this.jsToDbDow(new Date().getDay())); 
// getDay(): 0=Sunday ... 6=Saturday
// אצלך בטבלה: 1..7 (ראשון=1 ... שבת=7)

isToday(dow: number): boolean {
  return dow === this.todayDow();
}

private jsToDbDow(js: number): number {
  // 0 (Sun) -> 1, 1 (Mon) -> 2 ... 6 (Sat) -> 7
  return js + 1;
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

  onFileSelected(event: any) {
  const file = event.target.files[0];
  if (!file) return;

  // בדיקת גודל קובץ - מקסימום 5MB לפי האפיון
  const maxSizeInBytes = 5 * 1024 * 1024; 
  if (file.size > maxSizeInBytes) {
    this.toast.set('הקובץ גדול מדי. הגודל המקסימלי המותר הוא 5MB');
    event.target.value = ''; // איפוס הבחירה
    return;
  }

  // בדיקת סוג קובץ - JPG, PNG, PDF בלבד
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    this.toast.set('סוג קובץ לא נתמך. ניתן להעלות PDF, PNG או JPG בלבד');
    event.target.value = '';
    return;
  }

  this.selectedFile = file;
  this.toast.set(`קובץ נבחר: ${file.name}`);
  setTimeout(() => this.toast.set(null), 3000);
}

adjustHeight(event: any) {
  const element = event.target;
  element.style.height = 'auto';
  element.style.height = element.scrollHeight + 'px';
}

removeFile() {
  this.selectedFile = null;
  // איפוס ה-input של הקובץ ב-HTML כדי שאפשר יהיה לבחור את אותו קובץ שוב
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (fileInput) fileInput.value = '';
}

  async createConversation() {
  this.toast.set(null);

  // --- שלב א: בדיקות תקינות (וולידציה) ---
  if (!this.newSubject) {
    this.toast.set('יש לבחור נושא לפני השליחה');
    setTimeout(() => this.toast.set(null), 3000);
    return;
  }
  if (!this.newBody.trim()) {
    this.toast.set('לא ניתן לשלוח הודעה ריקה');
    setTimeout(() => this.toast.set(null), 3000);
    return;
  }
  if (this.newSubject === 'files') {
    if (!this.selectedKidId) {
      this.toast.set('יש לבחור ילד עבור שליחת קבצים');
      setTimeout(() => this.toast.set(null), 3000);
      return;
    }
    if (!this.selectedFile) {
      this.toast.set('יש לבחור קובץ לשליחה');
      setTimeout(() => this.toast.set(null), 3000);
      return;
    }
  }

  // --- שלב ב: שליחה לסופבייס ---
  this.creating.set(true);
  try {
    const uid = this.myUid();

    // 1. יצירת שיחה
    const { data: conv, error: e1 } = await db()
      .from('conversations')
      .insert({
        subject: this.newSubject,
        status: 'open',
        opened_by_parent_uid: uid,
        student_id: this.selectedKidId || null
      })
      .select().single();

    if (e1) throw e1;

    // 2. יצירת הודעה ראשונה
    const { error: e2 } = await db()
      .from('conversation_messages')
      .insert({
        conversation_id: (conv as any).id,
        body_md: this.newBody.trim(),
        sender_role: 'parent',
        sender_uid: uid,
        has_attachment: !!this.selectedFile
      });

    if (e2) throw e2;

    // 3. ניקוי שדות
    this.newSubject = '';
    this.newBody = '';
    this.selectedFile = null;

    // 4. השורות החשובות שביקשת:
    await this.loadThreads(); // טוען את הרשימה המעודכנת מסופבייס
    const justCreated = this.threads().find(t => t.id === (conv as any).id);
    
    if (justCreated) {
      await this.openConversation(justCreated); // פותח את הצ'אט של השיחה החדשה
    }
    
    this.tab.set('threads'); // מעביר את המשתמש למסך ההודעות

  } catch (error) {
    this.toast.set('שגיאה ביצירת השיחה');
  } finally {
    this.creating.set(false);
  }
}

async sendMessage() {
  const thread = this.activeThread(); // בודק איזו שיחה פתוחה כרגע
  if (!thread || !this.newBody.trim()) return;

  this.creating.set(true);
  try {
    const uid = this.myUid();
    
    // מוסיף רק הודעה לטבלת ההודעות, בלי לגעת בטבלת השיחות
    const { error } = await db()
      .from('conversation_messages')
      .insert({
        conversation_id: thread.id,
        body_md: this.newBody.trim(),
        sender_role: 'parent',
        sender_uid: uid,
        has_attachment: !!this.selectedFile
      });

    if (error) throw error;

    // ניקוי ושליחה
    this.newBody = '';
    this.selectedFile = null;
    
    // רענון ההודעות בשיחה הנוכחית כדי שהבועה החדשה תופיע
    await this.loadMessages(thread.id); 

  } catch (e) {
    this.toast.set('שגיאה בשליחת התגובה');
  } finally {
    this.creating.set(false);
  }
}

// בתוך createConversation, אחרי כל ה-if (validation)
async performSendMessage() {
  try {
    this.loading = true; // אפשר להוסיף משתנה לטעינה

    // 1. קבלת המשתמש המחובר
    const user = (await dbTenant().auth.getUser()).data.user;
    if (!user) return;

    // 2. יצירת "שיחה" חדשה בטבלת conversations
    const { data: conv, error: convErr } = await dbTenant()
      .from('conversations')
      .insert({
        subject: this.newSubject,
        parent_id: user.id,
        student_id: this.selectedKidId || null, // אם יש ילד - נשייך
        status: 'sent' // סטטוס התחלתי
      })
      .select()
      .single();

    if (convErr) throw convErr;

    // 3. יצירת ההודעה הראשונה בתוך השיחה
    const { error: msgErr } = await dbTenant()
      .from('messages')
      .insert({
        conversation_id: conv.id,
        body: this.newBody,
        sender_id: user.id,
        sender_type: 'parent'
      });

    if (msgErr) throw msgErr;

    // 4. אם יש קובץ - כאן יבוא הקוד של העלאת הקובץ (Storage)
    if (this.selectedFile) {
      await this.uploadFile(conv.id); 
    }

    // 5. הצלחה!
    this.toast.set('הודעתך נשלחה בהצלחה וטופלה על ידי המזכירות');
    this.resetForm(); // פונקציה שתנקה את השדות
    this.loadThreads(); // רענון רשימת ההודעות

  } catch (err) {
    console.error("שגיאה בשליחה:", err);
    this.toast.set('אופס, משהו השתבש בשליחה. נסו שוב.');
  } finally {
    this.loading = false;
  }
}

async sendMessageToExistingConversation() {
  const activeId = this.activeThread()?.id; // ה-ID של השיחה שפתוחה עכשיו על המסך
  if (!activeId) return;

  const uid = this.myUid();

  const { error } = await db()
    .from('conversation_messages')
    .insert({
      conversation_id: activeId,
      body_md: this.newBody.trim(),
      sender_role: 'parent',
      sender_uid: uid,
      has_attachment: !!this.selectedFile
    });

  if (!error) {
    this.newBody = ''; // ניקוי התיבה
    this.selectedFile = null;
    await this.loadMessages(activeId); // רענון הבועות על המסך
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
  buildMapsUrl(addr: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}



}

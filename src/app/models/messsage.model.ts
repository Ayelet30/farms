// טיפוסים מרכזיים למודול הודעות

export type Channel = 'inapp' | 'email' | 'sms';
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'delivered' | 'read' | 'replied';
export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface Message {
  id: string;
  subject: string | null;
  body_md: string | null;
  channel_inapp: boolean;
  channel_email: boolean;
  channel_sms: boolean;
  audience_type: 'all' | 'segment' | 'static' | 'manual' | 'single';
  audience_ref?: any | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  status: 'draft' | 'scheduled' | 'sent' | 'cancelled';
  created_at?: string | null;
}

export interface MessageRecipient {
  message_id: string;
  recipient_parent_uid: string;
  recipient_child_id?: string | null;
  delivery_status: DeliveryStatus;
  delivery_error?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  replied_at?: string | null;
  parent_full_name?: string | null;   // לשימוש תצוגה
}

export interface Conversation {
  id: string;
  subject: string | null;
  status: ConversationStatus;
  opened_by_parent_uid?: string | null;
  opened_by_staff_uid?: string | null;
  assigned_to_uid?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  created_at?: string | null;
  parent_full_name?: string | null;   // לשימוש תצוגה
  parent_phone?: string | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_role: 'parent' | 'secretary' | 'instructor' | 'manager';
  sender_uid: string;
  body_md: string;
  has_attachment: boolean;
  created_at: string;
}

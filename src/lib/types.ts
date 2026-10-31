export type Role = "owner" | "admin" | "agent";
export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled";
export type StageKind = "open" | "won" | "lost";
export type Provider = "meta" | "evolution" | "zapi";
export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";
export type MsgDirection = "in" | "out";
export type MsgStatus = "pending" | "sent" | "delivered" | "read" | "failed" | "received";
export type MsgType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "other";

export interface Organization { id: string; name: string; created_at: string }
export interface Subscription {
  organization_id: string;
  status: SubscriptionStatus;
  checkout_url: string | null;
  value_cents: number | null;
  current_period_end: string | null;
}
export interface Pipeline { id: string; organization_id: string; name: string; position: number; schedule_on_move?: boolean }
export interface Stage {
  id: string; organization_id: string; pipeline_id: string; name: string; color: string; kind: StageKind; position: number;
}
export interface Tag { id: string; organization_id: string; name: string; color: string }
export interface Lead {
  id: string; organization_id: string; pipeline_id: string; stage_id: string; name: string;
  phone: string | null; email: string | null; value: number; source: string | null; notes: string | null;
  assigned_to: string | null; position: number; last_message_at: string | null; created_at: string; updated_at: string;
  avatar_url?: string | null; last_message_preview?: string | null; last_message_dir?: MsgDirection | null; stage_changed_at?: string;
}
export interface LeadTag { lead_id: string; tag_id: string; organization_id: string }
export interface Member { user_id: string; role: Role; full_name: string | null; email: string | null }
export interface Channel {
  id: string; organization_id: string; provider: Provider; name: string; status: ChannelStatus;
  phone_number: string | null; meta_phone_number_id: string | null; meta_waba_id: string | null; evolution_instance: string | null; zapi_instance_id?: string | null;
  history_imported_at: string | null; last_error: string | null; created_at: string;
  calling_enabled?: boolean; meta_coexistence?: boolean; call_recording?: "meta" | "browser"; call_recording_purpose?: string;
}
export interface Conversation {
  id: string; organization_id: string; channel_id: string; lead_id: string | null; wa_id: string;
  contact_name: string | null; unread_count: number; last_message_at: string | null; last_message_preview: string | null;
}
export interface Message {
  id: string; conversation_id: string; channel_id: string; external_id: string; direction: MsgDirection;
  type: MsgType; body: string | null; media_ref: string | null; media_mime: string | null; status: MsgStatus;
  sent_by: string | null; sent_at: string;
  deleted_at?: string | null; edited_at?: string | null; original_body?: string | null;
}
export interface QuickReply { id: string; organization_id: string; shortcut: string; title: string; content: string }

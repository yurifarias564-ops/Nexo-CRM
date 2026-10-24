import type { MsgDirection, MsgStatus, MsgType } from "@/lib/types";

/** Formato único de mensagem, independente do provedor (Meta ou Evolution). */
export interface NormalizedMessage {
  wa_id: string;
  contact_name: string | null;
  external_id: string;
  direction: MsgDirection;
  type: MsgType;
  body: string | null;
  media_ref: string | null;
  media_mime: string | null;
  status: MsgStatus;
  sent_at: string; // ISO
  /** Z-API: identificador @lid do contato (só os dígitos), quando o WhatsApp manda. */
  lid?: string | null;
}

export interface StatusUpdate {
  external_id: string;
  status: MsgStatus;
}

export function tsToIso(ts: unknown): string {
  const n = typeof ts === "string" ? Number(ts) : typeof ts === "number" ? ts : NaN;
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  return new Date().toISOString();
}

/** Mensagem apagada para todos ou editada (no celular ou em outro aparelho). */
export interface MessageChange {
  external_id: string;
  kind: "delete" | "edit";
  body?: string | null;
}

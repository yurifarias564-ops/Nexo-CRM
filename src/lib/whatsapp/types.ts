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
  /** Cliente veio de um anúncio "clique para o WhatsApp" (Meta). */
  ad?: AdReferral | null;
}

export interface AdReferral {
  source_id: string | null;
  source_url: string | null;
  source_type: string | null;
  title: string | null;
  body: string | null;
  ctwa_clid: string | null;
}

/** Lê os dados do anúncio em qualquer formato (Meta oficial, Z-API, Evolution/Baileys). */
export function adFrom(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const k of keys) { const v = r[k]; if (typeof v === "string" && v.trim()) return v.trim().slice(0, 500); }
    return null;
  };
  const ad: AdReferral = {
    source_id: str("source_id", "sourceId", "sourceID"),
    source_url: str("source_url", "sourceUrl", "sourceURL"),
    source_type: str("source_type", "sourceType"),
    title: str("headline", "title"),
    body: str("body"),
    ctwa_clid: str("ctwa_clid", "ctwaClid", "ctwaClickId"),
  };
  return ad.source_id || ad.ctwa_clid || ad.source_url ? ad : null;
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

import "server-only";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { MsgStatus, MsgType } from "@/lib/types";
import { tsToIso, type NormalizedMessage, type StatusUpdate } from "./types";

const base = () => env("EVOLUTION_API_URL").replace(/\/+$/, "");

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { apikey: env("EVOLUTION_API_KEY"), "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as T & { response?: { message?: unknown }; message?: unknown };
  if (!res.ok) {
    const raw = body.response?.message ?? body.message ?? res.status;
    throw new HttpError(res.status >= 500 ? 502 : 422, `WhatsApp (QR): ${Array.isArray(raw) ? raw.join(", ") : String(raw)}`);
  }
  return body;
}

const EVENTS = ["MESSAGES_SET", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "CONTACTS_UPSERT"];

export async function createInstance(instanceName: string, webhookUrl: string) {
  return call<unknown>("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      syncFullHistory: true, // envia todo o histórico ao conectar (evento MESSAGES_SET)
      readMessages: false,
      webhook: { url: webhookUrl, byEvents: false, base64: false, events: EVENTS },
    }),
  });
}

export async function connect(instance: string) {
  return call<{ base64?: string; code?: string; pairingCode?: string | null }>(`/instance/connect/${encodeURIComponent(instance)}`);
}

export async function connectionState(instance: string): Promise<"open" | "connecting" | "close"> {
  const r = await call<{ instance?: { state?: string } }>(`/instance/connectionState/${encodeURIComponent(instance)}`);
  const s = r.instance?.state;
  return s === "open" ? "open" : s === "connecting" ? "connecting" : "close";
}

export async function ownerNumber(instance: string): Promise<string | null> {
  try {
    const r = await call<{ ownerJid?: string; owner?: string }[]>(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    const jid = r[0]?.ownerJid ?? r[0]?.owner;
    return jid ? jid.split("@")[0]!.replace(/\D/g, "") : null;
  } catch {
    return null;
  }
}

export async function deleteInstance(instance: string) {
  await call(`/instance/logout/${encodeURIComponent(instance)}`, { method: "DELETE" }).catch(() => undefined);
  await call(`/instance/delete/${encodeURIComponent(instance)}`, { method: "DELETE" }).catch(() => undefined);
}

export async function sendText(instance: string, to: string, text: string): Promise<string> {
  const number = to.includes("@") ? to : to.replace(/\D/g, "");
  const r = await call<{ key?: { id?: string } }>(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ number, text }),
  });
  if (!r.key?.id) throw new HttpError(502, "WhatsApp (QR) não retornou o id da mensagem");
  return r.key.id;
}

export async function getMediaBase64(instance: string, messageId: string) {
  return call<{ base64?: string; mimetype?: string }>(
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
    { method: "POST", body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }) },
    60_000,
  );
}

export async function findChats(instance: string): Promise<{ remoteJid: string; pushName?: string | null }[]> {
  const r = await call<unknown>(`/chat/findChats/${encodeURIComponent(instance)}`, { method: "POST", body: "{}" }, 60_000);
  const arr = Array.isArray(r) ? r : [];
  return arr
    .map((c) => c as { remoteJid?: string; id?: string; pushName?: string | null; name?: string | null })
    .map((c) => ({ remoteJid: c.remoteJid ?? c.id ?? "", pushName: c.pushName ?? c.name ?? null }))
    .filter((c) => isDirectJid(c.remoteJid));
}

export async function findMessages(instance: string, remoteJid: string, page: number, offset = 100) {
  const r = await call<{ messages?: { pages?: number; currentPage?: number; records?: unknown[] } }>(
    `/chat/findMessages/${encodeURIComponent(instance)}`,
    { method: "POST", body: JSON.stringify({ where: { key: { remoteJid } }, page, offset }) },
    60_000,
  );
  return { records: r.messages?.records ?? [], pages: r.messages?.pages ?? 1 };
}

// ---------------------------------------------------------------------------
// Parsing (formato Baileys)
// ---------------------------------------------------------------------------
export function isDirectJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us") || jid.endsWith("@lid");
}

/** wa_id canônico: só dígitos para números; LID mantém o sufixo. */
export function waIdFromKey(key: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string }): string | null {
  const candidates = [key.remoteJid, key.remoteJidAlt, key.senderPn].filter(Boolean) as string[];
  const pn = candidates.find((j) => j.endsWith("@s.whatsapp.net") || j.endsWith("@c.us"));
  if (pn) return pn.split("@")[0]!.split(":")[0]!.replace(/\D/g, "") || null;
  const lid = candidates.find((j) => j.endsWith("@lid"));
  return lid ?? null;
}

type Rec = {
  key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string };
  pushName?: string | null;
  message?: Record<string, Record<string, unknown> | string | undefined> | null;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number };
  status?: string;
};

function content(msg: Rec["message"]): Pick<NormalizedMessage, "type" | "body" | "media_ref" | "media_mime"> | null {
  if (!msg) return null;
  // Desembrulha mensagens efêmeras / visualização única
  const inner = (msg.ephemeralMessage as { message?: Rec["message"] } | undefined)?.message
    ?? (msg.viewOnceMessage as { message?: Rec["message"] } | undefined)?.message
    ?? (msg.viewOnceMessageV2 as { message?: Rec["message"] } | undefined)?.message;
  if (inner) return content(inner);

  const o = (k: string) => (msg[k] as Record<string, unknown> | undefined) ?? undefined;
  const media = (type: MsgType, k: string) => {
    const m = o(k)!;
    return { type, body: (m.caption as string) ?? (k === "documentMessage" ? (m.fileName as string) ?? null : null), media_ref: "evo", media_mime: (m.mimetype as string) ?? null };
  };
  if (typeof msg.conversation === "string") return { type: "text", body: msg.conversation, media_ref: null, media_mime: null };
  if (o("extendedTextMessage")) return { type: "text", body: (o("extendedTextMessage")!.text as string) ?? "", media_ref: null, media_mime: null };
  if (o("imageMessage")) return media("image", "imageMessage");
  if (o("audioMessage")) return media("audio", "audioMessage");
  if (o("videoMessage")) return media("video", "videoMessage");
  if (o("documentMessage")) return media("document", "documentMessage");
  if (o("documentWithCaptionMessage")) {
    const inner2 = (o("documentWithCaptionMessage")!.message ?? null) as Rec["message"];
    return content(inner2);
  }
  if (o("stickerMessage")) return media("sticker", "stickerMessage");
  if (o("locationMessage")) {
    const l = o("locationMessage")!;
    return { type: "location", body: [l.name, l.address, `${l.degreesLatitude},${l.degreesLongitude}`].filter(Boolean).join(" — "), media_ref: null, media_mime: null };
  }
  if (o("contactMessage")) return { type: "contact", body: (o("contactMessage")!.displayName as string) ?? "Contato", media_ref: null, media_mime: null };
  if (o("buttonsResponseMessage")) return { type: "text", body: (o("buttonsResponseMessage")!.selectedDisplayText as string) ?? "", media_ref: null, media_mime: null };
  if (o("listResponseMessage")) return { type: "text", body: (o("listResponseMessage")!.title as string) ?? "", media_ref: null, media_mime: null };
  if (o("reactionMessage") || o("protocolMessage") || o("senderKeyDistributionMessage")) return null;
  return { type: "other", body: "Mensagem não suportada", media_ref: null, media_mime: null };
}

export function normalizeRecord(raw: unknown, historical = false): NormalizedMessage | null {
  const r = raw as Rec;
  const key = r?.key;
  if (!key?.id || !isDirectJid(key.remoteJid)) return null;
  const wa = waIdFromKey(key);
  const c = content(r.message);
  if (!wa || !c) return null;
  const ts = typeof r.messageTimestamp === "object" ? r.messageTimestamp?.low : r.messageTimestamp;
  const fromMe = Boolean(key.fromMe);
  return {
    wa_id: wa,
    contact_name: !fromMe ? r.pushName ?? null : null,
    external_id: key.id,
    direction: fromMe ? "out" : "in",
    status: fromMe ? "sent" : "received",
    sent_at: historical || ts ? tsToIso(ts) : new Date().toISOString(),
    ...c,
    media_ref: c.media_ref ? key.id : null, // id para baixar sob demanda
  };
}

const UPDATE_STATUS: Record<string, MsgStatus> = {
  SERVER_ACK: "sent", DELIVERY_ACK: "delivered", READ: "read", PLAYED: "read", ERROR: "failed",
};

export interface EvolutionEvent {
  messages: NormalizedMessage[];
  historical: boolean;
  statuses: StatusUpdate[];
  connection?: "open" | "connecting" | "close";
  qr?: string;
}

export function parseWebhook(payload: unknown): EvolutionEvent {
  const p = payload as { event?: string; data?: unknown };
  const event = String(p.event ?? "").toLowerCase().replace(/_/g, ".");
  const out: EvolutionEvent = { messages: [], historical: false, statuses: [] };
  const data = p.data as Record<string, unknown> | unknown[] | undefined;

  if (event === "messages.upsert" || event === "send.message") {
    const list = Array.isArray(data) ? data : [data];
    for (const rec of list) {
      const m = normalizeRecord(rec);
      if (m) out.messages.push(m);
    }
  } else if (event === "messages.set") {
    out.historical = true;
    const list = Array.isArray(data) ? data : ((data as { messages?: unknown[] })?.messages ?? []);
    for (const rec of list) {
      const m = normalizeRecord(rec, true);
      if (m) out.messages.push(m);
    }
  } else if (event === "messages.update") {
    const list = Array.isArray(data) ? data : [data];
    for (const u of list as { keyId?: string; key?: { id?: string }; status?: string; update?: { status?: string | number } }[]) {
      const id = u?.keyId ?? u?.key?.id;
      const st = UPDATE_STATUS[String(u?.status ?? u?.update?.status ?? "")];
      if (id && st) out.statuses.push({ external_id: id, status: st });
    }
  } else if (event === "connection.update") {
    const s = (data as { state?: string })?.state;
    if (s === "open" || s === "connecting" || s === "close") out.connection = s;
  } else if (event === "qrcode.updated") {
    const q = (data as { qrcode?: { base64?: string } })?.qrcode?.base64;
    if (q) out.qr = q;
  }
  return out;
}

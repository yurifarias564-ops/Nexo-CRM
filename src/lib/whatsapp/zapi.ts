import "server-only";
import { HttpError } from "@/lib/http";
import type { MsgStatus } from "@/lib/types";
import { tsToIso, type MessageChange, type NormalizedMessage, type StatusUpdate } from "./types";

// Z-API (https://developer.z-api.io): WhatsApp por QR Code como serviço gerenciado.
export interface ZapiCreds { instanceId: string; token: string; clientToken: string | null }

async function call<T>(c: ZapiCreds, path: string, init: { method?: string; body?: unknown } = {}, timeoutMs = 25_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.token)}/${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(c.clientToken ? { "Client-Token": c.clientToken } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(502, "A Z-API não respondeu. Tente de novo.");
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string } | null)?.error ?? (data as { message?: string } | null)?.message;
    if (res.status === 401 || res.status === 403 || /client-token|not allowed|unauthorized/i.test(String(msg))) {
      throw new HttpError(422, "Z-API recusou o acesso: confira o ID da instância, o token e o Client-Token (token de segurança da conta).");
    }
    throw new HttpError(502, `Z-API: ${msg ?? `erro ${res.status}`}`);
  }
  return data as T;
}

const msgId = (r: { messageId?: string; id?: string; zaapId?: string } | null) => {
  const id = r?.messageId ?? r?.id ?? r?.zaapId;
  if (!id) throw new HttpError(502, "Z-API não retornou o id da mensagem");
  return id;
};
const phoneOf = (to: string) => (to.endsWith("@lid") ? to : to.replace(/\D/g, ""));

export async function status(c: ZapiCreds): Promise<{ connected: boolean; error: string | null; smartphoneConnected: boolean }> {
  const r = await call<{ connected?: boolean; error?: string; smartphoneConnected?: boolean }>(c, "status");
  return { connected: Boolean(r?.connected), error: r?.error ?? null, smartphoneConnected: Boolean(r?.smartphoneConnected) };
}
export async function qrImage(c: ZapiCreds): Promise<string | null> {
  const r = await call<{ value?: string }>(c, "qr-code/image");
  return r?.value ?? null;
}
export async function phoneNumber(c: ZapiCreds): Promise<string | null> {
  const r = await call<{ phone?: string }>(c, "device").catch(() => null);
  return r?.phone ? r.phone.replace(/\D/g, "") : null;
}
/** @lid de um número (para juntar conversas que o WhatsApp mandou só pelo @lid). */
export async function lidOf(c: ZapiCreds, phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  const pick = (v: unknown) => {
    const r = Array.isArray(v) ? v[0] : v;
    const lid = (r as { lid?: unknown } | null)?.lid;
    return typeof lid === "string" && lid.endsWith("@lid") ? lid.replace(/\D/g, "") || null : null;
  };
  const a = await call<unknown>(c, `phone-exists/${digits}`).catch(() => null);
  if (pick(a)) return pick(a);
  const b = await call<unknown>(c, "phone-exists-batch", { method: "POST", body: { phones: [digits] } }).catch(() => null);
  return pick(b);
}

export async function restart(c: ZapiCreds) { await call(c, "restart"); }
export async function setWebhooks(c: ZapiCreds, url: string) {
  await call(c, "update-every-webhooks", { method: "PUT", body: { value: url, notifySentByMe: true } });
}

export async function sendText(c: ZapiCreds, to: string, text: string) {
  return msgId(await call(c, "send-text", { method: "POST", body: { phone: phoneOf(to), message: text } }));
}
export async function sendMedia(c: ZapiCreds, to: string, kind: "image" | "video" | "audio" | "document", mime: string, base64: string, fileName: string, caption?: string) {
  const dataUri = `data:${mime};base64,${base64}`;
  const phone = phoneOf(to);
  if (kind === "image") return msgId(await call(c, "send-image", { method: "POST", body: { phone, image: dataUri, caption: caption ?? "" } }, 60_000));
  if (kind === "video") return msgId(await call(c, "send-video", { method: "POST", body: { phone, video: dataUri, caption: caption ?? "" } }, 60_000));
  if (kind === "audio") return msgId(await call(c, "send-audio", { method: "POST", body: { phone, audio: dataUri, waveform: true } }, 60_000));
  const ext = (fileName.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
  return msgId(await call(c, `send-document/${ext}`, { method: "POST", body: { phone, document: dataUri, fileName, caption: caption ?? "" } }, 60_000));
}
export async function sendPtv(c: ZapiCreds, to: string, base64: string) {
  return msgId(await call(c, "send-ptv", { method: "POST", body: { phone: phoneOf(to), ptv: `data:video/mp4;base64,${base64}` } }, 60_000));
}
export async function sendLocation(c: ZapiCreds, to: string, l: { latitude: number; longitude: number; name?: string; address?: string }) {
  return msgId(await call(c, "send-location", { method: "POST", body: {
    phone: phoneOf(to), title: l.name ?? "Localização", address: l.address ?? "", latitude: String(l.latitude), longitude: String(l.longitude),
  } }));
}
const KEY_TYPE = { cpf: "CPF", cnpj: "CNPJ", phone: "PHONE", email: "EMAIL", random: "EVP" } as const;
export async function sendPixCard(c: ZapiCreds, to: string, p: { name: string; keyType: keyof typeof KEY_TYPE; key: string }) {
  return msgId(await call(c, "send-button-pix", { method: "POST", body: { phone: phoneOf(to), pixKey: p.key, type: KEY_TYPE[p.keyType], merchantName: p.name } }));
}
/** Edita uma mensagem de texto enviada. */
export async function editText(c: ZapiCreds, to: string, externalId: string, text: string) {
  return msgId(await call(c, "send-text", { method: "POST", body: { phone: phoneOf(to), message: text, editMessageId: externalId } }));
}
/** Apaga para todos uma mensagem enviada. */
export async function deleteForEveryone(c: ZapiCreds, to: string, externalId: string) {
  const q = new URLSearchParams({ messageId: externalId, phone: phoneOf(to), owner: "true" });
  await call(c, `messages?${q.toString()}`, { method: "DELETE" });
}

export async function sendCopyButton(c: ZapiCreds, to: string, m: { message: string; code: string; buttonText: string }) {
  return msgId(await call(c, "send-button-otp", { method: "POST", body: { phone: phoneOf(to), message: m.message, code: m.code, buttonText: m.buttonText } }));
}

// -----------------------------------------------------------------------------
// Webhooks (ReceivedCallback, MessageStatusCallback, ConnectedCallback, DisconnectedCallback)

export interface ZapiEvent { messages: NormalizedMessage[]; statuses: StatusUpdate[]; changes: MessageChange[]; connection?: "open" | "close"; sample?: "revoke" | "edit" }

const STATUS: Record<string, MsgStatus> = { SENT: "sent", RECEIVED: "delivered", DELIVERED: "delivered", READ: "read", PLAYED: "read" };
type Rec = Record<string, unknown>;
const o = (v: unknown) => (v && typeof v === "object" ? (v as Rec) : null);
const s = (v: unknown) => (typeof v === "string" && v ? v : null);

function content(p: Rec): Pick<NormalizedMessage, "type" | "body" | "media_ref" | "media_mime"> | null {
  const t = o(p.text), img = o(p.image), aud = o(p.audio), vid = o(p.video), doc = o(p.document), loc = o(p.location), st = o(p.sticker), ct = o(p.contact);
  const btn = o(p.buttonsResponseMessage), lst = o(p.listResponseMessage);
  if (t) return { type: "text", body: s(t.message) ?? "", media_ref: null, media_mime: null };
  if (img) return { type: "image", body: s(img.caption), media_ref: s(img.imageUrl), media_mime: s(img.mimeType) };
  if (aud) return { type: "audio", body: null, media_ref: s(aud.audioUrl), media_mime: s(aud.mimeType) };
  if (vid) {
    // Vídeo bolinha (PTV) vem sem duração; marcamos para mostrar redondo
    const ptv = vid.seconds === undefined && vid.viewOnce === undefined;
    const mime = s(vid.mimeType) ?? "video/mp4";
    return { type: "video", body: s(vid.caption), media_ref: s(vid.videoUrl), media_mime: ptv ? `${mime.split(";")[0]};ptv` : mime };
  }
  if (doc) return { type: "document", body: s(doc.fileName) ?? s(doc.title) ?? s(doc.caption), media_ref: s(doc.documentUrl), media_mime: s(doc.mimeType) };
  if (st) return { type: "sticker", body: null, media_ref: s(st.stickerUrl), media_mime: s(st.mimeType) };
  if (loc) return { type: "location", body: [s(loc.name), s(loc.address), `${loc.latitude},${loc.longitude}`].filter(Boolean).join(" — "), media_ref: null, media_mime: null };
  if (ct) return { type: "contact", body: s(ct.displayName) ?? "Contato", media_ref: null, media_mime: null };
  if (btn) return { type: "text", body: s(btn.message) ?? s(btn.buttonId) ?? "", media_ref: null, media_mime: null };
  if (lst) return { type: "text", body: s(lst.title) ?? s(lst.message) ?? "", media_ref: null, media_mime: null };
  return null;
}

export function parseWebhook(payload: unknown): ZapiEvent {
  const p = o(payload) ?? {};
  const out: ZapiEvent = { messages: [], statuses: [], changes: [] };
  const type = String(p.type ?? "");
  if (type === "ReceivedCallback") {
    if (p.isGroup || p.isNewsletter || p.broadcast || p.isStatusReply) return out;
    // Apagada para todos
    if (String(p.notification ?? "").toUpperCase() === "REVOKE") {
      const target = s(p.referenceMessageId) ?? s(p.messageId);
      if (target) out.changes.push({ external_id: target, kind: "delete" });
      out.sample = "revoke";
      return out;
    }
    // Editada: chega de novo com o mesmo id e o texto novo
    if (p.isEdit === true) {
      const t = o(p.text);
      const target = s(p.editMessageId) ?? s(p.referenceMessageId) ?? s(p.messageId);
      if (target) out.changes.push({ external_id: target, kind: "edit", body: s(t?.message) ?? s(o(p.image)?.caption) ?? s(o(p.video)?.caption) ?? null });
      out.sample = "edit";
      return out;
    }
    // O WhatsApp às vezes identifica o contato só pelo @lid (sem o número), principalmente
    // nas mensagens que você manda pelo celular. Guardamos o @lid para juntar na conversa certa.
    const rawPhone = s(p.phone) ?? "";
    const lidRaw = [s(p.chatLid), rawPhone].find((v) => v?.endsWith("@lid")) ?? null;
    const lid = lidRaw ? lidRaw.replace(/\D/g, "") || null : null;
    const phoneDigits = rawPhone.replace(/\D/g, "");
    const phoneIsLid = rawPhone.endsWith("@lid") || (lid !== null && phoneDigits === lid);
    const phone = phoneIsLid ? lid : phoneDigits;
    const id = s(p.messageId);
    const c = content(p);
    if (!phone || !id || !c) return out;
    const fromMe = Boolean(p.fromMe);
    out.messages.push({
      wa_id: phone,
      contact_name: fromMe ? s(p.chatName) : s(p.senderName) ?? s(p.chatName),
      external_id: id,
      direction: fromMe ? "out" : "in",
      ...c,
      status: fromMe ? "sent" : "received",
      sent_at: tsToIso(Number(p.momment) || Date.now()),
      lid,
    } as NormalizedMessage);
  } else if (type === "MessageStatusCallback") {
    const st = STATUS[String(p.status ?? "").toUpperCase()];
    if (st) for (const id of (Array.isArray(p.ids) ? p.ids : [])) if (typeof id === "string") out.statuses.push({ external_id: id, status: st });
  } else if (type === "ConnectedCallback") {
    out.connection = "open";
  } else if (type === "DisconnectedCallback") {
    out.connection = "close";
  }
  return out;
}


import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { MsgStatus, MsgType } from "@/lib/types";
import { tsToIso, type NormalizedMessage, type StatusUpdate } from "./types";

const graph = () => `https://graph.facebook.com/${envOptional("META_GRAPH_VERSION", "v23.0")}`;

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${graph()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 422, `WhatsApp: ${body.error?.message ?? res.status}`);
  return body;
}

export function verifySignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env("META_APP_SECRET")).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice(7), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getPhoneInfo(phoneNumberId: string, token: string) {
  return call<{ display_phone_number?: string; verified_name?: string }>(
    `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    token,
  );
}

export async function subscribeApp(wabaId: string, token: string) {
  return call<{ success: boolean }>(`/${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: "POST" });
}

export async function sendText(phoneNumberId: string, token: string, to: string, text: string): Promise<string> {
  const r = await call<{ messages?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: true } }),
  });
  const id = r.messages?.[0]?.id;
  if (!id) throw new HttpError(502, "WhatsApp não retornou o id da mensagem");
  return id;
}

/** Coexistência: pede à Meta o envio do histórico do app WhatsApp Business (até ~6 meses). */
export async function requestHistorySync(phoneNumberId: string, token: string) {
  return call<{ request_id?: string }>(`/${encodeURIComponent(phoneNumberId)}/smb_app_data`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", sync_type: "history" }),
  });
}

export async function downloadMedia(mediaId: string, token: string): Promise<{ data: ArrayBuffer; mime: string }> {
  const meta = await call<{ url: string; mime_type: string }>(`/${encodeURIComponent(mediaId)}`, token);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new HttpError(502, "Falha ao baixar mídia");
  return { data: await res.arrayBuffer(), mime: meta.mime_type };
}

// ---------------------------------------------------------------------------
// Parsing do webhook
// ---------------------------------------------------------------------------
type MetaMsg = Record<string, unknown> & { id: string; from?: string; to?: string; timestamp?: string; type?: string };

function parseContent(m: MetaMsg): Pick<NormalizedMessage, "type" | "body" | "media_ref" | "media_mime"> {
  const t = String(m.type ?? "");
  const obj = (k: string) => (m[k] ?? {}) as Record<string, unknown>;
  const media = (type: MsgType, k: string) => {
    const o = obj(k);
    return {
      type,
      body: (o.caption as string) ?? (k === "document" ? (o.filename as string) ?? null : null),
      media_ref: (o.id as string) ?? null,
      media_mime: (o.mime_type as string) ?? null,
    };
  };
  switch (t) {
    case "text": return { type: "text", body: (obj("text").body as string) ?? "", media_ref: null, media_mime: null };
    case "image": return media("image", "image");
    case "audio": return media("audio", "audio");
    case "video": return media("video", "video");
    case "document": return media("document", "document");
    case "sticker": return media("sticker", "sticker");
    case "location": {
      const l = obj("location");
      return { type: "location", body: [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(" — "), media_ref: null, media_mime: null };
    }
    case "contacts": {
      const c = (m.contacts as { name?: { formatted_name?: string } }[] | undefined)?.[0];
      return { type: "contact", body: c?.name?.formatted_name ?? "Contato", media_ref: null, media_mime: null };
    }
    case "interactive": {
      const i = obj("interactive");
      const r = (i.button_reply ?? i.list_reply ?? {}) as { title?: string };
      return { type: "text", body: r.title ?? "Resposta interativa", media_ref: null, media_mime: null };
    }
    case "button": return { type: "text", body: (obj("button").text as string) ?? "", media_ref: null, media_mime: null };
    default: return { type: "other", body: "Mensagem não suportada", media_ref: null, media_mime: null };
  }
}

const STATUS: Record<string, MsgStatus> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

export interface MetaBatch {
  phoneNumberId: string;
  historical: boolean;
  messages: NormalizedMessage[];
  statuses: StatusUpdate[];
}

export function parseWebhook(payload: unknown): MetaBatch[] {
  const out: MetaBatch[] = [];
  const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as { changes?: { field?: string; value?: Record<string, unknown> }[] }[];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberId = (v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
      if (!phoneNumberId) continue;
      const batch: MetaBatch = { phoneNumberId, historical: change.field === "history", messages: [], statuses: [] };
      const names = new Map<string, string>();
      for (const c of (v.contacts ?? []) as { wa_id?: string; profile?: { name?: string } }[]) {
        if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
      }

      if (change.field === "messages") {
        for (const m of (v.messages ?? []) as MetaMsg[]) {
          if (!m.id || !m.from || m.type === "reaction") continue;
          batch.messages.push({ wa_id: m.from, contact_name: names.get(m.from) ?? null, external_id: m.id, direction: "in", status: "received", sent_at: tsToIso(m.timestamp), ...parseContent(m) });
        }
        for (const s of (v.statuses ?? []) as { id?: string; status?: string }[]) {
          const st = s.status ? STATUS[s.status] : undefined;
          if (s.id && st) batch.statuses.push({ external_id: s.id, status: st });
        }
      } else if (change.field === "smb_message_echoes") {
        // Mensagens enviadas pelo celular (app WhatsApp Business em coexistência)
        for (const m of (v.message_echoes ?? []) as MetaMsg[]) {
          if (!m.id || !m.to || m.type === "reaction") continue;
          batch.messages.push({ wa_id: m.to, contact_name: null, external_id: m.id, direction: "out", status: "sent", sent_at: tsToIso(m.timestamp), ...parseContent(m) });
        }
      } else if (change.field === "history") {
        for (const h of (v.history ?? []) as { threads?: { id?: string; messages?: MetaMsg[] }[] }[]) {
          for (const th of h.threads ?? []) {
            if (!th.id) continue;
            for (const m of th.messages ?? []) {
              if (!m.id || m.type === "reaction") continue;
              const incoming = m.from === th.id;
              batch.messages.push({ wa_id: th.id, contact_name: null, external_id: m.id, direction: incoming ? "in" : "out", status: incoming ? "received" : "sent", sent_at: tsToIso(m.timestamp), ...parseContent(m) });
            }
          }
        }
      }
      if (batch.messages.length || batch.statuses.length) out.push(batch);
    }
  }
  return out;
}

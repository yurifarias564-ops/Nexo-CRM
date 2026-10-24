import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import type { Channel } from "@/lib/types";
import * as meta from "./meta";
import * as evo from "./evolution";
import * as zapi from "./zapi";
import type { NormalizedMessage } from "./types";

export interface ChannelWithSecrets extends Channel {
  secrets: { meta_access_token: string | null; webhook_secret: string; zapi_token?: string | null; zapi_client_token?: string | null };
}

export async function loadChannel(channelId: string): Promise<ChannelWithSecrets> {
  const db = supabaseAdmin();
  const [{ data: ch }, { data: sec }] = await Promise.all([
    db.from("whatsapp_channels").select("*").eq("id", channelId).maybeSingle(),
    db.from("whatsapp_channel_secrets").select("meta_access_token, webhook_secret, zapi_token, zapi_client_token").eq("channel_id", channelId).maybeSingle(),
  ]);
  if (!ch || !sec) throw new HttpError(404, "Canal não encontrado");
  return { ...(ch as Channel), secrets: sec };
}

export function zapiCreds(ch: ChannelWithSecrets): zapi.ZapiCreds {
  if (!ch.zapi_instance_id || !ch.secrets.zapi_token) throw new HttpError(409, "Canal Z-API sem credenciais");
  return { instanceId: ch.zapi_instance_id, token: ch.secrets.zapi_token, clientToken: ch.secrets.zapi_client_token ?? null };
}

export async function sendTextVia(channel: ChannelWithSecrets, waId: string, text: string): Promise<string> {
  if (channel.status !== "connected") throw new HttpError(409, `O canal "${channel.name}" não está conectado`);
  if (channel.provider === "meta") {
    if (!channel.meta_phone_number_id || !channel.secrets.meta_access_token) throw new HttpError(409, "Canal oficial sem credenciais");
    return meta.sendText(channel.meta_phone_number_id, channel.secrets.meta_access_token, waId, text);
  }
  if (channel.provider === "zapi") return zapi.sendText(zapiCreds(channel), waId, text);
  if (!channel.evolution_instance) throw new HttpError(409, "Canal QR sem instância");
  return evo.sendText(channel.evolution_instance, waId, text);
}

/** Grava mensagens em lotes (idempotente). Usado por webhooks e importação de histórico. */
export async function ingestBatch(channelId: string, messages: NormalizedMessage[], historical: boolean) {
  const db = supabaseAdmin();
  if (historical) {
    // Ordem cronológica: o preview da conversa fica com a última mensagem
    const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    for (let i = 0; i < sorted.length; i += 250) {
      const { error } = await db.rpc("ingest_messages", { p_channel: channelId, p_items: sorted.slice(i, i + 250) });
      if (error) throw error;
    }
    return;
  }
  for (const m of messages) {
    const { error } = await db.rpc("ingest_message", {
      p_channel: channelId, p_wa_id: m.wa_id, p_contact_name: m.contact_name, p_external_id: m.external_id,
      p_direction: m.direction, p_type: m.type, p_body: m.body, p_media_ref: m.media_ref, p_media_mime: m.media_mime,
      p_status: m.status, p_sent_at: m.sent_at, p_sent_by: null, p_is_history: false,
    });
    if (error) throw error;
  }
}

export async function applyStatuses(channelId: string, statuses: { external_id: string; status: string }[]) {
  const db = supabaseAdmin();
  for (const s of statuses) {
    const { error } = await db.rpc("update_message_status", { p_channel: channelId, p_external_id: s.external_id, p_status: s.status });
    if (error) throw error;
  }
}

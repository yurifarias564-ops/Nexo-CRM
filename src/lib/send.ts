import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { loadChannel, sendTextVia, type ChannelWithSecrets } from "@/lib/whatsapp";
import * as meta from "@/lib/whatsapp/meta";
import * as evo from "@/lib/whatsapp/evolution";
import type { MsgType } from "@/lib/types";

/**
 * Envio de mensagens (texto, mídia e modelo) compartilhado pelo chat e pelo
 * comando de voz. O cliente `sb` é o do usuário: a RLS garante que conversa
 * e lead pertencem à empresa dele.
 */

export interface SendTarget {
  conversationId?: string;
  leadId?: string;
  channelId?: string;
}

export interface Resolved {
  channel: ChannelWithSecrets;
  waId: string;
  contactName: string | null;
  conversationId: string | null;
}

export const WINDOW_CLOSED = "window_closed";

export async function resolveTarget(sb: SupabaseClient, orgId: string, t: SendTarget): Promise<Resolved> {
  let channelId: string;
  let waId: string;
  let contactName: string | null = null;
  let conversationId: string | null = null;

  if (t.conversationId) {
    const { data: conv } = await sb.from("conversations").select("id, channel_id, wa_id").eq("id", t.conversationId).eq("organization_id", orgId).maybeSingle();
    if (!conv) throw new HttpError(404, "Conversa não encontrada");
    channelId = conv.channel_id;
    waId = conv.wa_id;
    conversationId = conv.id;
  } else if (t.leadId) {
    const { data: lead } = await sb.from("leads").select("id, name, phone").eq("id", t.leadId).eq("organization_id", orgId).maybeSingle();
    if (!lead) throw new HttpError(404, "Lead não encontrado");
    if (!lead.phone) throw new HttpError(422, `O lead "${lead.name}" não tem telefone`);
    // Prefere o canal da conversa que já existe com esse lead
    const { data: conv } = await sb.from("conversations").select("id, channel_id, wa_id")
      .eq("lead_id", lead.id).eq("organization_id", orgId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (conv && (!t.channelId || conv.channel_id === t.channelId)) {
      channelId = conv.channel_id;
      waId = conv.wa_id;
      conversationId = conv.id;
    } else {
      let q = sb.from("whatsapp_channels").select("id").eq("organization_id", orgId).eq("status", "connected").order("created_at").limit(1);
      if (t.channelId) q = q.eq("id", t.channelId);
      const { data: chs } = await q;
      if (!chs?.length) throw new HttpError(409, "Nenhum WhatsApp conectado. Conecte um número em Configurações.");
      channelId = chs[0]!.id;
      waId = lead.phone;
    }
    contactName = lead.name;
  } else {
    throw new HttpError(422, "Informe a conversa ou o lead");
  }

  const channel = await loadChannel(channelId);
  if (channel.organization_id !== orgId) throw new HttpError(404, "Canal não encontrado");
  if (channel.status !== "connected") throw new HttpError(409, `O canal "${channel.name}" não está conectado`);
  return { channel, waId, contactName, conversationId };
}

/** API oficial: só aceita mensagem livre até 24h após a última mensagem do cliente. */
export async function isWindowOpen(r: Resolved): Promise<boolean> {
  if (r.channel.provider !== "meta") return true;
  if (!r.conversationId) return false;
  const { data } = await supabaseAdmin().from("messages").select("sent_at")
    .eq("conversation_id", r.conversationId).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  return Boolean(data && Date.now() - new Date(data.sent_at).getTime() < 24 * 3600 * 1000);
}

async function record(r: Resolved, externalId: string, type: MsgType, body: string | null, mediaRef: string | null, mime: string | null, userId: string | null) {
  const { data, error } = await supabaseAdmin().rpc("ingest_message", {
    p_channel: r.channel.id, p_wa_id: r.waId, p_contact_name: r.contactName, p_external_id: externalId,
    p_direction: "out", p_type: type, p_body: body, p_media_ref: mediaRef, p_media_mime: mime,
    p_status: "sent", p_sent_at: new Date().toISOString(), p_sent_by: userId, p_is_history: false,
  });
  if (error) throw error;
  return data as string;
}

export class WindowClosedError extends HttpError {
  code = WINDOW_CLOSED;
  constructor() {
    super(409, "Passaram 24h desde a última mensagem do cliente. Pela regra da API oficial, envie um modelo aprovado para reabrir a conversa.");
  }
}

function metaAuth(r: Resolved) {
  const auth = r.channel.secrets.meta_access_token;
  const pid = r.channel.meta_phone_number_id;
  if (!auth || !pid) throw new HttpError(409, "Canal oficial sem credenciais");
  return { auth, pid };
}

export async function sendText(sb: SupabaseClient, orgId: string, userId: string | null, t: SendTarget, text: string) {
  const r = await resolveTarget(sb, orgId, t);
  if (!(await isWindowOpen(r))) throw new WindowClosedError();
  const externalId = await sendTextVia(r.channel, r.waId, text);
  const id = await record(r, externalId, "text", text, null, null, userId);
  return { id, externalId };
}

export function mediaKind(mime: string): "image" | "video" | "audio" | "document" {
  if (/^image\/(jpeg|png)$/.test(mime)) return "image";
  if (/^video\/(mp4|3gpp)$/.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  return "document";
}

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export async function sendMediaFile(sb: SupabaseClient, orgId: string, userId: string, t: SendTarget, file: File, caption: string) {
  if (file.size === 0) throw new HttpError(422, "Arquivo vazio");
  if (file.size > MAX_MEDIA_BYTES) throw new HttpError(413, "Arquivo maior que 16 MB");
  const mime = (file.type || "application/octet-stream").split(";")[0]!.toLowerCase();
  const kind = mediaKind(mime);
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "arquivo";
  const r = await resolveTarget(sb, orgId, t);
  if (!(await isWindowOpen(r))) throw new WindowClosedError();

  let externalId: string;
  let mediaRef: string;
  if (r.channel.provider === "meta") {
    const { auth, pid } = metaAuth(r);
    mediaRef = await meta.uploadMedia(pid, auth, file, mime, filename);
    externalId = await meta.sendMedia(pid, auth, r.waId, kind, mediaRef, caption || undefined, filename);
  } else {
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    externalId = await evo.sendMedia(r.channel.evolution_instance!, r.waId, kind, mime, b64, filename, caption || undefined);
    mediaRef = externalId; // baixado sob demanda pelo id da mensagem
  }
  const body = caption || (kind === "document" ? filename : null);
  const id = await record(r, externalId, kind, body, mediaRef, mime, userId);
  return { id, externalId };
}

/** Qual canal/provedor seria usado para este alvo (para avisos ao agendar). */
export async function previewTarget(sb: SupabaseClient, orgId: string, t: SendTarget): Promise<{ provider: "meta" | "evolution"; channelId: string; windowOpenUntil: string | null } | null> {
  try {
    const r = await resolveTarget(sb, orgId, t);
    let until: string | null = null;
    if (r.channel.provider === "meta" && r.conversationId) {
      const { data } = await supabaseAdmin().from("messages").select("sent_at")
        .eq("conversation_id", r.conversationId).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (data) until = new Date(new Date(data.sent_at).getTime() + 24 * 3600 * 1000).toISOString();
    }
    return { provider: r.channel.provider, channelId: r.channel.id, windowOpenUntil: until };
  } catch {
    return null;
  }
}

export async function sendTemplateMessage(sb: SupabaseClient, orgId: string, userId: string | null, t: SendTarget, name: string, language: string, params: string[]) {
  const r = await resolveTarget(sb, orgId, t);
  if (r.channel.provider !== "meta") throw new HttpError(422, "Modelos só existem na API oficial");
  const { auth, pid } = metaAuth(r);
  const templates = await meta.listTemplates(r.channel.meta_waba_id!, auth);
  const tpl = templates.find((x) => x.name === name && x.language === language);
  if (!tpl) throw new HttpError(404, "Modelo não encontrado ou não aprovado");
  if (params.length !== tpl.params || params.some((p) => !p.trim())) throw new HttpError(422, `Preencha os ${tpl.params} campos do modelo`);
  const clean = params.map((p) => p.replace(/[\n\t]+/g, " ").replace(/ {5,}/g, "    ").trim());
  const externalId = await meta.sendTemplate(pid, auth, r.waId, name, language, clean);
  const id = await record(r, externalId, "text", meta.renderTemplate(tpl.body, clean), null, null, userId);
  return { id, externalId };
}

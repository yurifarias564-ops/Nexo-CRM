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

export async function sendMediaFile(sb: SupabaseClient, orgId: string, userId: string, t: SendTarget, file: File, caption: string, opts: { ptv?: boolean } = {}) {
  if (file.size === 0) throw new HttpError(422, "Arquivo vazio");
  if (file.size > MAX_MEDIA_BYTES) throw new HttpError(413, "Arquivo maior que 16 MB");
  const mime = (file.type || "application/octet-stream").split(";")[0]!.toLowerCase();
  const kind = mediaKind(mime);
  const ptv = Boolean(opts.ptv) && kind === "video";
  if (opts.ptv && !ptv) throw new HttpError(422, "O vídeo bolinha precisa ser MP4. Atualize o navegador (Chrome ou Safari recentes) e grave de novo.");
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "arquivo";
  const r = await resolveTarget(sb, orgId, t);
  if (!(await isWindowOpen(r))) throw new WindowClosedError();

  let externalId: string;
  let mediaRef: string;
  if (r.channel.provider === "meta") {
    const { auth, pid } = metaAuth(r);
    mediaRef = await meta.uploadMedia(pid, auth, file, mime, filename);
    // A API oficial não tem vídeo "bolinha": vai como vídeo comum.
    externalId = await meta.sendMedia(pid, auth, r.waId, kind, mediaRef, ptv ? undefined : caption || undefined, filename);
  } else {
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    externalId = ptv
      ? await evo.sendPtv(r.channel.evolution_instance!, r.waId, b64)
      : await evo.sendMedia(r.channel.evolution_instance!, r.waId, kind, mime, b64, filename, caption || undefined);
    mediaRef = externalId; // baixado sob demanda pelo id da mensagem
  }
  const body = ptv ? null : caption || (kind === "document" ? filename : null);
  const id = await record(r, externalId, kind, body, mediaRef, ptv && r.channel.provider !== "meta" ? `${mime};ptv` : mime, userId);
  return { id, externalId };
}

export interface PixInput {
  keyType: "cpf" | "cnpj" | "phone" | "email" | "random";
  key: string;          // normalizada
  keyDisplay: string;   // como o cliente vê
  holderName: string;
  code: string;         // Pix Copia e Cola
  amount: number | null;
  description?: string;
  txid: string;
}

const META_KEY_TYPE = { cpf: "CPF", cnpj: "CNPJ", phone: "PHONE", email: "EMAIL", random: "EVP" } as const;
export const PIX_MIME = "application/x-pix";

/**
 * Cobrança Pix o mais parecida possível com o "Pix" do WhatsApp:
 *  - QR Code (Evolution): cartão nativo "Copiar chave Pix" + (com valor) botão "Copiar código Pix".
 *  - API oficial: cartão de pagamento Pix da Meta quando a conta tem o recurso; senão, mensagens de texto.
 * Se o formato especial falhar, cai para texto (resumo + código Copia e Cola), que sempre funciona.
 */
export async function sendPix(sb: SupabaseClient, orgId: string, userId: string, t: SendTarget, p: PixInput) {
  const r = await resolveTarget(sb, orgId, t);
  if (!(await isWindowOpen(r))) throw new WindowClosedError();
  const brl = p.amount ? p.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
  const label = `${{ cpf: "CPF", cnpj: "CNPJ", phone: "Celular", email: "E-mail", random: "Chave aleatória" }[p.keyType]}: ${p.keyDisplay}`;
  const cardBody = ["💠 Pix", label, brl ? `Valor: ${brl}` : null, p.description ? `Ref.: ${p.description}` : null].filter(Boolean).join("\n");
  const out: string[] = [];
  let native = false;

  try {
    if (r.channel.provider === "meta") {
      if (p.amount) {
        const { auth, pid } = metaAuth(r);
        const id = await meta.sendPixOrder(pid, auth, r.waId, {
          referenceId: p.txid, amountCents: Math.round(p.amount * 100), description: p.description || `Pagamento para ${p.holderName}`,
          code: p.code, merchantName: p.holderName, key: p.key, keyType: META_KEY_TYPE[p.keyType],
        });
        out.push(await record(r, id, "text", cardBody, null, PIX_MIME, userId));
        native = true;
      }
    } else {
      const inst = r.channel.evolution_instance!;
      const id = await evo.sendPixCard(inst, r.waId, { name: p.holderName, keyType: p.keyType, key: p.key });
      out.push(await record(r, id, "text", cardBody, null, PIX_MIME, userId));
      if (p.amount) {
        const id2 = await evo.sendCopyButton(inst, r.waId, {
          title: `Pix de ${brl}`, description: p.description ? `Referente a: ${p.description}` : undefined,
          footer: "Toque em copiar e cole no app do banco (Pix Copia e Cola)", displayText: "Copiar código Pix", copyCode: p.code,
        });
        out.push(await record(r, id2, "text", `💠 Pix Copia e Cola — ${brl}\n${p.code}`, null, PIX_MIME, userId));
      }
      native = true;
    }
  } catch {
    native = false;
  }

  if (!native || (r.channel.provider === "meta" && !p.amount)) {
    const summary = ["💠 *Pix*", label, `Favorecido: ${p.holderName}`, brl ? `Valor: *${brl}*` : null, p.description ? `Referente a: ${p.description}` : null,
      "", "Copie o código da próxima mensagem e cole no app do banco em *Pix Copia e Cola*."].filter((l) => l !== null).join("\n");
    const a = await sendTextVia(r.channel, r.waId, summary);
    out.push(await record(r, a, "text", summary, null, null, userId));
    const b = await sendTextVia(r.channel, r.waId, p.code);
    out.push(await record(r, b, "text", p.code, null, null, userId));
  }
  return { ids: out, native };
}

export interface LocationInput { latitude: number; longitude: number; name?: string; address?: string }

/** Envia um pino de localização (como no WhatsApp). */
export async function sendLocation(sb: SupabaseClient, orgId: string, userId: string, t: SendTarget, loc: LocationInput) {
  const r = await resolveTarget(sb, orgId, t);
  if (!(await isWindowOpen(r))) throw new WindowClosedError();
  const clean = { latitude: loc.latitude, longitude: loc.longitude, ...(loc.name ? { name: loc.name } : {}), ...(loc.address ? { address: loc.address } : {}) };
  let externalId: string;
  if (r.channel.provider === "meta") {
    const { auth, pid } = metaAuth(r);
    externalId = await meta.sendLocation(pid, auth, r.waId, clean);
  } else {
    externalId = await evo.sendLocation(r.channel.evolution_instance!, r.waId, clean);
  }
  const body = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`].filter(Boolean).join(" — ");
  const id = await record(r, externalId, "location", body, null, null, userId);
  return { id, externalId, body };
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

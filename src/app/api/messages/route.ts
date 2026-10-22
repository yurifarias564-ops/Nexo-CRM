import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { loadChannel, sendTextVia } from "@/lib/whatsapp";

export const runtime = "nodejs";

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    text: z.string().trim().min(1, "Digite uma mensagem").max(4096, "Mensagem muito longa"),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Envia texto pelo WhatsApp e registra no histórico. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    const body = Body.parse(await readJson(req, 64_000));
    const sb = await supabaseServer(); // RLS garante que a conversa/lead é da empresa do usuário

    let channelId: string;
    let waId: string;
    let contactName: string | null = null;

    if (body.conversationId) {
      const { data: conv } = await sb.from("conversations").select("id, channel_id, wa_id").eq("id", body.conversationId).maybeSingle();
      if (!conv) throw new HttpError(404, "Conversa não encontrada");
      channelId = conv.channel_id;
      waId = conv.wa_id;
    } else {
      const { data: lead } = await sb.from("leads").select("id, name, phone").eq("id", body.leadId!).maybeSingle();
      if (!lead) throw new HttpError(404, "Lead não encontrado");
      if (!lead.phone) throw new HttpError(422, "Este lead não tem telefone");
      let q = sb.from("whatsapp_channels").select("id").eq("status", "connected").order("created_at").limit(1);
      if (body.channelId) q = q.eq("id", body.channelId);
      const { data: chs } = await q;
      if (!chs?.length) throw new HttpError(409, "Nenhum WhatsApp conectado. Conecte um número em Configurações.");
      channelId = chs[0]!.id;
      waId = lead.phone;
      contactName = lead.name;
    }

    const channel = await loadChannel(channelId);
    if (channel.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    const externalId = await sendTextVia(channel, waId, body.text);

    const { data: msgId, error } = await supabaseAdmin().rpc("ingest_message", {
      p_channel: channelId, p_wa_id: waId, p_contact_name: contactName, p_external_id: externalId,
      p_direction: "out", p_type: "text", p_body: body.text, p_media_ref: null, p_media_mime: null,
      p_status: "sent", p_sent_at: new Date().toISOString(), p_sent_by: ctx.userId, p_is_history: false,
    });
    if (error) throw error;
    return ok({ id: msgId, externalId }, 201);
  } catch (e) {
    return fail(e);
  }
}

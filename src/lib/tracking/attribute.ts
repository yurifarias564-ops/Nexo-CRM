import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedMessage } from "@/lib/whatsapp/types";
import { classify, findProtocol, type Channel } from "./shared";

/**
 * Depois de gravar mensagens recebidas: descobre de onde o cliente veio.
 * 1) Protocolo do link rastreado no texto → clique → campanha/UTMs.
 * 2) Anúncio "clique para o WhatsApp" (Meta) → id e título do anúncio.
 * Guarda só o primeiro contato rastreado do lead (não sobrescreve).
 */
export async function trackAfterIngest(channelId: string, messages: NormalizedMessage[]) {
  const incoming = messages.filter((m) => m.direction === "in" && (findProtocol(m.body) || m.ad));
  if (!incoming.length) return;
  const db = supabaseAdmin();
  const { data: ch } = await db.from("whatsapp_channels").select("organization_id").eq("id", channelId).maybeSingle();
  if (!ch) return;
  const org = ch.organization_id as string;

  for (const m of incoming) {
    try {
      const { data: row } = await db.from("messages").select("conversation_id, conversations(lead_id)").eq("channel_id", channelId).eq("external_id", m.external_id).maybeSingle();
      const conv = row?.conversations as { lead_id: string | null } | { lead_id: string | null }[] | null | undefined;
      const leadId = (Array.isArray(conv) ? conv[0]?.lead_id : conv?.lead_id) ?? null;
      if (!leadId) continue;
      const { data: existing } = await db.from("lead_origins").select("lead_id").eq("lead_id", leadId).maybeSingle();

      const code = findProtocol(m.body);
      if (code) {
        const { data: click } = await db.from("tracking_clicks").select("*, tracking_links(kind)").eq("code", code).eq("organization_id", org).maybeSingle();
        if (click && Date.now() - new Date(click.created_at).getTime() < 30 * 86_400_000) {
          if (!click.lead_id) await db.from("tracking_clicks").update({ lead_id: leadId, matched_at: new Date().toISOString() }).eq("id", click.id);
          if (!existing) {
            const kind = (Array.isArray(click.tracking_links) ? click.tracking_links[0]?.kind : click.tracking_links?.kind) as "link" | "site" | undefined;
            const channel: Channel = classify({ ...click, kind });
            await db.from("lead_origins").insert({
              lead_id: leadId, organization_id: org, channel, source_type: kind === "site" ? "site" : "link",
              utm_source: click.utm_source, utm_medium: click.utm_medium, utm_campaign: click.utm_campaign, utm_content: click.utm_content, utm_term: click.utm_term,
              fbclid: click.fbclid, gclid: click.gclid, link_id: click.link_id, click_id: click.id,
              ad_id: m.ad?.source_id ?? null, ad_title: m.ad?.title ?? null, ad_url: m.ad?.source_url ?? null, ctwa_clid: m.ad?.ctwa_clid ?? null,
            }).then(() => undefined, () => undefined);
          }
          continue;
        }
      }
      if (m.ad && !existing) {
        await db.from("lead_origins").insert({
          lead_id: leadId, organization_id: org, channel: "meta_ads", source_type: "anuncio_whatsapp",
          utm_source: "meta", utm_medium: "ctwa", utm_campaign: m.ad.title, utm_content: m.ad.source_id,
          ad_id: m.ad.source_id, ad_title: m.ad.title, ad_url: m.ad.source_url, ctwa_clid: m.ad.ctwa_clid,
        }).then(() => undefined, () => undefined);
      }
    } catch (e) {
      console.error("[rastreio]", e);
    }
  }
}

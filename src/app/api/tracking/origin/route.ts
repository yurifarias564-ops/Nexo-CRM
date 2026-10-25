import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CHANNELS } from "@/lib/tracking/shared";

export const runtime = "nodejs";

const opt = z.string().trim().max(200).nullable().optional().transform((v) => (v ? v : null));
const Body = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(Object.keys(CHANNELS) as [keyof typeof CHANNELS, ...(keyof typeof CHANNELS)[]]).nullable(),
  utm_campaign: opt,
  utm_content: opt,
});

/** Define (ou apaga) a origem de um lead manualmente — ex.: indicação, cliente que veio da loja. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext();
    const b = Body.parse(await readJson(req, 4000));
    const sb = await supabaseServer();
    const { data: lead } = await sb.from("leads").select("id, organization_id").eq("id", b.leadId).maybeSingle();
    if (!lead || lead.organization_id !== ctx.org.id) throw new HttpError(404, "Lead não encontrado");
    const db = supabaseAdmin();
    if (!b.channel) {
      await db.from("lead_origins").delete().eq("lead_id", lead.id);
      return ok({ ok: true });
    }
    const { error } = await db.from("lead_origins").upsert({
      lead_id: lead.id, organization_id: ctx.org.id, channel: b.channel, source_type: "manual",
      utm_campaign: b.utm_campaign, utm_content: b.utm_content, updated_at: new Date().toISOString(),
      // Origem manual: limpa os dados de clique/anúncio para a venda não ser atribuída ao anúncio errado
      utm_source: null, utm_medium: null, utm_term: null, ad_id: null, ad_title: null, ad_url: null,
      ctwa_clid: null, fbclid: null, gclid: null, link_id: null, click_id: null,
    });
    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

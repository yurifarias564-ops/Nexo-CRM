import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Cruza os números do Meta (investimento, cliques, conversas) com o CRM (leads, vendas, faturamento) por anúncio.

export interface AdRow {
  ad_id: string; name: string; status: string | null; campaign: string | null; adset: string | null; thumbnail: string | null;
  spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; conversations: number;
  leads: number; sales: number; revenue: number;
}

type Origin = { lead_id: string; ad_id: string | null; utm_term: string | null; utm_content: string | null; ad_title: string | null };
type AdMeta = { ad_id: string; name: string | null; status: string | null; campaign_name: string | null; adset_name: string | null; thumbnail_url: string | null };

/** Descobre o anúncio de cada origem: id do anúncio (clique para WhatsApp), {{ad.id}} na UTM ou nome do anúncio. */
export function resolveAd(o: Origin, byName: Map<string, string>, known: Set<string>): string | null {
  if (o.ad_id && (known.has(o.ad_id) || /^\d{6,}$/.test(o.ad_id))) return o.ad_id;
  if (o.utm_term && /^\d{6,}$/.test(o.utm_term)) return o.utm_term;
  if (o.utm_content && /^\d{6,}$/.test(o.utm_content)) return o.utm_content;
  const n = (o.utm_content || o.ad_title || "").trim().toLowerCase();
  return n ? byName.get(n) ?? null : null;
}

async function all<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await q(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function context(orgId: string) {
  const db = supabaseAdmin();
  const ads = await all<AdMeta>((a, b) => db.from("meta_ads").select("ad_id, name, status, campaign_name, adset_name, thumbnail_url").eq("organization_id", orgId).range(a, b));
  const byName = new Map<string, string>();
  for (const a of ads) if (a.name) byName.set(a.name.trim().toLowerCase(), a.ad_id);
  return { ads, byName, known: new Set(ads.map((a) => a.ad_id)) };
}

export async function adsReport(orgId: string, fromIso: string, toIso: string, fromDay: string, toDay: string) {
  const db = supabaseAdmin();
  const { ads, byName, known } = await context(orgId);
  const [ins, stages, origins] = await Promise.all([
    all<{ ad_id: string; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; conversations: number }>((a, b) =>
      db.from("meta_ad_insights").select("ad_id, spend, impressions, reach, clicks, link_clicks, conversations").eq("organization_id", orgId).gte("day", fromDay).lte("day", toDay).range(a, b)),
    db.from("stages").select("id, kind").eq("organization_id", orgId).then((r) => r.data ?? []),
    all<Origin>((a, b) => db.from("lead_origins").select("lead_id, ad_id, utm_term, utm_content, ad_title").eq("organization_id", orgId).range(a, b)),
  ]);
  const won = new Set(stages.filter((s) => s.kind === "won").map((s) => s.id));
  const leadAd = new Map<string, string>();
  for (const o of origins) { const ad = resolveAd(o, byName, known); if (ad) leadAd.set(o.lead_id, ad); }

  const rows = new Map<string, AdRow>();
  const meta = new Map(ads.map((a) => [a.ad_id, a]));
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const m = meta.get(id);
      r = { ad_id: id, name: m?.name ?? `Anúncio ${id}`, status: m?.status ?? null, campaign: m?.campaign_name ?? null, adset: m?.adset_name ?? null, thumbnail: m?.thumbnail_url ?? null,
        spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, conversations: 0, leads: 0, sales: 0, revenue: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const i of ins) {
    const r = row(i.ad_id);
    r.spend += Number(i.spend) || 0; r.impressions += Number(i.impressions) || 0; r.reach += Number(i.reach) || 0;
    r.clicks += Number(i.clicks) || 0; r.link_clicks += Number(i.link_clicks) || 0; r.conversations += Number(i.conversations) || 0;
  }
  const ids = [...leadAd.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("leads").select("id, value, created_at, stage_id, stage_changed_at").in("id", ids.slice(i, i + 300));
    for (const l of data ?? []) {
      const r = row(leadAd.get(l.id)!);
      if (l.created_at >= fromIso && l.created_at < toIso) r.leads++;
      if (won.has(l.stage_id) && l.stage_changed_at >= fromIso && l.stage_changed_at < toIso) { r.sales++; r.revenue += Number(l.value) || 0; }
    }
  }
  // Ativos sem números no período também aparecem
  for (const a of ads) if (a.status === "ACTIVE") row(a.ad_id);

  const list = [...rows.values()].filter((r) => r.spend > 0 || r.leads > 0 || r.sales > 0 || r.status === "ACTIVE")
    .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend || b.leads - a.leads);
  const totals = list.reduce((t, r) => ({ spend: t.spend + r.spend, impressions: t.impressions + r.impressions, clicks: t.clicks + r.link_clicks, conversations: t.conversations + r.conversations, leads: t.leads + r.leads, sales: t.sales + r.sales, revenue: t.revenue + r.revenue }),
    { spend: 0, impressions: 0, clicks: 0, conversations: 0, leads: 0, sales: 0, revenue: 0 });
  return { rows: list, totals };
}

/** Leads que vieram de um anúncio (com a conversa, para abrir direto no chat). */
export async function adLeads(orgId: string, adId: string) {
  const db = supabaseAdmin();
  const { byName, known } = await context(orgId);
  const origins = await all<Origin & { created_at: string }>((a, b) => db.from("lead_origins").select("lead_id, ad_id, utm_term, utm_content, ad_title, created_at").eq("organization_id", orgId).range(a, b));
  const ids = origins.filter((o) => resolveAd(o, byName, known) === adId).map((o) => o.lead_id);
  const out: { id: string; name: string; phone: string | null; value: number; stage: string | null; won: boolean; created_at: string; conversation_id: string | null; last_message_preview: string | null }[] = [];
  for (let i = 0; i < ids.length && out.length < 500; i += 200) {
    const { data } = await db.from("leads").select("id, name, phone, value, created_at, last_message_preview, stages(name, kind), conversations(id, last_message_at)").in("id", ids.slice(i, i + 200));
    for (const l of data ?? []) {
      const st = (Array.isArray(l.stages) ? l.stages[0] : l.stages) as { name: string; kind: string } | null;
      const convs = (l.conversations ?? []) as { id: string; last_message_at: string | null }[];
      const conv = [...convs].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0];
      out.push({ id: l.id, name: l.name, phone: l.phone, value: Number(l.value) || 0, stage: st?.name ?? null, won: st?.kind === "won", created_at: l.created_at, conversation_id: conv?.id ?? null, last_message_preview: l.last_message_preview });
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

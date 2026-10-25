import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CHANNELS, NOT_TRACKED, type Channel } from "./shared";

export interface Row { key: string; label: string; color?: string; clicks: number; leads: number; sales: number; revenue: number }
export interface Report {
  from: string; to: string;
  totals: { clicks: number; leads: number; tracked: number; sales: number; revenue: number };
  daily: { day: string; leads: number; sales: number; revenue: number }[];
  byChannel: Row[]; byCampaign: Row[]; byCreative: Row[]; byLink: Row[];
  recent: { id: string; name: string; created_at: string; value: number; won: boolean; channel: string | null; campaign: string | null; creative: string | null }[];
}

type Origin = { channel: Channel; utm_campaign: string | null; utm_content: string | null; ad_title: string | null; ad_id: string | null; link_id: string | null };

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await q(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Relatório de campanhas: leads criados e vendas ganhas no período, por origem. */
export async function campaignReport(orgId: string, fromIso: string, toIso: string, tz: string): Promise<Report> {
  const db = supabaseAdmin();
  const [stages, links] = await Promise.all([
    db.from("stages").select("id, kind").eq("organization_id", orgId).then((r) => r.data ?? []),
    db.from("tracking_links").select("id, name").eq("organization_id", orgId).then((r) => r.data ?? []),
  ]);
  const wonStages = new Set(stages.filter((s) => s.kind === "won").map((s) => s.id));
  const linkName = new Map(links.map((l) => [l.id, l.name as string]));

  type L = { id: string; name: string; value: number; created_at: string; stage_id: string; stage_changed_at: string };
  const [created, won, clicks] = await Promise.all([
    all<L>((a, b) => db.from("leads").select("id, name, value, created_at, stage_id, stage_changed_at").eq("organization_id", orgId).gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).order("id").range(a, b)),
    wonStages.size
      ? all<L>((a, b) => db.from("leads").select("id, name, value, created_at, stage_id, stage_changed_at").eq("organization_id", orgId).in("stage_id", [...wonStages]).gte("stage_changed_at", fromIso).lt("stage_changed_at", toIso).order("id").range(a, b))
      : Promise.resolve([] as L[]),
    all<{ link_id: string; created_at: string; utm_campaign: string | null; utm_content: string | null }>((a, b) => db.from("tracking_clicks").select("link_id, created_at, utm_campaign, utm_content").eq("organization_id", orgId).gte("created_at", fromIso).lt("created_at", toIso).order("id").range(a, b)),
  ]);

  const ids = [...new Set([...created, ...won].map((l) => l.id))];
  const origins = new Map<string, Origin>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("lead_origins").select("lead_id, channel, utm_campaign, utm_content, ad_title, ad_id, link_id").in("lead_id", ids.slice(i, i + 300));
    for (const o of data ?? []) origins.set(o.lead_id, o as Origin);
  }

  const groups = { ch: new Map<string, Row>(), camp: new Map<string, Row>(), cre: new Map<string, Row>(), link: new Map<string, Row>() };
  const row = (m: Map<string, Row>, key: string, label: string, color?: string) => {
    let r = m.get(key);
    if (!r) { r = { key, label, color, clicks: 0, leads: 0, sales: 0, revenue: 0 }; m.set(key, r); }
    return r;
  };
  const keysOf = (o: Origin | undefined) => {
    const ch = o ? CHANNELS[o.channel] : NOT_TRACKED;
    const camp = o?.utm_campaign || o?.ad_title || null;
    const cre = o?.utm_content || o?.ad_title || o?.ad_id || null;
    return {
      ch: [o?.channel ?? "nao_rastreado", ch.label, ch.color] as const,
      camp: camp ? [camp, camp] as const : null,
      cre: cre ? [cre, cre] as const : null,
      link: o?.link_id ? [o.link_id, linkName.get(o.link_id) ?? "Link"] as const : null,
    };
  };

  const daily = new Map<string, { day: string; leads: number; sales: number; revenue: number }>();
  const d = (iso: string) => {
    const k = dayOf(iso, tz);
    let x = daily.get(k);
    if (!x) { x = { day: k, leads: 0, sales: 0, revenue: 0 }; daily.set(k, x); }
    return x;
  };

  for (const l of created) {
    const k = keysOf(origins.get(l.id));
    row(groups.ch, ...k.ch).leads++;
    if (k.camp) row(groups.camp, ...k.camp).leads++;
    if (k.cre) row(groups.cre, ...k.cre).leads++;
    if (k.link) row(groups.link, ...k.link).leads++;
    d(l.created_at).leads++;
  }
  let revenue = 0;
  for (const l of won) {
    const v = Number(l.value) || 0;
    revenue += v;
    const k = keysOf(origins.get(l.id));
    for (const [m, kk] of [[groups.ch, k.ch], [groups.camp, k.camp], [groups.cre, k.cre], [groups.link, k.link]] as const) {
      if (!kk) continue;
      const r = row(m, ...(kk as unknown as [string, string, string?]));
      r.sales++; r.revenue += v;
    }
    const x = d(l.stage_changed_at); x.sales++; x.revenue += v;
  }
  for (const c of clicks) {
    row(groups.link, c.link_id, linkName.get(c.link_id) ?? "Link").clicks++;
    if (c.utm_campaign) row(groups.camp, c.utm_campaign, c.utm_campaign).clicks++;
    if (c.utm_content) row(groups.cre, c.utm_content, c.utm_content).clicks++;
  }

  // Dias sem movimento também aparecem no gráfico
  const days: { day: string; leads: number; sales: number; revenue: number }[] = [];
  for (let t = new Date(fromIso).getTime(); t < new Date(toIso).getTime() && days.length < 400; t += 86_400_000) {
    const k = dayOf(new Date(t).toISOString(), tz);
    if (!days.some((x) => x.day === k)) days.push(daily.get(k) ?? { day: k, leads: 0, sales: 0, revenue: 0 });
  }

  const sort = (m: Map<string, Row>) => [...m.values()].sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || b.clicks - a.clicks);
  return {
    from: fromIso, to: toIso,
    totals: { clicks: clicks.length, leads: created.length, tracked: created.filter((l) => origins.has(l.id)).length, sales: won.length, revenue },
    daily: days,
    byChannel: sort(groups.ch), byCampaign: sort(groups.camp).slice(0, 100), byCreative: sort(groups.cre).slice(0, 100), byLink: sort(groups.link),
    recent: created.slice(0, 60).map((l) => {
      const o = origins.get(l.id);
      return { id: l.id, name: l.name, created_at: l.created_at, value: Number(l.value) || 0, won: wonStages.has(l.stage_id), channel: o?.channel ?? null, campaign: o?.utm_campaign || o?.ad_title || null, creative: o?.utm_content || o?.ad_id || null };
    }),
  };
}

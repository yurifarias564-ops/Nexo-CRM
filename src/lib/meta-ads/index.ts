import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";

// Meta Ads: lê anúncios e investimento (Marketing API) e envia eventos de conversão (API de Conversões).
// A credencial do Business Manager fica só no servidor (tabela meta_secrets, sem acesso pelo navegador).

export const GRAPH = "https://graph.facebook.com/v25.0";

export interface MetaConn {
  organization_id: string; ad_account_id: string | null; ad_account_name: string | null; currency: string;
  pixel_id: string | null; page_id: string | null; send_purchase: boolean; send_lead: boolean;
  last_sync_at: string | null; last_error: string | null;
}

export async function loadConn(orgId: string): Promise<{ conn: MetaConn | null; cred: string | null }> {
  const db = supabaseAdmin();
  const [{ data: conn }, { data: sec }] = await Promise.all([
    db.from("meta_connections").select("*").eq("organization_id", orgId).maybeSingle(),
    db.from("meta_secrets").select("*").eq("organization_id", orgId).maybeSingle(),
  ]);
  const row = sec as Record<string, string> | null;
  return { conn: (conn as MetaConn | null) ?? null, cred: row ? row["access_token"] ?? null : null };
}

async function graph<T = Record<string, unknown>>(url: string, cred: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const u = new URL(url.startsWith("http") ? url : `${GRAPH}/${url.replace(/^\//, "")}`);
  // A chave só vai para o servidor da Meta (inclusive nos links de "próxima página")
  if (u.protocol !== "https:" || u.hostname !== "graph.facebook.com") throw new HttpError(502, "Meta: endereço inesperado na paginação");
  const headers: Record<string, string> = { authorization: `Bearer ${cred}` };
  if (init?.body) headers["content-type"] = "application/json";
  const res = await fetch(u, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(45_000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || data.error) {
    const e = data.error;
    const msg = e?.error_user_msg || e?.message || `HTTP ${res.status}`;
    if (e?.code === 190) throw new HttpError(401, "A chave de acesso do Meta é inválida ou expirou. Gere uma nova no Business Manager.");
    if (e?.code === 10 || e?.code === 200 || e?.code === 100) throw new HttpError(403, `Meta recusou: ${msg}`);
    throw new HttpError(502, `Meta: ${msg}`);
  }
  return data;
}

export interface AdAccountInfo { id: string; name: string; currency: string; status: number; pixels: { id: string; name: string }[] }

/** Contas de anúncios e pixels que a chave enxerga (para escolher depois do "Conectar com o Facebook"). */
export async function listAssets(cred: string): Promise<{ accounts: AdAccountInfo[]; pages: { id: string; name: string }[] }> {
  type A = { id: string; name?: string; currency?: string; account_status?: number };
  const accounts = await pages<A>("me/adaccounts?fields=id,name,currency,account_status&limit=100", cred, 5);
  const out: AdAccountInfo[] = [];
  for (const a of accounts.slice(0, 40)) {
    const px = await pages<{ id: string; name?: string }>(`${a.id}/adspixels?fields=id,name&limit=50`, cred, 2).catch(() => []);
    out.push({ id: a.id, name: a.name ?? a.id, currency: a.currency ?? "BRL", status: a.account_status ?? 1, pixels: px.map((p) => ({ id: p.id, name: p.name ?? p.id })) });
  }
  const pg = await pages<{ id: string; name?: string }>("me/accounts?fields=id,name&limit=100", cred, 3).catch(() => []);
  // Conta ativa primeiro (status 1 = ativa), depois a que tem pixel
  out.sort((x, y) => (x.status === 1 ? 0 : 1) - (y.status === 1 ? 0 : 1) || y.pixels.length - x.pixels.length);
  return { accounts: out, pages: pg.map((p) => ({ id: p.id, name: p.name ?? p.id })) };
}

/**
 * API oficial: ao conectar o número pelo Cadastro Incorporado (com os produtos "Anúncios de clique para o WhatsApp"
 * e "API de Conversões" na configuração), o mesmo acesso já enxerga a conta de anúncios e o conjunto de dados do WhatsApp.
 * Aqui ligamos tudo sozinho: conta de anúncios, conjunto de dados (pixel) e envio de vendas.
 */
export async function autoConnectFromWhatsApp(orgId: string, cred: string, wabaId: string) {
  const db = supabaseAdmin();
  // Conjunto de dados ligado à conta do WhatsApp (é ele que recebe as vendas de anúncios de clique para o WhatsApp)
  let datasetId: string | null = null;
  try {
    const r = await graph<{ data?: { id: string }[]; id?: string }>(`${wabaId}/dataset`, cred);
    datasetId = r.data?.[0]?.id ?? r.id ?? null;
    if (!datasetId) datasetId = (await graph<{ id?: string }>(`${wabaId}/dataset`, cred, { method: "POST" })).id ?? null;
  } catch { /* sem a permissão de eventos: segue sem */ }
  let assets: Awaited<ReturnType<typeof listAssets>> | null = null;
  try { assets = await listAssets(cred); } catch { /* sem a permissão de anúncios: segue sem */ }
  const account = assets?.accounts[0] ?? null;
  if (!datasetId && !account) return { connected: false as const };

  const { conn: prev, cred: prevCred } = await loadConn(orgId);
  // Já conectado pelo "Conectar com o Facebook": só completa o que faltar
  if (!prevCred) {
    await db.from("meta_secrets").upsert({ organization_id: orgId, ["access_token"]: cred, updated_at: new Date().toISOString() });
  }
  await db.from("meta_connections").upsert({
    organization_id: orgId,
    ad_account_id: prev?.ad_account_id ?? account?.id ?? null, ad_account_name: prev?.ad_account_name ?? account?.name ?? null,
    currency: prev?.currency ?? account?.currency ?? "BRL",
    pixel_id: prev?.pixel_id ?? datasetId ?? account?.pixels[0]?.id ?? null,
    page_id: prev?.page_id ?? (assets?.pages.length === 1 ? assets.pages[0]!.id : null),
    send_purchase: prev?.send_purchase ?? true, send_lead: prev?.send_lead ?? true, updated_at: new Date().toISOString(),
  });
  if (account && !prevCred) await syncAds(orgId, new Date(Date.now() - 30 * 86_400_000), new Date()).catch(() => undefined);
  return { connected: true as const, account: account?.name ?? null, dataset: Boolean(datasetId) };
}

/** Confere a chave, a conta de anúncios e o pixel antes de salvar. */
export async function verify(cred: string, adAccountId: string | null, pixelId: string | null) {
  const out: { account?: { name: string; currency: string; status: number }; pixel?: { name: string } } = {};
  if (adAccountId) {
    const a = await graph<{ name: string; currency: string; account_status: number }>(`${adAccountId}?fields=name,currency,account_status`, cred);
    out.account = { name: a.name, currency: a.currency, status: a.account_status };
  }
  if (pixelId) {
    const p = await graph<{ name?: string }>(`${pixelId}?fields=name`, cred);
    out.pixel = { name: p.name ?? "Pixel" };
  }
  return out;
}

async function pages<T>(first: string, cred: string, max = 20): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  for (let i = 0; next && i < max; i++) {
    const r: { data?: T[]; paging?: { next?: string } } = await graph(next, cred);
    out.push(...(r.data ?? []));
    next = r.paging?.next ?? null;
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Puxa anúncios (nome, status, campanha, conjunto, miniatura) e números por dia do período. */
export async function syncAds(orgId: string, since: Date, until: Date) {
  const { conn, cred } = await loadConn(orgId);
  if (!conn?.ad_account_id || !cred) throw new HttpError(409, "Conecte a conta de anúncios do Meta primeiro.");
  const db = supabaseAdmin();
  try {
    type Ad = { id: string; name?: string; effective_status?: string; campaign?: { id: string; name: string }; adset?: { id: string; name: string }; creative?: { thumbnail_url?: string } };
    const ads = await pages<Ad>(`${conn.ad_account_id}/ads?fields=id,name,effective_status,campaign{id,name},adset{id,name},creative{thumbnail_url}&limit=200`, cred, 15);
    for (let i = 0; i < ads.length; i += 300) {
      const rows = ads.slice(i, i + 300).map((a) => ({
        organization_id: orgId, ad_id: a.id, name: a.name ?? null, status: a.effective_status ?? null,
        campaign_id: a.campaign?.id ?? null, campaign_name: a.campaign?.name ?? null, adset_id: a.adset?.id ?? null, adset_name: a.adset?.name ?? null,
        thumbnail_url: a.creative?.thumbnail_url ?? null, updated_at: new Date().toISOString(),
      }));
      const { error } = await db.from("meta_ads").upsert(rows);
      if (error) throw error;
    }

    type Ins = { ad_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] };
    const range = encodeURIComponent(JSON.stringify({ since: ymd(since), until: ymd(until) }));
    const ins = await pages<Ins>(`${conn.ad_account_id}/insights?level=ad&time_increment=1&time_range=${range}&fields=ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions&limit=500`, cred, 40);
    const conv = (a: Ins["actions"]) => num(a?.find((x) => x.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value);
    for (let i = 0; i < ins.length; i += 500) {
      const rows = ins.slice(i, i + 500).map((r) => ({
        organization_id: orgId, ad_id: r.ad_id, day: r.date_start, spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach),
        clicks: num(r.clicks), link_clicks: num(r.inline_link_clicks), conversations: conv(r.actions), updated_at: new Date().toISOString(),
      }));
      const { error } = await db.from("meta_ad_insights").upsert(rows);
      if (error) throw error;
    }
    await db.from("meta_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("organization_id", orgId);
    return { ads: ads.length, rows: ins.length };
  } catch (e) {
    await db.from("meta_connections").update({ last_error: (e as Error).message.slice(0, 500) }).eq("organization_id", orgId);
    throw e;
  }
}

/** Sincroniza as contas conectadas há mais de 1 hora (chamado pelo cron). */
export async function syncStale(limit = 3) {
  const { data } = await supabaseAdmin().from("meta_connections").select("organization_id, last_sync_at").not("ad_account_id", "is", null)
    .or(`last_sync_at.is.null,last_sync_at.lt.${new Date(Date.now() - 3600_000).toISOString()}`).limit(limit);
  let n = 0;
  for (const c of data ?? []) {
    try { await syncAds(c.organization_id, new Date(Date.now() - 3 * 86_400_000), new Date()); n++; } catch { /* o erro fica salvo na conexão */ }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// API de Conversões
// ---------------------------------------------------------------------------------------------

const sha = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export interface EventCtx {
  eventName: "Lead" | "Purchase"; eventKey: string; value: number | null; currency: string; at: Date;
  lead: { id: string; name: string; phone: string | null; email: string | null };
  origin: { source_type: string; ctwa_clid: string | null; fbclid: string | null; clickAt: string | null } | null;
  wabaId: string | null; pageId: string | null;
}

/** Monta o evento no formato do Meta (dados pessoais sempre com hash SHA-256). */
export function buildEvent(c: EventCtx): { mode: string; event: Record<string, unknown> } {
  const names = c.lead.name.trim().split(/\s+/);
  const user: Record<string, unknown> = { external_id: [sha(c.lead.id)], country: [sha("br")] };
  if (c.lead.phone) user.ph = [sha(c.lead.phone.replace(/\D/g, ""))];
  if (c.lead.email) user.em = [sha(c.lead.email)];
  if (names[0] && !/^\+?\d+$/.test(names[0]) && plain(names[0])) {
    user.fn = [sha(plain(names[0]))];
    if (names.length > 1 && plain(names[names.length - 1]!)) user.ln = [sha(plain(names[names.length - 1]!))];
  }
  if (c.origin?.fbclid) user.fbc = `fb.1.${new Date(c.origin.clickAt ?? c.at).getTime()}.${c.origin.fbclid}`;

  const custom: Record<string, unknown> = c.eventName === "Purchase" ? { currency: c.currency, value: Number(c.value ?? 0) } : { lead_event_source: "Nexo CRM" };
  const base = { event_name: c.eventName, event_time: Math.floor(c.at.getTime() / 1000), event_id: c.eventKey, custom_data: custom };

  // Veio de anúncio de clique para o WhatsApp: evento de mensagem (o Meta liga ao anúncio exato)
  if (c.origin?.ctwa_clid && c.wabaId) {
    return { mode: "whatsapp_ctwa", event: { ...base, action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { ...user, ctwa_clid: c.origin.ctwa_clid, whatsapp_business_account_id: c.wabaId } } };
  }
  if (c.origin?.source_type === "anuncio_whatsapp" && c.pageId) {
    return { mode: "whatsapp_pagina", event: { ...base, action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { ...user, page_id: c.pageId, ...(c.origin.ctwa_clid ? { ctwa_clid: c.origin.ctwa_clid } : {}) } } };
  }
  return { mode: "pixel", event: { ...base, action_source: "chat", user_data: user } };
}

/** Envia os eventos pendentes (Lead e Purchase) de todas as empresas. Chamado a cada minuto. */
export async function dispatchEvents(limit = 40) {
  const db = supabaseAdmin();
  // Envios que travaram no meio (servidor caiu) voltam para a fila
  await db.from("meta_events").update({ status: "pending" }).eq("status", "sending").lt("next_attempt_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { data: pend } = await db.from("meta_events").select("id").eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).order("created_at").limit(limit);
  let sent = 0;
  const conns = new Map<string, Awaited<ReturnType<typeof loadConn>> & { waba: string | null }>();
  for (const p of pend ?? []) {
    // Trava: só um processo envia cada evento (sem evento duplicado na Meta)
    const { data: ev } = await db.from("meta_events").update({ status: "sending", next_attempt_at: new Date().toISOString() }).eq("id", p.id).eq("status", "pending").select("*").maybeSingle();
    if (!ev) continue;
    try {
      let cc = conns.get(ev.organization_id);
      if (!cc) {
        const c = await loadConn(ev.organization_id);
        const { data: ch } = await db.from("whatsapp_channels").select("meta_waba_id").eq("organization_id", ev.organization_id).not("meta_waba_id", "is", null).limit(1).maybeSingle();
        cc = { ...c, waba: ch?.meta_waba_id ?? null };
        conns.set(ev.organization_id, cc);
      }
      // A Meta só aceita eventos de até 7 dias
      if (Date.now() - new Date(ev.created_at).getTime() > 7 * 86_400_000) {
        await db.from("meta_events").update({ status: "skipped", error: "Expirado (a Meta só aceita eventos de até 7 dias)" }).eq("id", ev.id);
        continue;
      }
      if (!cc.conn?.pixel_id || !cc.cred || !ev.lead_id) {
        await db.from("meta_events").update({ status: "skipped", error: "Pixel ou chave de acesso não configurados" }).eq("id", ev.id);
        continue;
      }
      const [{ data: lead }, { data: origin }] = await Promise.all([
        db.from("leads").select("id, name, phone, email, value").eq("id", ev.lead_id).maybeSingle(),
        db.from("lead_origins").select("source_type, ctwa_clid, fbclid, tracking_clicks(created_at)").eq("lead_id", ev.lead_id).maybeSingle(),
      ]);
      if (!lead) { await db.from("meta_events").update({ status: "skipped", error: "Lead apagado" }).eq("id", ev.id); continue; }
      const click = origin?.tracking_clicks as { created_at: string } | { created_at: string }[] | null | undefined;
      const { mode, event } = buildEvent({
        eventName: ev.event_name, eventKey: ev.event_key, value: ev.event_name === "Purchase" ? Number(ev.value ?? lead.value) : null,
        currency: "BRL", at: new Date(ev.created_at), // valores do CRM são em reais; hora da venda/lead, não do envio
        lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
        origin: origin ? { source_type: origin.source_type, ctwa_clid: origin.ctwa_clid, fbclid: origin.fbclid, clickAt: (Array.isArray(click) ? click[0]?.created_at : click?.created_at) ?? null } : null,
        wabaId: cc.waba, pageId: cc.conn.page_id,
      });
      await graph(`${cc.conn.pixel_id}/events`, cc.cred, { method: "POST", body: { data: [event], partner_agent: "nexocrm" } });
      await db.from("meta_events").update({ status: "sent", sent_at: new Date().toISOString(), mode, error: null, attempts: ev.attempts + 1 }).eq("id", ev.id);
      sent++;
    } catch (e) {
      const attempts = ev.attempts + 1;
      // Espera crescente entre tentativas: 2, 4, 8, 16… min (até 8 tentativas, ~8h)
      const next = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
      await db.from("meta_events").update({ status: attempts >= 8 ? "failed" : "pending", attempts, next_attempt_at: next, error: (e as Error).message.slice(0, 500) }).eq("id", ev.id);
    }
  }
  return sent;
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Code2, Copy, ExternalLink, Link2, Megaphone, MousePointerClick, Pencil, Plus, Target, Trash2, TrendingUp, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { cn, formatBRL, relativeTime } from "@/lib/utils";
import { MetaTab } from "./meta-tab";
import { CHANNELS, LINK_TEMPLATES, NOT_TRACKED, trackedUrl, type Channel } from "@/lib/tracking/shared";

interface Row { key: string; label: string; color?: string; clicks: number; leads: number; sales: number; revenue: number }
interface Report {
  totals: { clicks: number; leads: number; tracked: number; sales: number; revenue: number };
  daily: { day: string; leads: number; sales: number; revenue: number }[];
  byChannel: Row[]; byCampaign: Row[]; byCreative: Row[]; byLink: Row[];
  recent: { id: string; name: string; created_at: string; value: number; won: boolean; channel: string | null; campaign: string | null; creative: string | null }[];
}
interface TLink { id: string; slug: string; name: string; kind: "link" | "site"; channel_id: string | null; phone: string | null; message: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; created_at: string }

const TABS = [
  { id: "meta", label: "Anúncios Meta", icon: Megaphone },
  { id: "painel", label: "Todas as origens", icon: BarChart3 },
  { id: "links", label: "Links rastreados", icon: Link2 },
  { id: "site", label: "Site", icon: Code2 },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PERIODS = [
  { id: "7", label: "7 dias" }, { id: "30", label: "30 dias" }, { id: "90", label: "90 dias" }, { id: "mes", label: "Este mês" }, { id: "mes_passado", label: "Mês passado" },
] as const;

function range(p: string): { from: Date; to: Date } {
  const now = new Date();
  if (p === "mes") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getTime() + 60_000) };
  if (p === "mes_passado") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
  const days = Number(p);
  const from = new Date(now); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - days + 1);
  return { from, to: new Date(now.getTime() + 60_000) };
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");
const chLabel = (k: string | null) => (k && k in CHANNELS ? CHANNELS[k as Channel] : NOT_TRACKED);

export function CampaignsPage({ embedded }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<TabId>("meta");
  return (
    <div className={embedded ? "" : "h-full overflow-y-auto"}>
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200"><Target className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Campanhas</h2>
            <p className="text-sm text-slate-400">Saiba qual anúncio, link ou post trouxe cada lead e cada venda — e onde vale investir mais.</p>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
          {TABS.map(({ id, label, icon: I }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", tab === id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {tab === "painel" && <Dashboard />}
        {tab === "links" && <LinksTab />}
        {tab === "site" && <SiteTab />}
        {tab === "meta" && <MetaTab />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Painel
// ------------------------------------------------------------------------------------------------

function Dashboard() {
  const [period, setPeriod] = useState("30");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"camp" | "cre" | "link">("camp");

  const load = useCallback(async (p: string) => {
    setLoading(true);
    const { from, to } = range(p);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const res = await fetch(`/api/tracking/report?${qs}`);
    const body = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(body.error); return; }
    setData(body);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(period), 0); return () => clearTimeout(t); }, [load, period]);

  const t = data?.totals;
  const rows = data ? (view === "camp" ? data.byCampaign : view === "cre" ? data.byCreative : data.byLink) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)} className={cn("rounded-full border px-3 py-1 text-xs", period === p.id ? "border-brand-400/50 bg-brand-500/15 text-brand-100" : "border-line text-slate-400 hover:text-slate-200")}>{p.label}</button>
        ))}
        {loading && <Spinner className="ml-2 h-4 w-4" />}
      </div>

      {!data ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi icon={MousePointerClick} label="Cliques nos links" value={t!.clicks.toLocaleString("pt-BR")} />
            <Kpi icon={Users} label="Leads" value={t!.leads.toLocaleString("pt-BR")} sub={`${pct(t!.tracked, t!.leads)} rastreados`} />
            <Kpi icon={TrendingUp} label="Vendas" value={t!.sales.toLocaleString("pt-BR")} sub={`conversão ${pct(t!.sales, t!.leads)}`} />
            <Kpi icon={Wallet} label="Faturamento" value={formatBRL(t!.revenue)} />
            <Kpi icon={Target} label="Ticket médio" value={t!.sales ? formatBRL(t!.revenue / t!.sales) : "—"} />
            <Kpi icon={Megaphone} label="Ver ROAS por anúncio" value="→" sub="aba Anúncios Meta" muted />
          </div>

          <section className="rounded-xl border border-line bg-ink-900 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Leads e vendas por dia</h3>
            <DailyChart days={data.daily} />
          </section>

          <section className="rounded-xl border border-line bg-ink-900 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">De onde vêm os leads e as vendas</h3>
            <ChannelBars rows={data.byChannel} total={t!.leads} />
          </section>

          <section className="rounded-xl border border-line bg-ink-900">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <h3 className="mr-auto text-sm font-semibold text-white">Ranking</h3>
              {([["camp", "Campanhas"], ["cre", "Criativos / anúncios"], ["link", "Links"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} className={cn("rounded-md px-2.5 py-1 text-xs", view === k ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>{l}</button>
              ))}
            </div>
            <RankTable rows={rows} />
          </section>

          <section className="rounded-xl border border-line bg-ink-900">
            <h3 className="border-b border-line p-3 text-sm font-semibold text-white">Leads do período</h3>
            {!data.recent.length ? <p className="p-4 text-sm text-slate-500">Nenhum lead no período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="px-3 py-2 font-medium">Lead</th><th className="px-3 py-2 font-medium">Origem</th><th className="px-3 py-2 font-medium">Campanha</th><th className="px-3 py-2 font-medium">Criativo</th><th className="px-3 py-2 text-right font-medium">Valor</th><th className="px-3 py-2 text-right font-medium">Quando</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {data.recent.map((l) => {
                      const c = chLabel(l.channel);
                      return (
                        <tr key={l.id} className="text-slate-300">
                          <td className="px-3 py-2"><span className="text-slate-100">{l.name}</span>{l.won && <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">venda</span>}</td>
                          <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}</span></td>
                          <td className="max-w-[200px] truncate px-3 py-2">{l.campaign ?? "—"}</td>
                          <td className="max-w-[200px] truncate px-3 py-2">{l.creative ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{l.value ? formatBRL(l.value) : "—"}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-500">{relativeTime(l.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: I, label, value, sub, muted }: { icon: typeof Users; label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-line bg-ink-900 p-3", muted && "opacity-60")}>
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><I className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-white">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function DailyChart({ days }: { days: Report["daily"] }) {
  const max = Math.max(1, ...days.map((d) => d.leads));
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? days[hover] : null;
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]">
        {days.map((d, i) => (
          <div key={d.day} className="relative flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="w-full rounded-t-sm bg-brand-500/60" style={{ height: `${(d.leads / max) * 100}%` }} />
            {d.sales > 0 && <div className="absolute bottom-0 w-full rounded-t-sm bg-emerald-400" style={{ height: `${(Math.min(d.sales, d.leads || d.sales) / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand-500/60" /> Leads</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> Vendas</span>
        <span className="ml-auto text-slate-400">{h ? `${h.day.split("-").reverse().join("/")}: ${h.leads} leads · ${h.sales} vendas · ${formatBRL(h.revenue)}` : `${days[0]?.day.split("-").reverse().join("/") ?? ""} → ${days[days.length - 1]?.day.split("-").reverse().join("/") ?? ""}`}</span>
      </div>
    </div>
  );
}

function ChannelBars({ rows, total }: { rows: Row[]; total: number }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Sem leads no período.</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[180px_1fr_auto]">
          <span className="flex items-center gap-2 truncate text-slate-200"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />{r.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full" style={{ width: `${total ? (r.leads / total) * 100 : 0}%`, background: r.color }} /></div>
          <span className="whitespace-nowrap text-xs text-slate-400"><b className="text-slate-200">{r.leads}</b> leads · <b className="text-emerald-300">{r.sales}</b> vendas · {formatBRL(r.revenue)}</span>
        </div>
      ))}
    </div>
  );
}

function RankTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="p-4 text-sm text-slate-500">Ainda sem dados. Use os links rastreados ou anúncios de clique para o WhatsApp.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 text-right font-medium">Cliques</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">Vendas</th><th className="px-3 py-2 text-right font-medium">Conversão</th><th className="px-3 py-2 text-right font-medium">Faturamento</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key} className="text-slate-300">
              <td className="max-w-[320px] truncate px-3 py-2 text-slate-100" title={r.label}>{r.label}</td>
              <td className="px-3 py-2 text-right">{r.clicks || "—"}</td>
              <td className="px-3 py-2 text-right">{r.leads}</td>
              <td className="px-3 py-2 text-right text-emerald-300">{r.sales}</td>
              <td className="px-3 py-2 text-right">{pct(r.sales, r.leads)}</td>
              <td className="px-3 py-2 text-right font-medium text-white">{formatBRL(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Links rastreados
// ------------------------------------------------------------------------------------------------

function useLinks() {
  const [links, setLinks] = useState<TLink[] | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/tracking/links");
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setLinks(data.links);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  return { links, load };
}

const copy = (text: string, msg = "Link copiado") => void navigator.clipboard.writeText(text).then(() => toast.success(msg));
const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

function LinksTab() {
  const { links, load } = useLinks();
  const [edit, setEdit] = useState<TLink | "new" | null>(null);
  const list = (links ?? []).filter((l) => l.kind === "link");

  async function remove(l: TLink) {
    if (!confirm(`Desativar o link "${l.name}"? Quem clicar não será mais levado ao WhatsApp. Os dados continuam no painel.`)) return;
    const res = await fetch(`/api/tracking/links/${l.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-900 p-4 text-sm text-slate-300">
        <p className="min-w-0 flex-1">Cada clique gera um <b className="text-white">protocolo</b> que vai junto na mensagem do WhatsApp. Quando o cliente envia, o CRM liga o lead à campanha, ao criativo e ao link — e depois à venda.</p>
        <Button onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Novo link</Button>
      </div>
      {links === null ? <div className="flex justify-center py-10"><Spinner /></div> : !list.length ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-slate-500">Nenhum link ainda. Crie o da bio do Instagram para começar.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((l) => {
            const url = trackedUrl(origin(), l.slug, { utm_source: l.utm_source, utm_medium: l.utm_medium, utm_campaign: l.utm_campaign, utm_content: l.utm_content, utm_term: l.utm_term });
            return (
              <li key={l.id} className="rounded-xl border border-line bg-ink-900 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link2 className="h-4 w-4 text-brand-300" />
                  <b className="text-slate-100">{l.name}</b>
                  <span className="text-xs text-slate-500">criado {relativeTime(l.created_at)}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copy(url)}><Copy className="h-3.5 w-3.5" /> Copiar link</Button>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800 hover:text-slate-100" title="Testar link"><ExternalLink className="h-4 w-4" /></a>
                    <button onClick={() => setEdit(l)} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800 hover:text-slate-100" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => void remove(l)} className="rounded-md p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Desativar"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="mt-1.5 break-all rounded-md bg-ink-850 px-2 py-1 font-mono text-[11px] text-slate-400">{url}</p>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <LinkModal link={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function LinkModal({ link, onClose, onSaved }: { link: TLink | null; onClose: () => void; onSaved: () => void }) {
  const ws = useWorkspace();
  const [channels, setChannels] = useState<{ id: string; name: string; phone_number: string | null }[]>([]);
  const [tpl, setTpl] = useState(link ? "livre" : "bio");
  const [f, setF] = useState({
    name: link?.name ?? "Bio do Instagram", channel_id: link?.channel_id ?? "", message: link?.message ?? "Olá! Vim pelo Instagram e gostaria de mais informações.",
    utm_source: link?.utm_source ?? "instagram", utm_medium: link?.utm_medium ?? "bio", utm_campaign: link?.utm_campaign ?? "bio", utm_content: link?.utm_content ?? "", utm_term: link?.utm_term ?? "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabaseBrowser().from("whatsapp_channels").select("id, name, phone_number").eq("organization_id", ws.orgId).order("created_at")
      .then(({ data }) => setChannels(data ?? []));
  }, [ws.orgId]);

  function applyTpl(id: string) {
    setTpl(id);
    const t = LINK_TEMPLATES.find((x) => x.id === id)!;
    if (id === "livre") return;
    setF((cur) => ({ ...cur, name: link ? cur.name : t.label, utm_source: t.utm.utm_source ?? "", utm_medium: t.utm.utm_medium ?? "", utm_campaign: t.utm.utm_campaign ?? "", utm_content: t.utm.utm_content ?? "", utm_term: t.utm.utm_term ?? "" }));
  }

  async function save() {
    setBusy(true);
    try {
      const body = { ...f, channel_id: f.channel_id || null, kind: "link" };
      const res = await fetch(link ? `/api/tracking/links/${link.id}` : "/api/tracking/links", { method: link ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (!link) {
        const l = data.link as TLink;
        copy(trackedUrl(origin(), l.slug, { utm_source: l.utm_source, utm_medium: l.utm_medium, utm_campaign: l.utm_campaign, utm_content: l.utm_content, utm_term: l.utm_term }), "Link criado e copiado");
      } else toast.success("Link salvo");
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const hint = LINK_TEMPLATES.find((x) => x.id === tpl)?.hint;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} title={link ? "Editar link" : "Novo link rastreado"} footer={<Button onClick={save} loading={busy} disabled={!f.name.trim()}>{link ? "Salvar" : "Criar e copiar"}</Button>}>
      <div className="space-y-3 text-sm" data-modal-body>
        <Field label="Onde você vai usar">
          <select className="field" value={tpl} onChange={(e) => applyTpl(e.target.value)}>
            {LINK_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        {hint && <p className="-mt-1 text-xs text-slate-500">{hint}</p>}
        <Field label="Nome do link"><input className="field" maxLength={80} value={f.name} onChange={set("name")} /></Field>
        <Field label="Número de WhatsApp">
          <select className="field" value={f.channel_id} onChange={set("channel_id")}>
            <option value="">Primeiro número conectado</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Mensagem que o cliente já recebe escrita" hint="O protocolo é adicionado no final automaticamente.">
          <textarea className="field min-h-[70px]" maxLength={1000} value={f.message} onChange={set("message")} />
        </Field>
        <details className="rounded-lg border border-line p-3" open={tpl === "livre"}>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-400">UTMs (origem, campanha, criativo)</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="utm_source (origem)"><input className="field" maxLength={200} value={f.utm_source} onChange={set("utm_source")} placeholder="instagram" /></Field>
            <Field label="utm_medium (meio)"><input className="field" maxLength={200} value={f.utm_medium} onChange={set("utm_medium")} placeholder="bio, paid, stories" /></Field>
            <Field label="utm_campaign (campanha)"><input className="field" maxLength={200} value={f.utm_campaign} onChange={set("utm_campaign")} placeholder="black-friday" /></Field>
            <Field label="utm_content (criativo)"><input className="field" maxLength={200} value={f.utm_content} onChange={set("utm_content")} placeholder="video-mt03" /></Field>
            <Field label="utm_term (público)"><input className="field" maxLength={200} value={f.utm_term} onChange={set("utm_term")} /></Field>
          </div>
        </details>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------
// Site
// ------------------------------------------------------------------------------------------------

function SiteTab() {
  const { links, load } = useLinks();
  const [busy, setBusy] = useState(false);
  const site = useMemo(() => (links ?? []).find((l) => l.kind === "site") ?? null, [links]);
  const snippet = site ? `<script src="${origin()}/api/t/${site.slug}" async></script>` : "";

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/tracking/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Site", kind: "site", message: "Olá! Vim pelo site e gostaria de mais informações." }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  if (links === null) return <div className="flex justify-center py-10"><Spinner /></div>;
  return (
    <div className="space-y-4 rounded-xl border border-line bg-ink-900 p-4 text-sm text-slate-300">
      <h3 className="font-semibold text-white">Rastreio no site / página de vendas</h3>
      <p>Um código só, colado no site: ele guarda de onde o visitante veio (UTMs do anúncio, fbclid, gclid, Google, Instagram) e transforma <b className="text-white">todos os botões de WhatsApp</b> do site em links rastreados. O lead chega no CRM já com a campanha e o criativo.</p>
      {!site ? <Button onClick={create} loading={busy}><Plus className="h-4 w-4" /> Gerar código do site</Button> : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-slate-400">
            <li>Copie o código abaixo.</li>
            <li>Cole no seu site antes de <code className="text-slate-300">&lt;/body&gt;</code> (WordPress: plugin “Insert Headers and Footers”; Elementor, Wix e Hotmart Pages têm o campo “código personalizado”).</li>
            <li>Pronto: os botões que apontam para wa.me ou api.whatsapp.com passam a ser rastreados.</li>
          </ol>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200">{snippet}</code>
            <Button variant="secondary" onClick={() => copy(snippet, "Código copiado")}><Copy className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-slate-500">Botão feito sem link (só JavaScript)? Chame <code className="text-slate-300">nexoWhatsApp(&quot;5585999990000&quot;, &quot;Olá!&quot;)</code> no clique.</p>
        </>
      )}
    </div>
  );
}

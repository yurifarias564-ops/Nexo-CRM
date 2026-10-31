"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowDownRight, ArrowUpRight, BarChart3, Minus, RefreshCw, Target } from "lucide-react";
import { CampaignsPage } from "@/components/campaigns/campaigns-page";
import { UnansweredTile } from "./unanswered";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Empty, Spinner } from "@/components/ui/misc";
import { cn, formatBRL } from "@/lib/utils";

// Paleta validada (dark, superfície #0a1020): passa nas 5 checagens, incl. daltonismo.
const C_IN = "#3b82f6";
const C_OUT = "#d97706";
const C_BAR = "#3b82f6";

type Stats = {
  new_leads: number;
  open_count: number;
  open_value: number;
  won_count: number;
  won_value: number;
  lost_count: number;
  by_stage: { id: string; name: string; color: string; kind: string; pipeline: string; count: number; value: number }[];
  by_source: { name: string; count: number }[];
  by_tag: { name: string; color: string; count: number }[];
  by_owner: { user_id: string | null; won_count: number; won_value: number; lost_count?: number; new_leads?: number; open_value?: number }[];
  messages: { day: string; in: number; out: number }[];
};

const PERIODS = [
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "90", label: "90 dias" },
  { id: "month", label: "Este mês" },
  { id: "last", label: "Mês passado" },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

function range(p: PeriodId): [Date, Date] {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const to = new Date(end.getTime() + 1);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (p === "month") from.setDate(1);
  else if (p === "last") {
    from.setDate(1); from.setMonth(from.getMonth() - 1);
    const end2 = new Date(from); end2.setMonth(end2.getMonth() + 1);
    return [from, end2];
  } else from.setDate(from.getDate() - (Number(p) - 1));
  return [from, to];
}

/** Este mês até hoje × mesmo trecho do mês passado (do dia 1 até o mesmo dia) × mês passado inteiro. */
function monthRanges(): { cur: [Date, Date]; prevSame: [Date, Date]; prevFull: [Date, Date] } {
  const now = new Date();
  const curFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const curTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevFullTo = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const prevSameTo = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastDayPrev) + 1);
  return { cur: [curFrom, curTo], prevSame: [prevFrom, prevSameTo], prevFull: [prevFrom, prevFullTo] };
}
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

const compactBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: v >= 100000 ? "compact" : "standard", maximumFractionDigits: v >= 100000 ? 1 : 0 }).format(v);

export function Dashboard() {
  const [view, setView] = useState<"vendas" | "campanhas">("vendas");
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem("nexo:painel-view"); } catch { /* ok */ }
    const t = setTimeout(() => { if (v === "campanhas") setView("campanhas"); }, 0);
    return () => clearTimeout(t);
  }, []);
  const pick = (v: "vendas" | "campanhas") => { setView(v); try { localStorage.setItem("nexo:painel-view", v); } catch { /* ok */ } };
  const switcher = (
    <div className="flex rounded-lg border border-line bg-ink-900 p-1" role="tablist" aria-label="O que ver no painel">
      {([["vendas", "Métricas de vendas", BarChart3], ["campanhas", "Campanhas", Target]] as const).map(([id, label, I]) => (
        <button key={id} role="tab" aria-selected={view === id} onClick={() => pick(id)}
          className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", view === id ? "bg-brand-500/20 text-white" : "text-slate-400 hover:text-slate-200")}>
          <I className="h-4 w-4" /> {label}
        </button>
      ))}
    </div>
  );
  if (view === "campanhas") return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-7xl px-4 pt-4 md:px-6">{switcher}</div><CampaignsPage embedded /></div>;
  return <SalesDashboard switcher={switcher} />;
}

function SalesDashboard({ switcher }: { switcher: React.ReactNode }) {
  const ws = useWorkspace();
  const [period, setPeriod] = useState<PeriodId>("30");
  const [seller, setSeller] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [cmp, setCmp] = useState<{ cur: Stats; prevSame: Stats; prevFull: Stats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: PeriodId, who: string) => {
    setLoading(true);
    const sb = supabaseBrowser();
    const call = ([from, to]: [Date, Date]) => sb.rpc("dashboard_stats", {
      org: ws.orgId, p_from: from.toISOString(), p_to: to.toISOString(), p_tz: tz(), p_seller: who || null,
    });
    const m = monthRanges();
    const [main, c1, c2, c3] = await Promise.all([call(range(p)), call(m.cur), call(m.prevSame), call(m.prevFull)]);
    setLoading(false);
    if (main.error) { setError("Não foi possível carregar as métricas."); return; }
    setError(null);
    setStats(main.data as Stats);
    setCmp(c1.error || c2.error || c3.error ? null : { cur: c1.data as Stats, prevSame: c2.data as Stats, prevFull: c3.data as Stats });
  }, [ws.orgId]);

  useEffect(() => {
    const t = setTimeout(() => void load(period, seller), 0);
    return () => clearTimeout(t);
  }, [load, period, seller]);
  const sellerName = (id: string | null) => { const m = id ? ws.memberById.get(id) : null; return m?.full_name ?? m?.email ?? "Sem responsável"; };

  const conversion = stats && stats.won_count + stats.lost_count > 0
    ? Math.round((stats.won_count / (stats.won_count + stats.lost_count)) * 100) : null;
  const msgIn = stats?.messages.reduce((s, d) => s + d.in, 0) ?? 0;
  const msgOut = stats?.messages.reduce((s, d) => s + d.out, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {switcher}
          <div className="flex rounded-lg border border-line bg-ink-900 p-1" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button key={p.id} role="tab" aria-selected={period === p.id} onClick={() => setPeriod(p.id)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", period === p.id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
                {p.label}
              </button>
            ))}
          </div>
          <select className="field h-9 w-auto text-sm" value={seller} onChange={(e) => setSeller(e.target.value)} aria-label="Vendedor">
            <option value="">Todos os vendedores (geral)</option>
            {ws.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => load(period, seller)} loading={loading} aria-label="Atualizar">
            {!loading && <RefreshCw className="h-3.5 w-3.5" />} Atualizar
          </Button>
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        {!stats ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Indicadores">
              <UnansweredTile seller={seller} />
              <Tile label="Leads novos" value={stats.new_leads.toLocaleString("pt-BR")} sub="no período" />
              <Tile label="Em andamento" value={compactBRL(Number(stats.open_value))} sub={`${stats.open_count.toLocaleString("pt-BR")} leads abertos`} />
              <Tile label="Vendas ganhas" value={compactBRL(Number(stats.won_value))} sub={`${stats.won_count} fechamentos no período`} accent />
              <Tile label="Conversão" value={conversion === null ? "—" : `${conversion}%`} sub={`${stats.won_count} ganhos · ${stats.lost_count} perdidos`} />
              <Tile label="Mensagens" value={(msgIn + msgOut).toLocaleString("pt-BR")}
                sub={<span className="inline-flex gap-3"><span className="inline-flex items-center gap-1"><ArrowDownLeft className="h-3 w-3" />{msgIn.toLocaleString("pt-BR")}</span><span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />{msgOut.toLocaleString("pt-BR")}</span></span>} />
            </section>

            {cmp && <MonthCompare cmp={cmp} who={seller ? sellerName(seller) : "Todos os vendedores"} />}

            <div className="grid gap-4 lg:grid-cols-5">
              <Card title="Funil por etapa" className="lg:col-span-3" hint="Leads em cada etapa agora">
                <HBars rows={stats.by_stage.map((s) => ({
                  key: s.id, label: ws.pipelines.length > 1 ? `${s.name} · ${s.pipeline}` : s.name, value: s.count,
                  detail: `${s.count.toLocaleString("pt-BR")} leads · ${formatBRL(Number(s.value))}`, dot: s.color,
                }))} empty="Nenhuma etapa configurada" />
              </Card>
              <Card title="Origem dos leads" className="lg:col-span-2" hint="Leads novos no período">
                <HBars rows={stats.by_source.map((s) => ({ key: s.name, label: s.name, value: s.count, detail: `${s.count.toLocaleString("pt-BR")} leads` }))} empty="Sem leads novos no período" />
              </Card>
            </div>

            <Card title="Mensagens por dia" hint="Recebidas e enviadas no WhatsApp">
              <Columns data={stats.messages} />
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Tags mais usadas" hint="Entre os leads novos do período">
                <HBars rows={stats.by_tag.map((t) => ({ key: t.name, label: t.name, value: t.count, detail: `${t.count} leads`, dot: t.color }))} empty="Nenhuma tag nos leads novos" />
              </Card>
              <Card title="Resultado por vendedor" hint="No período · clique para ver só os dados dele">
                {stats.by_owner.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr><th className="pb-2 font-medium">Vendedor</th><th className="pb-2 text-right font-medium">Leads</th><th className="pb-2 text-right font-medium">Vendas</th><th className="pb-2 text-right font-medium">Valor</th></tr>
                    </thead>
                    <tbody>
                      {stats.by_owner.map((o) => {
                        return (
                          <tr key={o.user_id ?? "none"} className={cn("border-t border-line/60", o.user_id && "cursor-pointer hover:bg-white/[.03]")}
                            onClick={() => o.user_id && setSeller(o.user_id)} title={o.user_id ? "Ver só este vendedor" : undefined}>
                            <td className="py-2 text-slate-200">{sellerName(o.user_id)}</td>
                            <td className="py-2 text-right tabular-nums text-slate-300">{o.new_leads ?? "—"}</td>
                            <td className="py-2 text-right tabular-nums text-slate-300">{o.won_count}</td>
                            <td className="py-2 text-right tabular-nums text-slate-100">{formatBRL(Number(o.won_value))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <Empty icon={<BarChart3 className="h-5 w-5" />} title="Nenhum resultado no período" text="Leads novos e vendas ganhas de cada vendedor aparecem aqui." />}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Cmp = { cur: Stats; prevSame: Stats; prevFull: Stats };

function MonthCompare({ cmp, who }: { cmp: Cmp; who: string }) {
  const now = new Date();
  const mName = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long" });
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const conv = (s: Stats) => (s.won_count + s.lost_count ? Math.round((s.won_count / (s.won_count + s.lost_count)) * 100) : null);
  const rows: { label: string; cur: number | null; same: number | null; full: number | null; fmt: (v: number) => string }[] = [
    { label: "Leads novos", cur: cmp.cur.new_leads, same: cmp.prevSame.new_leads, full: cmp.prevFull.new_leads, fmt: (v) => v.toLocaleString("pt-BR") },
    { label: "Vendas (qtd.)", cur: cmp.cur.won_count, same: cmp.prevSame.won_count, full: cmp.prevFull.won_count, fmt: (v) => v.toLocaleString("pt-BR") },
    { label: "Vendas (R$)", cur: Number(cmp.cur.won_value), same: Number(cmp.prevSame.won_value), full: Number(cmp.prevFull.won_value), fmt: (v) => formatBRL(v) },
    { label: "Conversão", cur: conv(cmp.cur), same: conv(cmp.prevSame), full: conv(cmp.prevFull), fmt: (v) => `${v}%` },
  ];
  return (
    <Card title={`${mName(now)[0]!.toUpperCase()}${mName(now).slice(1)} × ${mName(prev)}`} hint={`${who} · comparação justa: do dia 1 até hoje nos dois meses`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 font-medium">Indicador</th>
              <th className="pb-2 text-right font-medium">Este mês (até hoje)</th>
              <th className="pb-2 text-right font-medium">Mês passado (até o mesmo dia)</th>
              <th className="pb-2 text-right font-medium">Variação</th>
              <th className="pb-2 text-right font-medium">Mês passado inteiro</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line/60">
                <td className="py-2 text-slate-300">{r.label}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-white">{r.cur === null ? "—" : r.fmt(r.cur)}</td>
                <td className="py-2 text-right tabular-nums text-slate-300">{r.same === null ? "—" : r.fmt(r.same)}</td>
                <td className="py-2 text-right"><Delta cur={r.cur} prev={r.same} points={r.label === "Conversão"} /></td>
                <td className="py-2 text-right tabular-nums text-slate-500">{r.full === null ? "—" : r.fmt(r.full)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Delta({ cur, prev, points }: { cur: number | null; prev: number | null; points?: boolean }) {
  if (cur === null || prev === null) return <span className="text-xs text-slate-500">—</span>;
  const diff = cur - prev;
  if (diff === 0) return <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Minus className="h-3 w-3" /> igual</span>;
  const up = diff > 0;
  const label = points ? `${up ? "+" : ""}${diff} p.p.` : prev === 0 ? (up ? "novo" : "—") : `${up ? "+" : ""}${Math.round((diff / prev) * 100)}%`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", up ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300")}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />} {label}
    </span>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={cn("card p-4", accent && "border-brand-400/30 bg-gradient-to-br from-brand-500/10 to-transparent")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Card({ title, hint, className, children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("card p-5", className)}>
      <h2 className="font-semibold text-white">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

type Row = { key: string; label: string; value: number; detail: string; dot?: string };

/** Barras horizontais de cor única (magnitude), com rótulo direto do valor. */
function HBars({ rows, empty }: { rows: Row[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md" title={`${r.label}: ${r.detail}`}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-300">
            {r.dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.dot }} aria-hidden />}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="h-3 rounded-r-[4px] bg-ink-800" aria-hidden>
            <span className="block h-full rounded-r-[4px] transition-[width] duration-500 group-hover:brightness-125"
              style={{ width: `${r.value === 0 ? 0 : Math.max(2, (r.value / max) * 100)}%`, background: C_BAR }} />
          </span>
          <span className="text-right text-xs tabular-nums text-slate-400">{r.value.toLocaleString("pt-BR")}</span>
        </li>
      ))}
    </ul>
  );
}

/** Colunas agrupadas (recebidas × enviadas) com dica ao passar o mouse e tabela acessível. */
function Columns({ data }: { data: Stats["messages"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...data.flatMap((d) => [d.in, d.out])), [data]);
  const total = data.reduce((s, d) => s + d.in + d.out, 0);
  const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const labelEvery = Math.ceil(data.length / 10);
  const ticks = [max, Math.round(max / 2), 0];

  if (!total) return <p className="py-10 text-center text-sm text-slate-500">Nenhuma mensagem no período.</p>;
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-400" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_IN }} /> Recebidas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_OUT }} /> Enviadas</span>
      </div>
      <div className="relative flex gap-2">
        <div className="flex h-48 flex-col justify-between py-0 text-right text-[10px] tabular-nums text-slate-600" aria-hidden>
          {ticks.map((t, i) => <span key={i}>{t.toLocaleString("pt-BR")}</span>)}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-0 flex h-48 flex-col justify-between" aria-hidden>
            {ticks.map((_, i) => <div key={i} className="border-t border-line/70" />)}
          </div>
          <div className="relative z-[1] flex h-48 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img"
            aria-label={`Mensagens por dia: ${data.reduce((s, d) => s + d.in, 0)} recebidas e ${data.reduce((s, d) => s + d.out, 0)} enviadas`}>
            {data.map((d, i) => (
              <div key={d.day} className={cn("flex h-full flex-1 items-end justify-center gap-[2px] rounded-sm", hover === i && "bg-white/[.03]")}
                onMouseEnter={() => setHover(i)}>
                <span className="w-full max-w-[14px] rounded-t-[4px]" style={{ height: `${(d.in / max) * 100}%`, background: C_IN }} />
                <span className="w-full max-w-[14px] rounded-t-[4px]" style={{ height: `${(d.out / max) * 100}%`, background: C_OUT }} />
              </div>
            ))}
          </div>
          {h && hover !== null && (
            <div className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-lg border border-line bg-ink-800 px-3 py-2 text-xs shadow-card"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}>
              <p className="font-medium text-white">{fmtDay(h.day)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-slate-300"><span className="h-2 w-2 rounded-sm" style={{ background: C_IN }} /> Recebidas <b className="ml-auto pl-3 tabular-nums text-white">{h.in}</b></p>
              <p className="flex items-center gap-1.5 text-slate-300"><span className="h-2 w-2 rounded-sm" style={{ background: C_OUT }} /> Enviadas <b className="ml-auto pl-3 tabular-nums text-white">{h.out}</b></p>
            </div>
          )}
          <div className="mt-2 flex gap-[2px] text-[10px] text-slate-600" aria-hidden>
            {data.map((d, i) => <span key={d.day} className="flex-1 text-center">{i % labelEvery === 0 ? fmtDay(d.day) : ""}</span>)}
          </div>
        </div>
      </div>
      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300">Ver tabela</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead><tr className="text-left"><th className="py-1 font-medium">Dia</th><th className="py-1 text-right font-medium">Recebidas</th><th className="py-1 text-right font-medium">Enviadas</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.day} className="border-t border-line/50 text-slate-300"><td className="py-1">{fmtDay(d.day)}</td><td className="py-1 text-right tabular-nums">{d.in}</td><td className="py-1 text-right tabular-nums">{d.out}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

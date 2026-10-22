"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Copy, Download, Medal } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace";
import { Avatar, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addDays, conv, dayGoalItems, delta, filledDays, fmtBRL, fmtDayFull, fmtValue, goalFor, metricApplies, pct, periodAt, periodList, periodScore,
  resultsOf, ROLE_LABEL, todayIn, totals, weekdaysBetween, type Period, type TeamMetric, type TeamNote, type TeamSale, type TeamValue,
} from "@/lib/team";
import { browserTz, fetchNotes, fetchSales, fetchValues, type TeamBase } from "./data";

type Sub = "resumo" | "dia" | "notas" | "comparar";

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[11px] text-slate-500">novo</span>;
  if (v === 0) return <span className="text-[11px] text-slate-500">=</span>;
  const up = v > 0;
  return (
    <span className={cn("inline-flex items-center text-[11px] font-medium", up ? "text-emerald-300" : "text-red-300")}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(v).toLocaleString("pt-BR")}%
    </span>
  );
}
function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
      <div className={cn("h-full rounded-full", value >= 100 ? "bg-emerald-400" : value >= 70 ? "bg-amber-400" : "bg-brand-400")} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
        <h3 className="font-semibold text-white">{title}</h3>{extra}
      </div>
      {children}
    </div>
  );
}

export function TeamBoard({ base }: { base: TeamBase }) {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const [today] = useState(() => todayIn(browserTz()));
  const periods = useMemo(() => periodList(today, base.settings.cycle_start, 18), [today, base.settings.cycle_start]);
  const [pIdx, setPIdx] = useState(0);
  const period = periods[pIdx] ?? periods[0]!;
  const [sub, setSub] = useState<Sub>("resumo");
  const isCurrent = pIdx === 0;
  // Anterior com o mesmo número de dias quando o período ainda está em andamento
  const prev = useMemo(() => periodAt(period.from, base.settings.cycle_start, -1), [period, base.settings.cycle_start]);
  const elapsed = isCurrent ? Math.round((Date.parse(today) - Date.parse(period.from)) / 86_400_000) : null;
  const prevTo = elapsed !== null ? [addDays(prev.from, elapsed), prev.to].sort()[0]! : prev.to;

  const [data, setData] = useState<{ key: string; cur: TeamValue[]; prev: TeamValue[]; sales: TeamSale[]; notes: TeamNote[] } | null>(null);
  const key = `${period.key}`;
  useEffect(() => {
    let alive = true;
    const to = period.to > today ? today : period.to;
    Promise.all([fetchValues(ws.orgId, period.from, to, tz), fetchValues(ws.orgId, prev.from, prevTo, tz), fetchSales(ws.orgId, period.from, to), fetchNotes(ws.orgId, period.from, to)])
      .then(([cur, pv, sales, notes]) => { if (alive) setData({ key, cur, prev: pv, sales, notes }); })
      .catch(() => toast.error("Não foi possível carregar o painel"));
    return () => { alive = false; };
  }, [ws.orgId, period, prev.from, prevTo, today, tz, key]);

  const subs: { id: Sub; label: string }[] = [
    { id: "resumo", label: "Resumo" }, { id: "dia", label: "Atividade do dia" }, { id: "notas", label: "Observações" }, { id: "comparar", label: "Antes x depois" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-900 p-1">
          <button type="button" onClick={() => setPIdx((i) => Math.min(periods.length - 1, i + 1))} disabled={pIdx >= periods.length - 1} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white disabled:opacity-30" aria-label="Período anterior"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[190px] text-center text-sm font-medium text-white">{period.label}</span>
          <button type="button" onClick={() => setPIdx((i) => Math.max(0, i - 1))} disabled={pIdx === 0} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white disabled:opacity-30" aria-label="Próximo período"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-ink-900 p-1 text-xs">
            {subs.map((s) => (
              <button key={s.id} type="button" onClick={() => setSub(s.id)} className={cn("whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium", sub === s.id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>{s.label}</button>
            ))}
          </div>
          <a href={`/api/team/export?from=${period.from}&to=${period.to}&pfrom=${prev.from}&pto=${prevTo}&label=${encodeURIComponent(period.label)}&tz=${encodeURIComponent(tz)}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-200 hover:border-brand-400/40 hover:bg-ink-800"><Download className="h-4 w-4" /> Excel</a>
        </div>
      </div>

      {data?.key !== key ? <div className="card flex h-48 items-center justify-center"><Spinner /></div>
        : sub === "resumo" ? <Summary base={base} period={period} today={today} isCurrent={isCurrent} cur={data.cur} prev={data.prev} sales={data.sales} prevLabel={`${prev.short}${elapsed !== null ? ` (mesmos ${elapsed + 1} dias)` : ""}`} />
          : sub === "dia" ? <DayActivity base={base} period={period} today={today} />
            : sub === "notas" ? <NotesView base={base} notes={data.notes} period={period} today={today} />
              : <Compare base={base} period={period} cur={data.cur} prev={data.prev} prevLabel={prev.label} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- Resumo

function Summary({ base, period, today, isCurrent, cur, prev, sales, prevLabel }: {
  base: TeamBase; period: Period; today: string; isCurrent: boolean; cur: TeamValue[]; prev: TeamValue[]; sales: TeamSale[]; prevLabel: string;
}) {
  const ms = base.metrics.filter((m) => m.active);
  const curT = useMemo(() => totals(cur), [cur]);
  const prevT = useMemo(() => totals(prev), [prev]);
  const people = base.sellers.filter((s) => s.active || ms.some((m) => (curT.get(`${s.id}:${m.id}`) ?? 0) > 0));
  const get = (map: Map<string, number>, sid: string, mid: string) => map.get(`${sid}:${mid}`) ?? 0;
  const teamSum = (map: Map<string, number>, m: TeamMetric) => people.reduce((a, s) => a + get(map, s.id, m.id), 0);
  const teamGoal = (m: TeamMetric) => {
    const ps = people.filter((s) => metricApplies(m, s)).map((s) => goalFor(base.goals, m, s.id).monthly);
    return ps.some((x) => x) ? ps.reduce<number>((a, x) => a + (x ?? 0), 0) : null;
  };
  const totalDays = weekdaysBetween(period.from, period.to);
  const doneDays = weekdaysBetween(period.from, isCurrent ? today : period.to);

  // Dias com meta batida por pessoa
  const atGoal = (() => {
    const out = new Map<string, number>();
    const byDay = new Map<string, Map<string, number>>();
    for (const v of cur) {
      const m = byDay.get(v.day) ?? new Map<string, number>();
      m.set(`${v.seller_id}:${v.metric_id}`, (m.get(`${v.seller_id}:${v.metric_id}`) ?? 0) + v.value);
      byDay.set(v.day, m);
    }
    for (const s of people) {
      const items = dayGoalItems(base.metrics, base.goals, s);
      if (!items.length) continue;
      let n = 0;
      for (const [, t] of byDay) if (items.every((it) => (t.get(`${s.id}:${it.m.id}`) ?? 0) >= it.goal)) n++;
      out.set(s.id, n);
    }
    return out;
  })();
  const filled = filledDays(cur, new Set(ms.filter((m) => m.source === "manual").map((m) => m.id)));

  const ranking = people.filter((s) => s.active).map((s) => {
    const store = base.stores.find((x) => x.id === s.store_id);
    return { s, store, score: periodScore(base.metrics, base.goals, s, (mid) => get(curT, s.id, mid), store?.revenue_goal ?? null) };
  }).sort((a, b) => b.score - a.score);

  const sdrs = people.filter((s) => s.role === "sdr");
  const activities = ms.filter((m) => !m.result_of && resultsOf(ms, m.id).length);

  return (
    <div className="space-y-5">
      {/* Totais */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {ms.filter((m) => !m.result_of).map((m) => {
          const total = teamSum(curT, m);
          const goal = teamGoal(m);
          const p = pct(total, goal);
          const expected = goal && isCurrent && totalDays ? (goal * doneDays) / totalDays : null;
          return (
            <div key={m.id} className="card p-4">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500" title={m.name}>{m.name}</p>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <p className="text-2xl font-semibold tabular-nums text-white">{fmtValue(total, m.unit)}</p>
                <Delta v={delta(total, teamSum(prevT, m))} />
              </div>
              {goal ? (
                <>
                  <div className="mt-2"><Bar value={p ?? 0} /></div>
                  <p className="mt-1 text-xs text-slate-400">{p?.toLocaleString("pt-BR")}% de {fmtValue(goal, m.unit)}
                    {expected !== null ? <span className={total >= expected ? "text-emerald-300" : "text-amber-300"}> · {total >= expected ? "no ritmo" : "abaixo do ritmo"}</span> : null}</p>
                </>
              ) : <p className="mt-2 text-xs text-slate-500">sem meta</p>}
            </div>
          );
        })}
      </div>
      <p className="-mt-2 text-xs text-slate-500">Variação contra {prevLabel}.</p>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Ranking */}
        <Card title="Ranking do período" extra={<span className="text-xs text-slate-500">nota = média do atingimento das metas</span>}>
          <ul className="divide-y divide-line">
            {ranking.map(({ s, store, score }, i) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cn("w-6 text-center font-mono text-sm font-bold", i === 0 ? "text-amber-300" : i === 1 ? "text-slate-300" : i === 2 ? "text-orange-400" : "text-slate-600")}>{i < 3 ? <Medal className="mx-auto h-4 w-4" /> : i + 1}</span>
                <Avatar name={s.name} className="h-8 w-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-100">{s.name}</p>
                  <p className="text-xs text-slate-500">{[s.role && ROLE_LABEL[s.role], store?.name].filter(Boolean).join(" · ") || "—"} · {atGoal.get(s.id) ?? 0} dias com meta batida · {filled.get(s.id) ?? 0}/{doneDays} dias preenchidos</p>
                  <div className="mt-1.5"><Bar value={score} /></div>
                </div>
                <span className="w-12 text-right font-mono text-lg font-semibold text-white">{score}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Lojas */}
        {base.stores.length > 0 && (
          <Card title="Lojas">
            <ul className="divide-y divide-line">
              {base.stores.map((st) => {
                const ss = sales.filter((x) => x.store_id === st.id);
                const fat = ss.reduce((a, x) => a + x.value, 0);
                const p = pct(fat, st.revenue_goal);
                const left = st.revenue_goal ? Math.max(0, st.revenue_goal - fat) : 0;
                const daysLeft = isCurrent ? weekdaysBetween(today, period.to) : 0;
                const osAvg = doneDays ? ss.length / doneDays : 0;
                return (
                  <li key={st.id} className="px-5 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-slate-100">{st.name}</span>
                      <span className="font-mono text-sm text-white">{fmtBRL(fat)}{st.revenue_goal ? <span className="text-slate-500"> / {fmtBRL(st.revenue_goal)}</span> : null}</span>
                    </div>
                    {st.revenue_goal ? <div className="mt-2"><Bar value={p ?? 0} /></div> : null}
                    <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-400">
                      <span>{ss.length} OS · média {osAvg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/dia útil{st.os_daily_goal ? ` (meta ${st.os_daily_goal})` : ""}</span>
                      {left > 0 && daysLeft > 0 ? <span>falta {fmtBRL(left)} · {fmtBRL(Math.ceil(left / daysLeft))}/dia útil</span> : p !== null && p >= 100 ? <span className="text-emerald-300">meta batida</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {/* Conversão SDR */}
        {activities.length > 0 && (
          <Card title="Conversão por pessoa" extra={<span className="text-xs text-slate-500">resultado ÷ feito</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-2 font-medium">Pessoa</th>{activities.map((a) => <th key={a.id} className="px-3 py-2 font-medium">{a.name}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {people.filter((s) => activities.some((a) => metricApplies(a, s))).map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-2.5 font-medium text-slate-100">{s.name}</td>
                      {activities.map((a) => {
                        if (!metricApplies(a, s)) return <td key={a.id} className="px-3 py-2.5 text-slate-600">—</td>;
                        const done = get(curT, s.id, a.id);
                        const res = resultsOf(ms, a.id).reduce((x, r) => x + get(curT, s.id, r.id), 0);
                        const c = conv(res, done);
                        return <td key={a.id} className="px-3 py-2.5"><span className="font-mono text-white">{res}/{done}</span> <span className={cn("text-xs", c === null ? "text-slate-500" : c >= 30 ? "text-emerald-300" : c >= 15 ? "text-amber-300" : "text-red-300")}>{c === null ? "" : `${c.toLocaleString("pt-BR")}%`}</span></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* OS por origem */}
        {sales.length > 0 && (
          <Card title="De onde vieram as OS">
            <ul className="divide-y divide-line">
              {[...sdrs.map((s) => ({ id: s.id, name: `SDR: ${s.name}` })), { id: null as string | null, name: "Direto (sem SDR)" }].map((o) => {
                const list = sales.filter((x) => x.sdr_id === o.id);
                if (!list.length && o.id === null) return null;
                const val = list.reduce((a, x) => a + x.value, 0);
                return (
                  <li key={o.id ?? "direto"} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="text-slate-200">{o.name}</span>
                    <span className="font-mono text-white">{list.length} OS · {fmtBRL(val)} <span className="text-xs text-slate-500">({pct(list.length, sales.length)?.toLocaleString("pt-BR") ?? 0}%)</span></span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      {/* Por pessoa */}
      <Card title="Por pessoa" extra={<span className="text-xs text-slate-500">realizado / meta do período</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5 font-medium">Pessoa</th>
                {ms.map((m) => <th key={m.id} className="px-3 py-2.5 font-medium">{m.result_of ? "↳ " : ""}{m.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((s) => (
                <tr key={s.id} className="hover:bg-ink-850">
                  <td className="sticky left-0 z-10 bg-ink-900 px-5 py-3"><div className="flex items-center gap-2"><Avatar name={s.name} className="h-7 w-7 text-[11px]" /><span className="font-medium text-slate-100">{s.name}</span></div></td>
                  {ms.map((m) => {
                    if (!metricApplies(m, s)) return <td key={m.id} className="px-3 py-3 text-slate-700">—</td>;
                    const val = get(curT, s.id, m.id);
                    const g = m.result_of ? null : goalFor(base.goals, m, s.id).monthly;
                    const p = pct(val, g);
                    return (
                      <td key={m.id} className="px-3 py-3 align-top">
                        <span className="font-semibold tabular-nums text-white">{fmtValue(val, m.unit)}</span>{g ? <span className="text-xs text-slate-500"> / {fmtValue(g, m.unit)}</span> : null}
                        <div className="flex items-center gap-2">
                          {p !== null && <span className={cn("text-xs font-medium", p >= 100 ? "text-emerald-300" : p >= 70 ? "text-amber-300" : "text-red-300")}>{p.toLocaleString("pt-BR")}%</span>}
                          <Delta v={delta(val, get(prevT, s.id, m.id))} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------- Atividade do dia

function DayActivity({ base, period, today }: { base: TeamBase; period: Period; today: string }) {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const [day, setDay] = useState(period.to < today ? period.to : today);
  const [vals, setVals] = useState<{ day: string; v: TeamValue[]; s: TeamSale[] } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchValues(ws.orgId, day, day, tz), fetchSales(ws.orgId, day, day)]).then(([v, s]) => { if (alive) setVals({ day, v, s }); }).catch(() => toast.error("Erro ao carregar o dia"));
    return () => { alive = false; };
  }, [ws.orgId, day, tz]);
  const ms = base.metrics.filter((m) => m.active);
  const people = base.sellers.filter((s) => s.active);
  const t = useMemo(() => totals(vals?.v ?? []), [vals]);

  return (
    <Card title="Quem fez o quê no dia" extra={
      <div className="flex items-center gap-1 rounded-lg border border-line bg-ink-850 p-0.5">
        <button type="button" onClick={() => setDay(addDays(day, -1))} className="rounded p-1.5 text-slate-400 hover:bg-ink-700" aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[90px] text-center font-mono text-xs text-white">{fmtDayFull(day)}</span>
        <button type="button" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} className="rounded p-1.5 text-slate-400 hover:bg-ink-700 disabled:opacity-30" aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></button>
      </div>}>
      {vals?.day !== day ? <div className="flex h-32 items-center justify-center"><Spinner /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-2.5 font-medium">Pessoa</th>{ms.map((m) => <th key={m.id} className="px-3 py-2.5 font-medium">{m.result_of ? "↳ " : ""}{m.name}</th>)}<th className="px-3 py-2.5 font-medium">Dia</th></tr></thead>
            <tbody className="divide-y divide-line">
              {people.map((s) => {
                const items = dayGoalItems(base.metrics, base.goals, s);
                const ok = items.length > 0 && items.every((it) => (t.get(`${s.id}:${it.m.id}`) ?? 0) >= it.goal);
                const any = ms.some((m) => (t.get(`${s.id}:${m.id}`) ?? 0) > 0);
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-2.5 font-medium text-slate-100">{s.name}</td>
                    {ms.map((m) => {
                      if (!metricApplies(m, s)) return <td key={m.id} className="px-3 py-2.5 text-slate-700">—</td>;
                      const val = t.get(`${s.id}:${m.id}`) ?? 0;
                      const g = m.result_of ? null : goalFor(base.goals, m, s.id).daily;
                      return <td key={m.id} className={cn("px-3 py-2.5 font-mono", g ? (val >= g ? "text-emerald-300" : val > 0 ? "text-amber-300" : "text-red-300/80") : "text-slate-200")}>{fmtValue(val, m.unit)}{g ? <span className="text-slate-600">/{g}</span> : null}</td>;
                    })}
                    <td className="px-3 py-2.5 text-xs">{ok ? <span className="text-emerald-300">meta batida</span> : any ? <span className="text-amber-300">parcial</span> : <span className="text-slate-500">não preencheu</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- Observações

function NotesView({ base, notes, period, today }: { base: TeamBase; notes: TeamNote[]; period: Period; today: string }) {
  const [range, setRange] = useState<"hoje" | "7d" | "periodo">("7d");
  const [who, setWho] = useState("");
  const from = range === "hoje" ? today : range === "7d" ? addDays(today, -6) : period.from;
  const list = notes.filter((n) => n.body.trim() && n.day >= from && (!who || n.seller_id === who)).sort((a, b) => (a.day < b.day ? 1 : -1));
  const name = (id: string) => base.sellers.find((s) => s.id === id);

  function copy() {
    const text = list.map((n) => {
      const s = name(n.seller_id);
      return `${fmtDayFull(n.day)} — ${s?.name ?? ""}${s?.role ? ` (${ROLE_LABEL[s.role]})` : ""}\n${n.body.trim()}`;
    }).join("\n\n");
    void navigator.clipboard.writeText(text || "Sem observações no período.").then(() => toast.success("Copiado — é só colar no WhatsApp"));
  }

  return (
    <Card title="Observações das ligações" extra={
      <div className="flex flex-wrap items-center gap-2">
        <select className="field h-8 w-auto py-0 text-xs" value={range} onChange={(e) => setRange(e.target.value as typeof range)} aria-label="Período">
          <option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="periodo">{period.label}</option>
        </select>
        <select className="field h-8 w-auto py-0 text-xs" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Pessoa">
          <option value="">Todos</option>{base.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copiar relatório</Button>
      </div>}>
      {!list.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">Nenhuma observação no período.</p> : (
        <ul className="divide-y divide-line">
          {list.map((n) => {
            const s = name(n.seller_id);
            return (
              <li key={`${n.seller_id}:${n.day}`} className="px-5 py-3.5">
                <p className="mb-1 flex items-center gap-2 text-xs"><b className="text-slate-100">{s?.name}</b><span className="text-slate-500">{s?.role ? ROLE_LABEL[s.role] : ""} · {fmtDayFull(n.day)}</span></p>
                <p className="whitespace-pre-wrap font-mono text-sm text-slate-300">{n.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- Antes x depois

function Compare({ base, period, cur, prev, prevLabel }: { base: TeamBase; period: Period; cur: TeamValue[]; prev: TeamValue[]; prevLabel: string }) {
  const ms = base.metrics.filter((m) => m.active);
  const sum = (vals: TeamValue[], mid: string) => vals.filter((v) => v.metric_id === mid).reduce((a, v) => a + v.value, 0);
  const baseline = base.settings.baseline ?? {};
  const hasBaseline = Object.keys(baseline).length > 0;
  return (
    <Card title="Antes x depois" extra={<span className="text-xs text-slate-500">{hasBaseline ? "marco zero = como era antes da consultoria" : "cadastre o marco zero em Configurar"}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 font-medium">Indicador</th>
            {hasBaseline && <th className="px-3 py-2.5 font-medium">Marco zero</th>}
            <th className="px-3 py-2.5 font-medium">{prevLabel}</th>
            <th className="px-3 py-2.5 font-medium">{period.label}</th>
            <th className="px-3 py-2.5 font-medium">x anterior</th>
            {hasBaseline && <th className="px-3 py-2.5 font-medium">x marco zero</th>}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {ms.map((m) => {
              const c = sum(cur, m.id), p = sum(prev, m.id), b = baseline[m.id];
              return (
                <tr key={m.id}>
                  <td className="px-5 py-2.5 font-medium text-slate-100">{m.result_of ? "↳ " : ""}{m.name}</td>
                  {hasBaseline && <td className="px-3 py-2.5 font-mono text-slate-400">{b === undefined ? "—" : fmtValue(Number(b), m.unit)}</td>}
                  <td className="px-3 py-2.5 font-mono text-slate-300">{fmtValue(p, m.unit)}</td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-white">{fmtValue(c, m.unit)}</td>
                  <td className="px-3 py-2.5"><Delta v={delta(c, p)} /></td>
                  {hasBaseline && <td className="px-3 py-2.5">{b === undefined ? <span className="text-slate-600">—</span> : <Delta v={delta(c, Number(b))} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {base.settings.baseline_note && <p className="border-t border-line px-5 py-3 text-xs text-slate-400">{base.settings.baseline_note}</p>}
    </Card>
  );
}


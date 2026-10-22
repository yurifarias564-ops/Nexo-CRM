"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace";
import { Avatar, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { currentPeriod, periodLabel, shiftPeriod } from "@/lib/reports/period";
import { delta, filledDays, fmtValue, monthDays, pct, targetFor, todayIn, totals, type TeamGoal, type TeamMetric, type TeamSeller, type TeamValue } from "@/lib/team";
import { browserTz, fetchGoals, fetchValues } from "./data";

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

/** Realizado x meta do mês por vendedora, com comparação com outro mês. */
export function TeamBoard({ sellers, metrics }: { sellers: TeamSeller[]; metrics: TeamMetric[] }) {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const thisMonth = currentPeriod(tz);
  const [period, setPeriod] = useState(thisMonth);
  const [compare, setCompare] = useState(() => shiftPeriod(currentPeriod(browserTz()), -1));
  const [data, setData] = useState<{ key: string; goals: TeamGoal[]; cur: TeamValue[]; prev: TeamValue[] } | null>(null);
  const key = `${period}|${compare}`;

  // No mês em andamento, compara com os mesmos dias do outro mês (1 até hoje)
  const upto = period === thisMonth ? Number(todayIn(tz).slice(8, 10)) : null;

  useEffect(() => {
    let alive = true;
    const a = monthDays(period);
    const full = monthDays(compare);
    const b = upto ? { ...full, last: `${compare}-${String(Math.min(upto, full.days)).padStart(2, "0")}` } : full;
    Promise.all([fetchGoals(ws.orgId, period), fetchValues(ws.orgId, a.first, a.last, tz), fetchValues(ws.orgId, b.first, b.last, tz)])
      .then(([goals, cur, prev]) => { if (alive) setData({ key, goals, cur, prev }); })
      .catch(() => toast.error("Não foi possível carregar o painel"));
    return () => { alive = false; };
  }, [ws.orgId, period, compare, tz, key, upto]);

  const ms = metrics.filter((m) => m.active);
  const ready = data?.key === key;
  const cur = useMemo(() => totals(ready ? data.cur : []), [ready, data]);
  const prev = useMemo(() => totals(ready ? data.prev : []), [ready, data]);
  const filled = useMemo(() => filledDays(ready ? data.cur : [], new Set(ms.filter((m) => m.source === "manual").map((m) => m.id))), [ready, data, ms]);
  const rows = sellers.filter((s) => s.active || ms.some((m) => (cur.get(`${s.id}:${m.id}`) ?? 0) > 0));
  const goals = ready ? data.goals : [];

  const { days } = monthDays(period);
  const elapsed = period === thisMonth ? Number(todayIn(tz).slice(8, 10)) : period < thisMonth ? days : 0;
  const months = Array.from({ length: 18 }, (_, i) => shiftPeriod(thisMonth, -i));

  const teamTotal = (m: TeamMetric, map: Map<string, number>) => rows.reduce((a, s) => a + (map.get(`${s.id}:${m.id}`) ?? 0), 0);
  const teamTarget = (m: TeamMetric) => {
    const ts = rows.map((s) => targetFor(goals, m, s.id).monthly);
    return ts.some((t) => t !== null) ? ts.reduce<number>((a, t) => a + (t ?? 0), 0) : null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-900 p-1">
          <button type="button" onClick={() => { setPeriod((p) => shiftPeriod(p, -1)); setCompare((c) => shiftPeriod(c, -1)); }} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
          <span className="flex min-w-[170px] items-center justify-center gap-2 text-sm font-medium text-white"><CalendarRange className="h-4 w-4 text-brand-300" />{periodLabel(period)}</span>
          <button type="button" onClick={() => { setPeriod((p) => shiftPeriod(p, 1)); setCompare((c) => shiftPeriod(c, 1)); }} disabled={period >= thisMonth} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Comparar com
            <select className="field h-9 w-auto py-0" value={compare} onChange={(e) => setCompare(e.target.value)}>
              {months.filter((p) => p !== period).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
          </label>
          <a href={`/api/team/export?period=${period}&compare=${compare}&tz=${encodeURIComponent(tz)}${upto ? `&upto=${upto}` : ""}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-200 hover:border-brand-400/40 hover:bg-ink-800"><Download className="h-4 w-4" /> Excel</a>
        </div>
      </div>

      {!ready ? <div className="card flex h-48 items-center justify-center"><Spinner /></div> : (
        <>
          {/* Totais do time por indicador */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {ms.map((m) => {
              const total = teamTotal(m, cur);
              const target = teamTarget(m);
              const p = pct(total, target);
              const expected = target && days ? (target * elapsed) / days : null;
              return (
                <div key={m.id} className="card p-4">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500" title={m.name}>{m.name}</p>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <p className="text-2xl font-semibold tabular-nums text-white">{fmtValue(total, m.unit)}</p>
                    <Delta v={delta(total, teamTotal(m, prev))} />
                  </div>
                  {target ? (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                        <div className={cn("h-full rounded-full", (p ?? 0) >= 100 ? "bg-emerald-400" : "bg-brand-400")} style={{ width: `${Math.min(100, p ?? 0)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{p?.toLocaleString("pt-BR")}% de {fmtValue(target, m.unit)}
                        {expected !== null && period === thisMonth ? <span className={total >= expected ? "text-emerald-300" : "text-amber-300"}> · {total >= expected ? "no ritmo" : "abaixo do ritmo"}</span> : null}
                      </p>
                    </>
                  ) : <p className="mt-2 text-xs text-slate-500">sem meta mensal · {periodLabel(compare).split(" ")[0]?.toLowerCase()}: {fmtValue(teamTotal(m, prev), m.unit)}</p>}
                </div>
              );
            })}
          </div>

          {/* Por vendedora */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
              <h3 className="font-semibold text-white">Por vendedora</h3>
              <p className="text-xs text-slate-500">realizado / meta do mês · variação contra {periodLabel(compare).toLowerCase()}{upto ? ` (dias 1 a ${upto})` : ""}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5 font-medium">Vendedora</th>
                    {ms.map((m) => <th key={m.id} className="px-3 py-2.5 font-medium">{m.name}</th>)}
                    <th className="px-3 py-2.5 font-medium">Dias preenchidos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-ink-850">
                      <td className="sticky left-0 z-10 bg-ink-900 px-5 py-3">
                        <div className="flex items-center gap-2"><Avatar name={s.name} className="h-7 w-7 text-[11px]" /><span className="font-medium text-slate-100">{s.name}</span></div>
                      </td>
                      {ms.map((m) => {
                        const k = `${s.id}:${m.id}`;
                        const v = cur.get(k) ?? 0;
                        const t = targetFor(goals, m, s.id).monthly;
                        const p = pct(v, t);
                        return (
                          <td key={m.id} className="px-3 py-3 align-top">
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-semibold tabular-nums text-white">{fmtValue(v, m.unit)}</span>
                              {t ? <span className="text-xs text-slate-500">/ {fmtValue(t, m.unit)}</span> : null}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              {p !== null && <span className={cn("text-xs font-medium", p >= 100 ? "text-emerald-300" : p >= 70 ? "text-amber-300" : "text-red-300")}>{p.toLocaleString("pt-BR")}%</span>}
                              <Delta v={delta(v, prev.get(k) ?? 0)} />
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 tabular-nums text-slate-300">{filled.get(s.id) ?? 0}{elapsed ? <span className="text-slate-500"> / {elapsed}</span> : null}</td>
                    </tr>
                  ))}
                  <tr className="bg-ink-850 font-medium">
                    <td className="sticky left-0 z-10 bg-ink-850 px-5 py-3 text-slate-300">Time</td>
                    {ms.map((m) => {
                      const v = teamTotal(m, cur);
                      const t = teamTarget(m);
                      return (
                        <td key={m.id} className="px-3 py-3">
                          <span className="font-semibold tabular-nums text-white">{fmtValue(v, m.unit)}</span>
                          {t ? <span className="text-xs text-slate-500"> / {fmtValue(t, m.unit)}</span> : null}
                          <div><Delta v={delta(v, teamTotal(m, prev))} /></div>
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

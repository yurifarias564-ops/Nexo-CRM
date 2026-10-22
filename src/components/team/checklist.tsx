"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Lock, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Avatar, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { addDays, fmtValue, monthDays, pct, targetFor, todayIn, totals, type TeamGoal, type TeamMetric, type TeamSeller, type TeamValue } from "@/lib/team";
import { browserTz, fetchGoals, fetchValues } from "./data";

const LS_KEY = "team:seller";

function dayLabel(day: string, today: string) {
  if (day === today) return "Hoje";
  if (day === addDays(today, -1)) return "Ontem";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

/** A vendedora clica no próprio nome e preenche o checklist do dia (zera a cada dia). */
export function Checklist({ sellers, metrics }: { sellers: TeamSeller[]; metrics: TeamMetric[] }) {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const [today] = useState(() => todayIn(browserTz()));
  const active = sellers.filter((s) => s.active);
  const mine = active.find((s) => s.user_id === ws.userId);
  const [sellerId, setSellerId] = useState<string | null>(() => {
    if (mine) return mine.id;
    try { const v = localStorage.getItem(LS_KEY); return active.some((s) => s.id === v) ? v : null; } catch { return null; }
  });
  const [day, setDay] = useState(today);
  const period = day.slice(0, 7);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [values, setValues] = useState<TeamValue[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, "saving" | "ok">>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const seller = active.find((s) => s.id === sellerId) ?? null;
  const canFill = !!seller && (!seller.user_id || seller.user_id === ws.userId || ws.canManage);
  const shown = metrics.filter((m) => m.active);

  const load = useCallback(async () => {
    const { first, last } = monthDays(period);
    try {
      const [g, v] = await Promise.all([fetchGoals(ws.orgId, period), fetchValues(ws.orgId, first, last, tz)]);
      setGoals(g);
      setValues(v);
      setDraft({});
    } catch {
      toast.error("Não foi possível carregar o checklist");
    }
  }, [ws.orgId, period, tz]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Atualiza se outra pessoa preencher ao mesmo tempo
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel(`team-entries-${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_entries", filter: `organization_id=eq.${ws.orgId}` }, () => {
        if (timers.current.size === 0) void load();
      })
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [ws.orgId, load]);

  function pick(id: string) {
    setSellerId(id);
    try { localStorage.setItem(LS_KEY, id); } catch { /* sem armazenamento: tudo bem */ }
  }

  const dayTotals = useMemo(() => totals(values ?? [], day), [values, day]);
  const monthTotals = useMemo(() => totals(values ?? []), [values]);

  function current(m: TeamMetric): number {
    const k = `${sellerId}:${m.id}`;
    if (draft[k] !== undefined) return Number(draft[k].replace(",", ".")) || 0;
    return dayTotals.get(k) ?? 0;
  }

  function setValue(m: TeamMetric, raw: string) {
    if (!seller || !canFill) return;
    const k = `${seller.id}:${m.id}`;
    setDraft((d) => ({ ...d, [k]: raw }));
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return;
    clearTimeout(timers.current.get(k));
    setSaved((s) => ({ ...s, [k]: "saving" }));
    timers.current.set(k, setTimeout(async () => {
      timers.current.delete(k);
      const { error } = await supabaseBrowser().from("team_entries").upsert(
        { organization_id: ws.orgId, seller_id: seller.id, metric_id: m.id, day, value: Math.round(n * 100) / 100, updated_by: ws.userId },
        { onConflict: "seller_id,metric_id,day" },
      );
      if (error) {
        setSaved((s) => { const c = { ...s }; delete c[k]; return c; });
        return toast.error(error.message);
      }
      setValues((vals) => {
        const rest = (vals ?? []).filter((v) => !(v.seller_id === seller.id && v.metric_id === m.id && v.day === day));
        return [...rest, { seller_id: seller.id, metric_id: m.id, day, value: n }];
      });
      setDraft((d) => { const c = { ...d }; delete c[k]; return c; });
      setSaved((s) => ({ ...s, [k]: "ok" }));
    }, 600));
  }

  const done = seller ? shown.filter((m) => { const t = targetFor(goals, m, seller.id).daily; return t && current(m) >= t; }).length : 0;
  const withDaily = seller ? shown.filter((m) => targetFor(goals, m, seller.id).daily).length : 0;

  return (
    <div className="space-y-5">
      {/* Quem está preenchendo */}
      <div>
        <p className="label">Quem está preenchendo?</p>
        <div className="flex flex-wrap gap-2">
          {active.map((s) => (
            <button key={s.id} type="button" onClick={() => pick(s.id)}
              className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition",
                s.id === sellerId ? "border-brand-400 bg-brand-500/15 text-white shadow-glow" : "border-line bg-ink-900 text-slate-300 hover:border-slate-500")}>
              <Avatar name={s.name} className="h-7 w-7 text-[11px]" /> {s.name}
            </button>
          ))}
        </div>
      </div>

      {!seller ? (
        <div className="card px-6 py-12 text-center text-sm text-slate-400">Clique no seu nome para abrir o checklist.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h3 className="font-semibold text-white">Checklist de {seller.name}</h3>
              <p className="text-sm text-slate-400">{withDaily ? <>{done} de {withDaily} metas do dia batidas</> : "Preencha os números do dia"}</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-850 p-1">
              <button type="button" onClick={() => setDay((d) => addDays(d, -1))} className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[110px] text-center text-sm font-medium capitalize text-white">{dayLabel(day, today)}</span>
              <button type="button" onClick={() => setDay((d) => addDays(d, 1))} disabled={day >= today} className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white disabled:opacity-30" aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          {!canFill && (
            <p className="flex items-center gap-2 border-b border-line bg-ink-850 px-5 py-2.5 text-xs text-slate-400"><Lock className="h-3.5 w-3.5" /> Só {seller.name} ou um administrador pode preencher este checklist.</p>
          )}
          {values === null ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : (
            <ul className="divide-y divide-line">
              {shown.map((m) => {
                const k = `${seller.id}:${m.id}`;
                const t = targetFor(goals, m, seller.id);
                const v = current(m);
                const p = pct(v, t.daily);
                const hit = t.daily !== null && t.daily > 0 && v >= t.daily;
                const monthV = (monthTotals.get(k) ?? 0) - (dayTotals.get(k) ?? 0) + v;
                const manual = m.source === "manual";
                return (
                  <li key={m.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", hit ? "border-emerald-400 bg-emerald-400/20 text-emerald-300" : "border-line text-transparent")}><Check className="h-3 w-3" /></span>
                        <p className="truncate font-medium text-slate-100">{m.name}</p>
                        {!manual && <span className="flex shrink-0 items-center gap-1 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-200"><Sparkles className="h-3 w-3" /> automático</span>}
                      </div>
                      <div className="mt-2 flex flex-col gap-1.5 pl-7 sm:flex-row sm:items-center sm:gap-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700 sm:flex-1">
                          <div className={cn("h-full rounded-full transition-all", hit ? "bg-emerald-400" : "bg-brand-400")} style={{ width: `${Math.min(100, p ?? 0)}%` }} />
                        </div>
                        <span className="shrink-0 text-xs text-slate-400 sm:w-48 sm:text-right">
                          {t.daily ? <>meta do dia <b className="text-slate-200">{fmtValue(t.daily, m.unit)}</b></> : "sem meta diária"}
                          {t.monthly ? <> · mês {fmtValue(monthV, m.unit)}/{fmtValue(t.monthly, m.unit)}</> : null}
                        </span>
                      </div>
                    </div>
                    {manual ? (
                      <div className="flex items-center gap-1.5 pl-7 sm:pl-0">
                        <button type="button" disabled={!canFill || v <= 0} onClick={() => setValue(m, String(Math.max(0, v - 1)))}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-slate-300 hover:bg-ink-700 disabled:opacity-30" aria-label={`Diminuir ${m.name}`}><Minus className="h-4 w-4" /></button>
                        <input inputMode="decimal" disabled={!canFill} aria-label={m.name}
                          className="field h-10 w-24 text-center text-lg font-semibold tabular-nums"
                          value={draft[k] ?? String(dayTotals.get(k) ?? 0)} onChange={(e) => setValue(m, e.target.value)} onFocus={(e) => e.target.select()} />
                        <button type="button" disabled={!canFill} onClick={() => setValue(m, String(v + 1))}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-brand-400/40 bg-brand-500/15 text-brand-100 hover:bg-brand-500/25 disabled:opacity-30" aria-label={`Aumentar ${m.name}`}><Plus className="h-4 w-4" /></button>
                        <span className="w-5 text-center" aria-live="polite">
                          {saved[k] === "saving" ? <Spinner className="h-3.5 w-3.5" /> : saved[k] === "ok" ? <Check className="h-4 w-4 text-emerald-400" /> : null}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 pl-7 sm:block sm:pl-0 sm:text-right">
                        <p className="text-2xl font-semibold tabular-nums text-white">{fmtValue(v, m.unit)}</p>
                        <p className="text-[11px] text-slate-500">{seller.user_id ? "vem do CRM" : "vincule o login da vendedora"}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

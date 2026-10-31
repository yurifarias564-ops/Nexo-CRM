"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Lock, Minus, Plus, Sparkles, Trash2, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import {
  addDays, conv, dayGoalItems, dayProgress, fmtBRL, fmtDayFull, fmtValue, goalFor, parseBRL, periodAt, resultsOf, ROLE_LABEL,
  stepperMetrics, todayIn, totals, weekdaysBetween, weekStart, type TeamMetric, type TeamNote, type TeamRole, type TeamSale, type TeamSeller, type TeamValue,
} from "@/lib/team";
import { browserTz, useTeamApi, type TeamBase } from "./data";
import { VoiceFillButton } from "./voice-fill";

type Group = TeamRole | "todos";
const GROUP_TITLE: Record<Group, string> = { sdr: "SDR", closer: "Closer", todos: "Equipe" };

/** Anel de progresso do dia (igual ao playbook). */
function Ring({ value, size = 48 }: { value: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const tone = value >= 100 ? "text-emerald-400" : value >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div className="relative" style={{ width: size, height: size }} aria-label={`${value}% do dia`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" className="stroke-ink-700" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" strokeLinecap="round" className={cn("stroke-current transition-all", tone)}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, value) / 100)} />
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold", tone)}>{value}%</span>
    </div>
  );
}

export function Checklist({ base, reloadBase }: { base: TeamBase; reloadBase: () => Promise<void> }) {
  const api = useTeamApi();
  const [tz] = useState(browserTz);
  const [today] = useState(() => todayIn(browserTz()));
  const [view, setView] = useState<{ group: Group | null; sellerId: string | null }>({ group: null, sellerId: null });
  const [day, setDay] = useState(today);
  const period = useMemo(() => periodAt(day, base.settings.cycle_start), [day, base.settings.cycle_start]);
  const from = [period.from, weekStart(day), addDays(day, -7)].sort()[0]!;
  const [values, setValues] = useState<TeamValue[] | null>(null);
  const [sales, setSales] = useState<TeamSale[]>([]);
  const [notes, setNotes] = useState<TeamNote[]>([]);
  const pendingRef = useRef(0);

  const active = base.sellers.filter((s) => s.active);
  const groupOf = (s: TeamSeller): Group => s.role ?? "todos";
  const groups = (["sdr", "closer", "todos"] as Group[]).filter((g) => active.some((s) => groupOf(s) === g));
  const group = view.group ?? (groups.length === 1 ? groups[0]! : null);
  const seller = active.find((s) => s.id === view.sellerId) ?? null;

  const load = useCallback(async () => {
    try {
      const to = period.to > day ? period.to : day;
      const [v, sl, nt] = await Promise.all([
        api.values(from, to, tz), api.sales(from, to), api.notes(addDays(day, -1), day),
      ]);
      setValues(v); setSales(sl); setNotes(nt);
    } catch {
      toast.error("Não foi possível carregar o checklist");
    }
  }, [api, from, period.to, day, tz]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const refresh = () => { if (pendingRef.current === 0) void load(); };
    return api.subscribe(refresh);
  }, [api, load]);

  const dayTotals = useMemo(() => totals(values ?? [], day, day), [values, day]);
  const get = (sid: string, mid: string, map = dayTotals) => map.get(`${sid}:${mid}`) ?? 0;
  const progressOf = (s: TeamSeller) => dayProgress(dayGoalItems(base.metrics, base.goals, s), (mid) => get(s.id, mid));

  if (values === null) return <div className="card flex h-48 items-center justify-center"><Spinner /></div>;

  // ---------------------------------------------------------------- passo 1: função
  if (!group) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Toque na sua função.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => {
            const people = active.filter((s) => groupOf(s) === g);
            const avg = Math.round(people.reduce((a, s) => a + progressOf(s), 0) / people.length);
            const desc = base.metrics.filter((m) => m.active && !m.result_of && (m.role === g || (g === "todos" && m.role === "todos"))).map((m) => m.name.toLowerCase());
            return (
              <button key={g} type="button" onClick={() => setView({ group: g, sellerId: null })}
                className="card flex flex-col items-center gap-2 px-5 py-6 text-center transition hover:border-brand-400/50 hover:bg-ink-850">
                <Ring value={avg} />
                <span className="text-lg font-semibold text-white">{GROUP_TITLE[g]}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{people.length} {people.length === 1 ? "pessoa" : "pessoas"}</span>
                {desc.length > 0 && <span className="line-clamp-2 text-xs text-slate-400">{desc.slice(0, 4).join(", ")}{desc.length > 4 ? "…" : ""}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- passo 2: pessoa
  if (!seller) {
    const people = active.filter((s) => groupOf(s) === group);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-400">{groups.length > 1 && <b className="mr-1 text-slate-200">{GROUP_TITLE[group]} —</b>}Toque no seu nome para abrir o checklist de hoje.</p>
          {groups.length > 1 && <Button size="sm" variant="ghost" onClick={() => setView({ group: null, sellerId: null })}><ChevronLeft className="h-4 w-4" /> Voltar</Button>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {people.map((s) => {
            const items = dayGoalItems(base.metrics, base.goals, s);
            const osM = base.metrics.find((m) => m.active && m.source === "os_count" && (m.role === "todos" || m.role === s.role));
            const store = base.stores.find((x) => x.id === s.store_id);
            const osGoal = osM ? goalFor(base.goals, osM, s.id).daily ?? store?.os_daily_goal ?? null : null;
            const done = items.filter((it) => get(s.id, it.m.id) >= it.goal).length;
            return (
              <button key={s.id} type="button" onClick={() => { setDay(today); setView({ group, sellerId: s.id }); }}
                className="card flex flex-col items-center gap-1.5 px-4 py-5 text-center transition hover:border-brand-400/50 hover:bg-ink-850">
                <Ring value={progressOf(s)} />
                <span className="mt-1 text-base font-semibold uppercase tracking-wide text-white">{s.name}</span>
                {store && <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{store.name}</span>}
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                  {s.role === "closer" && osM ? `Vendas hoje ${get(s.id, osM.id)}/${osGoal ?? "—"}` : `Metas hoje ${done}/${items.length}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- passo 3: checklist
  return (
    <SellerChecklist key={`${seller.id}:${day}`} base={base} seller={seller} day={day} today={today} setDay={setDay} period={period}
      values={values} setValues={setValues} sales={sales} setSales={setSales} notes={notes} setNotes={setNotes} pendingRef={pendingRef}
      onBack={() => setView({ group, sellerId: null })} reloadBase={reloadBase} />
  );
}

function SellerChecklist({ base, seller, day, today, setDay, period, values, setValues, sales, setSales, notes, setNotes, pendingRef, onBack }: {
  base: TeamBase; seller: TeamSeller; day: string; today: string; setDay: (d: string) => void; period: ReturnType<typeof periodAt>;
  values: TeamValue[]; setValues: React.Dispatch<React.SetStateAction<TeamValue[] | null>>;
  sales: TeamSale[]; setSales: React.Dispatch<React.SetStateAction<TeamSale[]>>;
  notes: TeamNote[]; setNotes: React.Dispatch<React.SetStateAction<TeamNote[]>>;
  pendingRef: React.MutableRefObject<number>; onBack: () => void; reloadBase: () => Promise<void>;
}) {
  const api = useTeamApi();
  const canFill = api.isPublic || !seller.user_id || seller.user_id === api.userId || api.canManage;
  const store = base.stores.find((s) => s.id === seller.store_id) ?? null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, "saving" | "ok">>({});
  const [voiceNote, setVoiceNote] = useState<{ t: string; n: number } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const wk = weekStart(day);
  const dayT = useMemo(() => totals(values, day, day), [values, day]);
  const weekT = useMemo(() => totals(values, wk, day), [values, wk, day]);
  const perT = useMemo(() => totals(values, period.from, period.to), [values, period]);
  const v = (mid: string, map: Map<string, number>) => map.get(`${seller.id}:${mid}`) ?? 0;
  const cur = (mid: string) => (draft[mid] !== undefined ? Number(draft[mid].replace(",", ".")) || 0 : v(mid, dayT));

  const steppers = stepperMetrics(base.metrics, seller);
  const autoRows = base.metrics.filter((m) => m.active && !m.result_of && m.source !== "manual" && !m.source.startsWith("os_") && (m.role === "todos" || !seller.role || m.role === seller.role));
  const items = dayGoalItems(base.metrics, base.goals, seller);
  const allDone = items.length > 0 && items.every((it) => cur(it.m.id) >= it.goal);

  function persist(m: TeamMetric, n: number) {
    const k = m.id;
    clearTimeout(timers.current.get(k));
    setSaved((s) => ({ ...s, [k]: "saving" }));
    pendingRef.current++;
    timers.current.set(k, setTimeout(async () => {
      timers.current.delete(k);
      let error: string | null = null;
      try { await api.upsertEntry({ seller_id: seller.id, metric_id: m.id, day, value: Math.round(n * 100) / 100 }); } catch (e) { error = (e as Error).message; }
      pendingRef.current--;
      if (error) { setSaved((s) => { const c = { ...s }; delete c[k]; return c; }); return toast.error(error); }
      setValues((vals) => [...(vals ?? []).filter((x) => !(x.seller_id === seller.id && x.metric_id === m.id && x.day === day)), { seller_id: seller.id, metric_id: m.id, day, value: n }]);
      setDraft((d) => { const c = { ...d }; delete c[k]; return c; });
      setSaved((s) => ({ ...s, [k]: "ok" }));
    }, 600));
  }

  function setValue(m: TeamMetric, raw: string) {
    if (!canFill) return;
    setDraft((d) => ({ ...d, [m.id]: raw }));
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return;
    persist(m, n);
  }
  function step(m: TeamMetric, delta: 1 | -1) {
    const next = Math.max(0, cur(m.id) + delta);
    setValue(m, String(next));
    // Resultado conta também como feito: "+ em contatos efetivos" soma 1 em ligações
    if (delta === 1 && m.result_of) {
      const parent = base.metrics.find((x) => x.id === m.result_of);
      if (parent) setValue(parent, String(cur(parent.id) + 1));
    }
  }

  /** Áudio do vendedor: soma o que ele contou em cada atividade (e guarda o resto nas notas). */
  function applyVoice(updates: { metric_id: string; add: number }[]) {
    const byId = new Map(base.metrics.map((m) => [m.id, m]));
    // Resultado também soma na atividade principal (igual ao +)
    const add = new Map<string, number>();
    for (const u of updates) {
      const m = byId.get(u.metric_id);
      if (!m || u.add <= 0) continue;
      add.set(m.id, (add.get(m.id) ?? 0) + u.add);
      if (m.result_of && !updates.some((x) => x.metric_id === m.result_of)) add.set(m.result_of, (add.get(m.result_of) ?? 0) + u.add);
    }
    for (const [id, n] of add) { const m = byId.get(id)!; setValue(m, String(cur(id) + n)); }
    return [...add.keys()].map((id) => byId.get(id)!.name);
  }

  // Painel da loja / OS
  const osM = base.metrics.find((m) => m.active && m.source === "os_count" && (m.role === "todos" || !seller.role || m.role === seller.role));
  const fatM = base.metrics.find((m) => m.active && m.source === "os_value" && (m.role === "todos" || !seller.role || m.role === seller.role));
  const osGoal = osM ? goalFor(base.goals, osM, seller.id).daily ?? store?.os_daily_goal ?? null : null;
  const storeSellers = new Set(base.sellers.filter((s) => store && s.store_id === store.id).map((s) => s.id));
  const inPeriod = (d: string) => d >= period.from && d <= period.to;
  const storeSales = sales.filter((s) => store && (s.store_id === store.id || (!s.store_id && storeSellers.has(s.seller_id))));
  const storeFat = storeSales.filter((s) => inPeriod(s.day)).reduce((a, s) => a + s.value, 0);
  const storeOsToday = storeSales.filter((s) => s.day === day).length;
  const revenueGoal = store?.revenue_goal ?? null;
  const daysLeft = weekdaysBetween(day > period.from ? day : period.from, period.to);
  const left = revenueGoal ? Math.max(0, revenueGoal - storeFat) : 0;
  const mySalesToday = sales.filter((s) => s.seller_id === seller.id && s.day === day);
  const fromMe = sales.filter((s) => s.sdr_id === seller.id && inPeriod(s.day));
  const isCloser = seller.role === "closer" || (!seller.role && !!osM);

  // Últimos dias (antes do dia aberto)
  const history = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1))).map((d) => {
    const t = totals(values, d, d);
    const ok = items.length > 0 && items.every((it) => (t.get(`${seller.id}:${it.m.id}`) ?? 0) >= it.goal);
    const any = [...t.keys()].some((k) => k.startsWith(`${seller.id}:`));
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    return { d, ok, any, weekend: wd === 0 || wd === 6 };
  });

  const dayLabel = day === today ? "Hoje" : day === addDays(today, -1) ? "Ontem" : fmtDayFull(day);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            {fmtDayFull(day)}{seller.role ? ` · ${ROLE_LABEL[seller.role]}` : ""}{store ? ` · ${store.name}` : ""}
          </p>
          <h3 className="mt-1 text-3xl font-bold uppercase tracking-tight text-white">{seller.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-ink-900 p-0.5">
            <button type="button" onClick={() => setDay(addDays(day, -1))} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-700" aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[64px] text-center text-xs font-medium text-slate-200">{dayLabel}</span>
            <button type="button" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-700 disabled:opacity-30" aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
        </div>
      </div>

      {!canFill && (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-4 py-2.5 text-xs text-slate-400"><Lock className="h-3.5 w-3.5" /> Só {seller.name} ou um administrador pode preencher este checklist.</p>
      )}

      {/* Painel de OS e faturamento da loja */}
      {(isCloser || store) && (
        <div className="card space-y-2.5 p-4">
          {isCloser && osM && (
            <>
              <div className="flex items-baseline justify-between"><span className="text-sm text-slate-300">Vendas {day === today ? "de hoje" : "do dia"}</span><span className="font-mono text-2xl font-semibold text-white">{v(osM.id, dayT)}{osGoal ? ` / ${osGoal}` : ""}</span></div>
              {osGoal ? <Bar value={(100 * v(osM.id, dayT)) / osGoal} /> : null}
            </>
          )}
          {store && (
            <>
              <div className="flex items-baseline justify-between gap-3 pt-1 text-sm">
                <span className="text-slate-300">{store.name} — meta {period.cycle ? `do ${period.short.toLowerCase()}` : "do mês"}</span>
                <b className="font-mono text-white">{fmtBRL(storeFat)}{revenueGoal ? ` / ${fmtBRL(revenueGoal)}` : ""}</b>
              </div>
              {revenueGoal ? <Bar value={(100 * storeFat) / revenueGoal} tone="accent" /> : null}
              {revenueGoal && left > 0 && daysLeft > 0 ? (
                <div className="flex justify-between text-xs text-slate-500"><span>Falta {fmtBRL(left)}</span><span className="font-mono">{fmtBRL(Math.ceil(left / daysLeft))} por dia útil ({daysLeft} dias)</span></div>
              ) : null}
              {seller.role === "sdr" && store.os_daily_goal ? (
                <div className="flex items-baseline justify-between text-sm"><span className="text-slate-300">Vendas da loja {day === today ? "hoje" : "no dia"}</span><b className="font-mono text-white">{storeOsToday} / {store.os_daily_goal}</b></div>
              ) : null}
            </>
          )}
          {seller.role === "sdr" && (
            <div className="flex items-baseline justify-between pt-1 text-sm"><span className="text-slate-300">Vendas que vieram de você no {period.cycle ? "ciclo" : "mês"}</span><b className="font-mono text-white">{fromMe.length} · {fmtBRL(fromMe.reduce((a, s) => a + s.value, 0))}</b></div>
          )}
        </div>
      )}

      {/* Metas do dia */}
      <div className="card p-4 sm:p-5">
        {allDone && <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300"><Check className="h-3.5 w-3.5" /> Meta de hoje batida</span>}
        {canFill && steppers.length > 0 && <VoiceFillButton seller={seller} onFill={applyVoice} onNote={(t) => setVoiceNote((p) => ({ t, n: (p?.n ?? 0) + 1 }))} />}
        {steppers.length ? <p className="mb-3 text-xs text-slate-500">Fez muitas de uma vez? Toque no número e digite direto, ou mande um áudio contando o seu dia.</p>
          : <p className="text-sm text-slate-400">Nenhuma atividade manual para sua função.{isCloser ? " Suas vendas entram pelo card abaixo." : ""}</p>}
        <ul className="divide-y divide-line">
          {steppers.map((m) => {
            const g = goalFor(base.goals, m, seller.id);
            const val = cur(m.id);
            const done = !!g.daily && val >= g.daily;
            const wkV = v(m.id, weekT) - v(m.id, dayT) + val;
            const moV = v(m.id, perT) - v(m.id, dayT) + val;
            const results = resultsOf(base.metrics, m.id);
            return (
              <li key={m.id} className="py-3.5">
                <Row label={m.name} done={done} hasGoal={!!g.daily}
                  hint={results.length ? "Não deu resultado? Toque + aqui." : null}
                  meta={<>Meta do dia: {g.daily ?? "—"} · Semana {wkV}/{g.weekly ?? "—"} · {period.cycle ? "Ciclo" : "Mês"} {moV}/{g.monthly ?? "—"}</>}
                  bar={g.daily ? (100 * val) / g.daily : 0}
                  stepper={<Stepper label={m.name} value={draft[m.id] ?? String(val)} disabled={!canFill} onStep={(d) => step(m, d)} onType={(raw) => setValue(m, raw)} state={saved[m.id]} />} />
                {results.map((r) => {
                  const rv = cur(r.id);
                  const rMo = v(r.id, perT) - v(r.id, dayT) + rv;
                  const c = conv(rv, val);
                  return (
                    <div key={r.id} className="mt-3 ml-4 border-l border-line pl-4">
                      <Row label={`↳ ${r.name}`} done={false} hasGoal={false} pill={<span className="rounded-full bg-ink-700 px-2 py-0.5 font-mono text-[10px] text-slate-300">Conversão hoje {c === null ? "—" : `${c.toLocaleString("pt-BR")}%`}</span>}
                        hint={`Deu certo? Toque + aqui — já soma 1 em ${m.name.toLowerCase()} também.`}
                        meta={<>No {period.cycle ? "ciclo" : "mês"}: {rMo} de {moV} · conversão {conv(rMo, moV)?.toLocaleString("pt-BR") ?? "—"}%</>}
                        stepper={<Stepper label={r.name} value={draft[r.id] ?? String(rv)} disabled={!canFill} onStep={(d) => step(r, d)} onType={(raw) => setValue(r, raw)} state={saved[r.id]} />} />
                    </div>
                  );
                })}
              </li>
            );
          })}
          {autoRows.map((m) => {
            const g = goalFor(base.goals, m, seller.id);
            const val = v(m.id, dayT);
            return (
              <li key={m.id} className="py-3.5">
                <Row label={m.name} done={!!g.daily && val >= g.daily} hasGoal={!!g.daily}
                  pill={<span className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-200"><Sparkles className="h-3 w-3" /> do CRM</span>}
                  meta={<>Meta do dia: {g.daily ?? "—"} · {period.cycle ? "Ciclo" : "Mês"} {fmtValue(v(m.id, perT), m.unit)}/{g.monthly ? fmtValue(g.monthly, m.unit) : "—"}{!seller.user_id ? " · ligue o login desta pessoa para contar" : ""}</>}
                  bar={g.daily ? (100 * val) / g.daily : 0}
                  stepper={<span className="w-[132px] text-right font-mono text-2xl font-semibold text-white">{fmtValue(val, m.unit)}</span>} />
              </li>
            );
          })}
        </ul>
      </div>

      <NotesCard seller={seller} day={day} today={today} canFill={canFill} notes={notes} setNotes={setNotes} append={voiceNote} />

      {isCloser && (osM || fatM) && (
        <RegisterSale base={base} seller={seller} day={day} canFill={canFill} todays={mySalesToday} setSales={setSales} setValues={setValues} osM={osM} fatM={fatM} />
      )}

      {seller.role === "closer" && <SdrNotes base={base} seller={seller} day={day} notes={notes} />}

      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">Últimos dias</h4>
        <div className="flex flex-wrap gap-2">
          {history.map((h) => (
            <button key={h.d} type="button" onClick={() => setDay(h.d)}
              className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition hover:bg-ink-800",
                h.ok ? "border-emerald-500/40 text-emerald-300" : h.any ? "border-amber-500/30 text-amber-300" : h.weekend ? "border-line/60 text-slate-600" : "border-red-500/30 text-red-300/80")}
              title={h.ok ? "Meta do dia batida" : h.any ? "Preenchido, meta não batida" : h.weekend ? "Fim de semana" : "Não preenchido"}>
              {fmtDayFull(h.d).slice(0, 5)} {h.ok ? <Check className="h-3.5 w-3.5" /> : h.any ? "·" : h.weekend ? "fds" : <X className="h-3 w-3" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ value, tone = "brand" }: { value: number; tone?: "brand" | "accent" }) {
  const done = value >= 100;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
      <div className={cn("h-full rounded-full transition-all", done ? "bg-emerald-400" : tone === "accent" ? "bg-amber-400" : "bg-brand-400")} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function Row({ label, done, hasGoal, hint, meta, bar, stepper, pill }: {
  label: string; done: boolean; hasGoal: boolean; hint?: string | null; meta: React.ReactNode; bar?: number; stepper: React.ReactNode; pill?: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", done ? "bg-emerald-400" : hasGoal ? "bg-amber-400" : "bg-slate-600")} />
          <span className="font-medium text-slate-100">{label}</span>
          {pill ?? (hasGoal && (
            <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide", done ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
              {done ? "CONCLUÍDO ✓" : "EM ANDAMENTO »"}
            </span>
          ))}
        </div>
        {hint && <p className="mt-1 pl-4 text-xs text-slate-500">{hint}</p>}
        <p className="mt-1 pl-4 font-mono text-[11px] text-slate-400">{meta}</p>
        {bar !== undefined && <div className="mt-2 pl-4"><Bar value={bar} /></div>}
      </div>
      <div className="pl-4 sm:pl-0">{stepper}</div>
    </div>
  );
}

function Stepper({ label, value, disabled, onStep, onType, state }: {
  label: string; value: string; disabled: boolean; onStep: (d: 1 | -1) => void; onType: (raw: string) => void; state?: "saving" | "ok";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center overflow-hidden rounded-lg border border-line bg-ink-900">
        <button type="button" disabled={disabled || Number(value) <= 0} onClick={() => onStep(-1)} className="flex h-10 w-10 items-center justify-center text-slate-300 hover:bg-ink-700 disabled:opacity-30" aria-label={`Diminuir ${label}`}><Minus className="h-4 w-4" /></button>
        <input inputMode="decimal" disabled={disabled} aria-label={label} value={value} onChange={(e) => onType(e.target.value)} onFocus={(e) => e.target.select()}
          className="h-10 w-14 border-x border-line bg-transparent text-center font-mono text-lg font-semibold text-amber-300 underline decoration-dashed decoration-1 underline-offset-4 outline-none focus:bg-ink-800" />
        <button type="button" disabled={disabled} onClick={() => onStep(1)} className="flex h-10 w-10 items-center justify-center text-slate-200 hover:bg-ink-700 disabled:opacity-30" aria-label={`Aumentar ${label}`}><Plus className="h-4 w-4" /></button>
      </div>
      <span className="w-4" aria-live="polite">{state === "saving" ? <Spinner className="h-3.5 w-3.5" /> : state === "ok" ? <Check className="h-4 w-4 text-emerald-400" /> : null}</span>
    </div>
  );
}

function NotesCard({ seller, day, today, canFill, notes, setNotes, append }: {
  seller: TeamSeller; day: string; today: string; canFill: boolean; notes: TeamNote[]; setNotes: React.Dispatch<React.SetStateAction<TeamNote[]>>;
  append: { t: string; n: number } | null;
}) {
  const api = useTeamApi();
  const current = notes.find((n) => n.seller_id === seller.id && n.day === day) ?? null;
  const [text, setText] = useState(current?.body ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = text !== (current?.body ?? "");
  const lastAppend = useRef(0);

  const save = useCallback(async (body: string, quiet = false) => {
    setBusy(true);
    try {
      const data = await api.upsertNote({ seller_id: seller.id, day, body: body.slice(0, 8000) });
      setNotes((ns) => [...ns.filter((n) => !(n.seller_id === seller.id && n.day === day)), data]);
      if (!quiet) toast.success("Notas salvas");
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }, [api, seller.id, day, setNotes]);

  // O áudio trouxe detalhes (nomes, telefones, combinados): entra nas notas e já salva
  useEffect(() => {
    if (!append || append.n === lastAppend.current) return;
    lastAppend.current = append.n;
    const t = setTimeout(() => {
      setText((prev) => {
        const next = prev.trim() ? `${prev.trim()}\n${append.t}` : append.t;
        void save(next, true);
        return next;
      });
    }, 0);
    return () => clearTimeout(t);
  }, [append, save]);

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-semibold text-white">Bloco de notas</h4>
        <span className="font-mono text-[11px] text-slate-500">{dirty ? "ainda não salvo" : current ? `salvo às ${new Date(current.updated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
      </div>
      <p className="mt-0.5 text-sm text-slate-400">Escreva o que aconteceu nas ligações {day === today ? "de hoje" : "do dia"}. {seller.role === "sdr" ? "O closer da sua loja e o gestor leem." : "O gestor lê."}</p>
      <textarea className="field mt-3 min-h-[140px] font-mono text-sm" disabled={!canFill} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)}
        placeholder={"Ex.:\nMaria (85) 9 8888-1234 — notebook não liga, quer orçamento até sexta.\nSr. João — vai levar a impressora sábado de manhã."} />
      <div className="mt-3 flex justify-end"><Button onClick={() => void save(text)} loading={busy} disabled={!canFill || !dirty}>Salvar notas</Button></div>
    </div>
  );
}

function RegisterSale({ base, seller, day, canFill, todays, setSales, setValues, osM, fatM }: {
  base: TeamBase; seller: TeamSeller; day: string; canFill: boolean; todays: TeamSale[];
  setSales: React.Dispatch<React.SetStateAction<TeamSale[]>>; setValues: React.Dispatch<React.SetStateAction<TeamValue[] | null>>;
  osM: TeamMetric | undefined; fatM: TeamMetric | undefined;
}) {
  const api = useTeamApi();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [sdr, setSdr] = useState("");
  const [busy, setBusy] = useState(false);
  const sdrs = base.sellers.filter((s) => s.active && s.role === "sdr");
  const storeName = (id: string | null) => base.stores.find((s) => s.id === id)?.name;

  function bump(n: number, val: number) {
    setValues((vals) => {
      const out = [...(vals ?? [])];
      const add = (mid: string | undefined, amount: number) => {
        if (!mid) return;
        const i = out.findIndex((x) => x.seller_id === seller.id && x.metric_id === mid && x.day === day);
        if (i >= 0) out[i] = { ...out[i]!, value: out[i]!.value + amount };
        else out.push({ seller_id: seller.id, metric_id: mid, day, value: amount });
      };
      add(osM?.id, n);
      add(fatM?.id, val);
      return out;
    });
  }

  async function register() {
    const val = parseBRL(value) ?? 0;
    if (val < 0) return toast.error("Valor inválido");
    if (sdrs.length && !sdr) return toast.error("Escolha de onde veio o cliente");
    setBusy(true);
    let data: TeamSale;
    try {
      data = await api.insertSale({ seller_id: seller.id, day, value: val, os_number: osNumber.trim().slice(0, 40) || null, sdr_id: sdr && sdr !== "direto" ? sdr : null });
    } catch (e) { setBusy(false); return toast.error((e as Error).message); }
    setBusy(false);
    setSales((s) => [data, ...s]);
    bump(1, val);
    toast.success(`Venda registrada${val ? ` · ${fmtBRL(val)}` : ""}`);
    setValue(""); setOsNumber(""); setSdr(""); setOpen(false);
  }

  async function remove(s: TeamSale) {
    if (!confirm(`Apagar a venda${s.os_number ? ` ${s.os_number}` : ""} de ${fmtBRL(s.value)}?`)) return;
    try { await api.deleteSale(s.id); } catch (e) { return toast.error((e as Error).message); }
    setSales((all) => all.filter((x) => x.id !== s.id));
    bump(-1, -s.value);
  }

  return (
    <div className="card p-4 sm:p-5">
      <h4 className="font-semibold text-white">Registrar venda</h4>
      {!open ? (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={!canFill} onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 py-1.5 pl-1.5 pr-4 text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/25"><Trophy className="h-4 w-4" /></span>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">Venda</span>
          </button>
          <span className="text-sm text-slate-400">Fechou uma venda agora? Clica pra registrar com o valor.</span>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Valor (R$)</span>
            <input className="field" inputMode="decimal" autoFocus placeholder="Ex.: 1.850,00" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <label className="block"><span className="label">Nº do pedido (opcional)</span>
            <input className="field" maxLength={40} value={osNumber} onChange={(e) => setOsNumber(e.target.value)} /></label>
          <label className="block"><span className="label">De onde veio</span>
            <select className="field" value={sdr} onChange={(e) => setSdr(e.target.value)}>
              <option value="">{sdrs.length ? "Escolha…" : "Direto"}</option>
              {sdrs.map((s) => <option key={s.id} value={s.id}>SDR: {s.name}{storeName(s.store_id) ? ` (${storeName(s.store_id)})` : ""}</option>)}
              {sdrs.length > 0 && <option value="direto">Direto — cliente chegou sozinho</option>}
            </select></label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={register} loading={busy}><Trophy className="h-4 w-4" /> Registrar venda</Button>
          </div>
        </div>
      )}
      {todays.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {todays.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-slate-500">{new Date(s.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="font-semibold text-white">{fmtBRL(s.value)}</span>
              {s.os_number && <span className="font-mono text-xs text-slate-400">#{s.os_number}</span>}
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{s.sdr_id ? `via ${base.sellers.find((x) => x.id === s.sdr_id)?.name ?? "SDR"}` : "direto"}</span>
              {canFill && <button type="button" onClick={() => void remove(s)} className="rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Apagar venda"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SdrNotes({ base, seller, day, notes }: { base: TeamBase; seller: TeamSeller; day: string; notes: TeamNote[] }) {
  const sdrs = base.sellers.filter((s) => s.role === "sdr" && (!seller.store_id || s.store_id === seller.store_id));
  const list = sdrs.map((s) => ({ s, n: notes.find((x) => x.seller_id === s.id && x.day === day) })).filter((x) => x.n?.body.trim());
  return (
    <div className="card p-4 sm:p-5">
      <h4 className="font-semibold text-white">Notas dos SDRs {day === todayIn(browserTz()) ? "hoje" : "no dia"}</h4>
      {!list.length ? <p className="mt-2 text-sm text-slate-500">Nenhuma nota ainda.</p> : (
        <div className="mt-3 space-y-3">
          {list.map(({ s, n }) => (
            <div key={s.id} className="rounded-lg border border-line bg-ink-850 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-200">{s.name}</p>
              <p className="whitespace-pre-wrap font-mono text-sm text-slate-300">{n!.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

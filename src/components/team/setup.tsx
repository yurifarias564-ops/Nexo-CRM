"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { currentPeriod, periodLabel, shiftPeriod } from "@/lib/reports/period";
import { SOURCE_LABELS, SOURCE_SHORT, SUGGESTED_METRICS, type TeamGoal, type TeamMetric, type TeamSeller, type TeamSource } from "@/lib/team";
import { browserTz, fetchGoals } from "./data";

const parseBR = (v: string) => (v.trim() === "" ? null : Number(v.trim().replace(/\./g, "").replace(",", ".")));
const showBR = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

function err(e: { message: string } | null) {
  if (e) toast.error(e.message);
  return !e;
}

export function TeamSetup({ sellers, metrics, reload }: { sellers: TeamSeller[]; metrics: TeamMetric[]; reload: () => Promise<void> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <SellersCard sellers={sellers} reload={reload} />
        <MetricsCard metrics={metrics} reload={reload} />
      </div>
      <GoalsMatrix sellers={sellers.filter((s) => s.active)} metrics={metrics.filter((m) => m.active)} />
    </div>
  );
}

function SellersCard({ sellers, reload }: { sellers: TeamSeller[]; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();
  const used = new Set(sellers.map((s) => s.user_id).filter(Boolean));

  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    const ok = err((await sb.from("team_sellers").insert({ organization_id: ws.orgId, name: n.slice(0, 80), position: sellers.length })).error);
    setBusy(false);
    if (ok) { setName(""); await reload(); }
  }
  async function patch(s: TeamSeller, p: Partial<TeamSeller>) {
    const { error } = await sb.from("team_sellers").update(p).eq("id", s.id);
    if (error) toast.error(error.code === "23505" ? "Esse login já está ligado a outra vendedora" : error.message);
    await reload();
  }
  async function remove(s: TeamSeller) {
    if (!confirm(`Excluir ${s.name} e TODO o histórico de preenchimento dela?\n\nPara só tirar do time sem perder o histórico, use "Inativar".`)) return;
    if (err((await sb.from("team_sellers").delete().eq("id", s.id)).error)) await reload();
  }

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-white">Vendedoras</h3>
      <p className="mt-0.5 text-sm text-slate-400">Ligue ao login do CRM para puxar ligações, vendas e agendamentos automaticamente — e para só ela poder preencher o próprio checklist.</p>
      <ul className="mt-4 space-y-2">
        {sellers.map((s) => (
          <li key={s.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-850 p-2", !s.active && "opacity-60")}>
            <input className="field h-9 min-w-0 flex-1" defaultValue={s.name} maxLength={80} aria-label="Nome"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void patch(s, { name: v }); }} />
            <select className="field h-9 w-40" value={s.user_id ?? ""} aria-label="Login no CRM" onChange={(e) => void patch(s, { user_id: e.target.value || null })}>
              <option value="">Sem login</option>
              {ws.members.map((m) => (
                <option key={m.user_id} value={m.user_id} disabled={used.has(m.user_id) && s.user_id !== m.user_id}>{m.full_name || m.email}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => void patch(s, { active: !s.active })}>{s.active ? "Inativar" : "Reativar"}</Button>
            <button type="button" onClick={() => void remove(s)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Excluir ${s.name}`}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="field" placeholder="Nome da vendedora" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <Button onClick={add} loading={busy} disabled={!name.trim()}><Plus className="h-4 w-4" /> Adicionar</Button>
      </div>
    </div>
  );
}

function MetricsCard({ metrics, reload }: { metrics: TeamMetric[]; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);

  async function add(m?: (typeof SUGGESTED_METRICS)[number]) {
    setBusy(true);
    const row = m ?? { name: "Novo indicador", unit: "count" as const, source: "manual" as const, daily_target: null, monthly_target: null };
    const ok = err((await sb.from("team_metrics").insert({ organization_id: ws.orgId, ...row, position: metrics.length })).error);
    setBusy(false);
    if (ok) await reload();
  }
  async function addSuggested() {
    setBusy(true);
    const ok = err((await sb.from("team_metrics").insert(SUGGESTED_METRICS.map((m, i) => ({ organization_id: ws.orgId, ...m, position: metrics.length + i })))).error);
    setBusy(false);
    if (ok) { toast.success("Indicadores criados — ajuste as metas como quiser"); await reload(); }
  }
  async function patch(m: TeamMetric, p: Partial<TeamMetric>) {
    if (err((await sb.from("team_metrics").update(p).eq("id", m.id)).error)) await reload();
  }
  async function move(i: number, dir: -1 | 1) {
    const a = metrics[i], b = metrics[i + dir];
    if (!a || !b) return;
    await Promise.all([sb.from("team_metrics").update({ position: i + dir }).eq("id", a.id), sb.from("team_metrics").update({ position: i }).eq("id", b.id)]);
    await reload();
  }
  async function remove(m: TeamMetric) {
    if (!confirm(`Excluir o indicador "${m.name}" e todo o histórico dele?\n\nPara só esconder, use "Inativar".`)) return;
    if (err((await sb.from("team_metrics").delete().eq("id", m.id)).error)) await reload();
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">Indicadores e metas padrão</h3>
          <p className="mt-0.5 text-sm text-slate-400">O que entra no checklist. A meta padrão vale para todas; ajuste por vendedora abaixo.</p>
        </div>
        {!metrics.length && <Button size="sm" variant="outline" onClick={addSuggested} loading={busy}><Sparkles className="h-3.5 w-3.5" /> Usar sugeridos</Button>}
      </div>
      <ul className="mt-4 space-y-2">
        {metrics.map((m, i) => (
          <li key={m.id} className={cn("rounded-xl border border-line bg-ink-850 p-3", !m.active && "opacity-60")}>
            <div className="flex items-center gap-2">
              <input className="field h-9 min-w-0 flex-1 font-medium" defaultValue={m.name} maxLength={80} aria-label="Nome do indicador"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) void patch(m, { name: v }); }} />
              <button type="button" disabled={i === 0} onClick={() => void move(i, -1)} className="rounded p-1.5 text-slate-500 hover:bg-ink-700 disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={i === metrics.length - 1} onClick={() => void move(i, 1)} className="rounded p-1.5 text-slate-500 hover:bg-ink-700 disabled:opacity-30" aria-label="Descer"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => void remove(m)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Excluir ${m.name}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select className="field col-span-2 h-9 sm:col-span-1" value={m.source} aria-label="Origem" title={SOURCE_LABELS[m.source]} onChange={(e) => {
                const source = e.target.value as TeamSource;
                void patch(m, { source, unit: source === "won_value" ? "money" : source === "manual" ? m.unit : "count" });
              }}>
                {(Object.keys(SOURCE_LABELS) as TeamSource[]).map((k) => <option key={k} value={k} title={SOURCE_LABELS[k]}>{SOURCE_SHORT[k]}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">dia
                <input className="field h-9" inputMode="decimal" defaultValue={showBR(m.daily_target)} placeholder="—" aria-label="Meta diária"
                  onBlur={(e) => { const v = parseBR(e.target.value); if (v === null || (Number.isFinite(v) && v >= 0)) { if (v !== m.daily_target) void patch(m, { daily_target: v }); } else toast.error("Meta inválida"); }} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">mês
                <input className="field h-9" inputMode="decimal" defaultValue={showBR(m.monthly_target)} placeholder={m.daily_target ? `ex.: ${showBR(m.daily_target * 22)}` : "—"} aria-label="Meta mensal"
                  onBlur={(e) => { const v = parseBR(e.target.value); if (v === null || (Number.isFinite(v) && v >= 0)) { if (v !== m.monthly_target) void patch(m, { monthly_target: v }); } else toast.error("Meta inválida"); }} />
              </label>
              <Button size="sm" variant="ghost" onClick={() => void patch(m, { active: !m.active })}>{m.active ? "Inativar" : "Reativar"}</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => void add()} loading={busy}><Plus className="h-3.5 w-3.5" /> Novo indicador</Button>
    </div>
  );
}

/** Metas individuais do mês (vazio = usa a meta padrão do indicador). */
function GoalsMatrix({ sellers, metrics }: { sellers: TeamSeller[]; metrics: TeamMetric[] }) {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const [period, setPeriod] = useState(() => currentPeriod(browserTz()));
  const [vals, setVals] = useState<{ period: string; map: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);

  const toMap = (g: TeamGoal[]) => Object.fromEntries(g.flatMap((x) => [
    [`${x.seller_id}:${x.metric_id}:d`, showBR(x.daily_target === null ? null : Number(x.daily_target))],
    [`${x.seller_id}:${x.metric_id}:m`, showBR(x.monthly_target === null ? null : Number(x.monthly_target))],
  ]));

  useEffect(() => {
    let alive = true;
    void fetchGoals(ws.orgId, period).then((g) => { if (alive) setVals({ period, map: toMap(g) }); });
    return () => { alive = false; };
  }, [ws.orgId, period]);

  async function copyPrevious() {
    const g = await fetchGoals(ws.orgId, shiftPeriod(period, -1));
    if (!g.length) return toast.info("O mês anterior não tem metas individuais");
    setVals({ period, map: toMap(g) });
    toast.success("Metas copiadas — confira e salve");
  }

  async function save() {
    if (!vals) return;
    const rows: object[] = [];
    const clear: { seller_id: string; metric_id: string }[] = [];
    for (const s of sellers) for (const m of metrics) {
      const d = parseBR(vals.map[`${s.id}:${m.id}:d`] ?? "");
      const mo = parseBR(vals.map[`${s.id}:${m.id}:m`] ?? "");
      if ((d !== null && !(Number.isFinite(d) && d >= 0)) || (mo !== null && !(Number.isFinite(mo) && mo >= 0))) return toast.error(`Meta inválida: ${s.name} · ${m.name}`);
      if (d === null && mo === null) clear.push({ seller_id: s.id, metric_id: m.id });
      else rows.push({ organization_id: ws.orgId, seller_id: s.id, metric_id: m.id, period: `${period}-01`, daily_target: d, monthly_target: mo, updated_at: new Date().toISOString() });
    }
    setSaving(true);
    const sb = supabaseBrowser();
    const res = await Promise.all([
      rows.length ? sb.from("team_goals").upsert(rows, { onConflict: "seller_id,metric_id,period" }) : Promise.resolve({ error: null }),
      ...clear.map((c) => sb.from("team_goals").delete().eq("seller_id", c.seller_id).eq("metric_id", c.metric_id).eq("period", `${period}-01`)),
    ]);
    setSaving(false);
    const e = res.find((r) => r.error)?.error;
    if (e) return toast.error(e.message);
    toast.success(`Metas de ${periodLabel(period)} salvas`);
  }

  if (!sellers.length || !metrics.length) return null;
  const thisMonth = currentPeriod(tz);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="font-semibold text-white">Metas por vendedora</h3>
          <p className="mt-0.5 text-sm text-slate-400">Deixe vazio para usar a meta padrão (aparece em cinza).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={copyPrevious}><Copy className="h-3.5 w-3.5" /> Copiar do mês anterior</Button>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-850 p-1">
            <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, -1))} className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-700" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="flex min-w-[150px] items-center justify-center gap-1.5 text-sm font-medium text-white"><CalendarRange className="h-4 w-4 text-brand-300" />{periodLabel(period)}</span>
            <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, 1))} disabled={period > thisMonth} className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-700 disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      {vals?.period !== period ? <div className="flex h-32 items-center justify-center"><Spinner /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5 font-medium">Vendedora</th>
                {metrics.map((m) => <th key={m.id} className="px-3 py-2.5 font-medium">{m.name}<span className="block text-[10px] normal-case tracking-normal text-slate-600">dia · mês</span></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((s) => (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5 font-medium text-slate-100">{s.name}</td>
                  {metrics.map((m) => (
                    <td key={m.id} className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {(["d", "m"] as const).map((kind) => {
                          const k = `${s.id}:${m.id}:${kind}`;
                          const def = kind === "d" ? m.daily_target : m.monthly_target;
                          return (
                            <input key={kind} className="field h-8 w-[4.5rem] px-2 text-center text-xs" inputMode="decimal"
                              aria-label={`${s.name} ${m.name} meta ${kind === "d" ? "diária" : "mensal"}`}
                              placeholder={def === null ? "—" : showBR(def)} value={vals.map[k] ?? ""}
                              onChange={(e) => setVals((v) => v && ({ ...v, map: { ...v.map, [k]: e.target.value } }))} />
                          );
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end border-t border-line px-5 py-3"><Button onClick={save} loading={saving}>Salvar metas do mês</Button></div>
    </div>
  );
}

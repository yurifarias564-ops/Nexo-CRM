"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Target, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { formatBRL } from "@/lib/utils";
import { shiftPeriod } from "@/lib/reports/period";
import { GOALS } from "./shared";

type Actuals = Record<string, number>;

/** "1.500,50" → 1500.5 (formato brasileiro) */
const parseBR = (v: string) => Number(v.trim().replace(/\./g, "").replace(",", "."));

/** Metas do mês com o realizado até agora + comentários do consultor. */
export function GoalsCard({ period, actuals, loadingActuals }: { period: string; actuals: Actuals | null; loadingActuals: boolean }) {
  const ws = useWorkspace();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("monthly_goals").select("metric, target").eq("organization_id", ws.orgId).eq("period", `${period}-01`),
      sb.from("report_notes").select("notes").eq("organization_id", ws.orgId).eq("period", `${period}-01`).maybeSingle(),
    ]).then(([g, n]) => {
      if (!alive) return;
      setTargets(Object.fromEntries((g.data ?? []).map((r) => [r.metric, String(Number(r.target)).replace(".", ",")])));
      setNotes(n.data?.notes ?? "");
      setLoaded(period);
    });
    return () => { alive = false; };
  }, [period, ws.orgId]);

  async function copyPrevious() {
    const { data } = await supabaseBrowser().from("monthly_goals").select("metric, target").eq("organization_id", ws.orgId).eq("period", `${shiftPeriod(period, -1)}-01`);
    if (!data?.length) return toast.info("O mês anterior não tem metas cadastradas");
    setTargets(Object.fromEntries(data.map((r) => [r.metric, String(Number(r.target)).replace(".", ",")])));
    toast.success("Metas copiadas — confira e salve");
  }

  async function saveGoals() {
    const rows: { organization_id: string; period: string; metric: string; target: number; updated_at: string }[] = [];
    const remove: string[] = [];
    for (const g of GOALS) {
      const raw = (targets[g.metric] ?? "").trim();
      if (!raw) { remove.push(g.metric); continue; }
      const n = parseBR(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return toast.error(`Meta inválida em "${g.label}"`);
      if (n === 0) remove.push(g.metric);
      else rows.push({ organization_id: ws.orgId, period: `${period}-01`, metric: g.metric, target: n, updated_at: new Date().toISOString() });
    }
    setSaving(true);
    const sb = supabaseBrowser();
    const [a, b] = await Promise.all([
      rows.length ? sb.from("monthly_goals").upsert(rows, { onConflict: "organization_id,period,metric" }) : Promise.resolve({ error: null }),
      remove.length ? sb.from("monthly_goals").delete().eq("organization_id", ws.orgId).eq("period", `${period}-01`).in("metric", remove) : Promise.resolve({ error: null }),
    ]);
    setSaving(false);
    if (a.error || b.error) return toast.error((a.error ?? b.error)!.message);
    toast.success("Metas salvas");
  }

  async function saveNotes() {
    setSavingNotes(true);
    const { error } = await supabaseBrowser().from("report_notes").upsert(
      { organization_id: ws.orgId, period: `${period}-01`, notes: notes.slice(0, 5000), updated_by: ws.userId, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,period" },
    );
    setSavingNotes(false);
    if (error) return toast.error(error.message);
    toast.success("Comentários salvos");
  }

  if (loaded !== period) return <div className="card flex h-48 items-center justify-center"><Spinner /></div>;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-brand-300" />
          <h3 className="font-semibold text-white">Metas do mês</h3>
        </div>
        {ws.canManage && (
          <Button size="sm" variant="ghost" onClick={copyPrevious}><Copy className="h-3.5 w-3.5" /> Copiar do mês anterior</Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {GOALS.map((g) => {
          const target = parseBR(targets[g.metric] ?? "") || 0;
          const actual = actuals?.[g.metric] ?? 0;
          const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
          const hit = target > 0 && actual >= target;
          return (
            <div key={g.metric} className="rounded-xl border border-line bg-ink-850 p-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`goal-${g.metric}`} className="text-sm font-medium text-slate-200" title={g.hint}>{g.label}</label>
                {target > 0 && (hit
                  ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Batida</span>
                  : <span className="flex items-center gap-1 text-xs text-slate-500"><XCircle className="h-3.5 w-3.5" /> {pct}%</span>)}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input id={`goal-${g.metric}`} className="field h-9" inputMode="decimal" placeholder="Sem meta" disabled={!ws.canManage}
                  value={targets[g.metric] ?? ""} onChange={(e) => setTargets((t) => ({ ...t, [g.metric]: e.target.value }))} />
                <span className="w-28 shrink-0 text-right text-xs text-slate-400">
                  {loadingActuals ? "…" : <>realizado <b className="text-slate-200">{g.money ? formatBRL(actual) : actual.toLocaleString("pt-BR")}</b></>}
                </span>
              </div>
              {target > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div className={`h-full rounded-full ${hit ? "bg-emerald-400" : "bg-brand-400"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {ws.canManage && <div className="mt-4 flex justify-end"><Button size="sm" onClick={saveGoals} loading={saving}>Salvar metas</Button></div>}

      <div className="mt-6 border-t border-line pt-5">
        <label htmlFor="report-notes" className="label">Comentários do mês (entram no relatório)</label>
        <textarea id="report-notes" className="field min-h-[96px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000}
          placeholder="Ex.: campanha do Instagram pausada dia 10; equipe reduzida na 2ª quinzena; cliente pediu foco em follow-up." />
        <p className="mt-1 text-xs text-slate-500">A IA usa estes comentários para explicar por que as metas foram ou não batidas.</p>
        <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" onClick={saveNotes} loading={savingNotes}>Salvar comentários</Button></div>
      </div>
    </div>
  );
}

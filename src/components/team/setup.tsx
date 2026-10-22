"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  METRIC_KITS, metricApplies, parseBRL, ROLE_LABEL, SOURCE_LABELS, SOURCE_SHORT, WORKDAYS_MONTH, WORKDAYS_WEEK,
  type MetricRole, type TeamMetric, type TeamRole, type TeamSeller, type TeamSource, type TeamStore,
} from "@/lib/team";
import type { TeamBase } from "./data";

const showN = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const okErr = (e: { message: string; code?: string } | null, msg?: Record<string, string>) => {
  if (e) toast.error((e.code && msg?.[e.code]) || e.message);
  return !e;
};

function Section({ title, text, action, children }: { title: string; text?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-semibold text-white">{title}</h3>{text && <p className="mt-0.5 text-sm text-slate-400">{text}</p>}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function TeamSetup({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  return (
    <div className="space-y-6">
      {!base.metrics.length && <Kits reload={reload} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <People base={base} reload={reload} />
        <Stores base={base} reload={reload} />
      </div>
      {base.metrics.length > 0 && <Metrics base={base} reload={reload} />}
      {base.metrics.length > 0 && base.sellers.some((s) => s.active) && <IndividualGoals base={base} reload={reload} />}
      {base.metrics.length > 0 && <CycleBaseline base={base} reload={reload} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- modelos prontos

function Kits({ reload }: { reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  async function apply(kitId: string) {
    const kit = METRIC_KITS.find((k) => k.id === kitId)!;
    setBusy(kitId);
    const sb = supabaseBrowser();
    let pos = 0;
    for (const m of kit.metrics) {
      const { results, ...row } = m;
      const { data, error } = await sb.from("team_metrics").insert({ organization_id: ws.orgId, ...row, position: pos++ }).select("id").single();
      if (!okErr(error) || !data) { setBusy(null); return; }
      for (const r of results ?? []) {
        const res = await sb.from("team_metrics").insert({ organization_id: ws.orgId, name: r, unit: "count", source: "manual", role: m.role, result_of: data.id, position: pos++ });
        if (!okErr(res.error)) { setBusy(null); return; }
      }
    }
    setBusy(null);
    toast.success("Indicadores criados — ajuste as metas como quiser");
    await reload();
  }
  return (
    <Section title="Comece por um modelo" text="Cria os indicadores e metas padrão de uma vez. Tudo pode ser editado depois.">
      <div className="grid gap-3 sm:grid-cols-2">
        {METRIC_KITS.map((k) => (
          <button key={k.id} type="button" onClick={() => void apply(k.id)} disabled={!!busy}
            className="rounded-xl border border-line bg-ink-850 p-4 text-left transition hover:border-brand-400/50 disabled:opacity-50">
            <p className="flex items-center gap-2 font-medium text-white"><Sparkles className="h-4 w-4 text-brand-300" />{k.title}</p>
            <p className="mt-1 text-sm text-slate-400">{k.text}</p>
            {busy === k.id && <p className="mt-2 text-xs text-brand-200">Criando…</p>}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- pessoas

function People({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const sb = supabaseBrowser();
  const [name, setName] = useState("");
  const [role, setRole] = useState<TeamRole | "">("");
  const [busy, setBusy] = useState(false);
  const used = new Set(base.sellers.map((s) => s.user_id).filter(Boolean));

  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    const ok = okErr((await sb.from("team_sellers").insert({ organization_id: ws.orgId, name: n.slice(0, 80), role: role || null, store_id: base.stores.length === 1 ? base.stores[0]!.id : null, position: base.sellers.length })).error);
    setBusy(false);
    if (ok) { setName(""); await reload(); }
  }
  async function patch(s: TeamSeller, p: Partial<TeamSeller>) {
    okErr((await sb.from("team_sellers").update(p).eq("id", s.id)).error, { "23505": "Esse login já está ligado a outra pessoa" });
    await reload();
  }
  async function remove(s: TeamSeller) {
    if (!confirm(`Excluir ${s.name} e TODO o histórico (checklists, OS e notas)?\n\nPara só tirar do time sem perder o histórico, use "Inativar".`)) return;
    if (okErr((await sb.from("team_sellers").delete().eq("id", s.id)).error)) await reload();
  }

  return (
    <Section title="Pessoas" text="Função define quais metas aparecem no checklist. Ligar ao login do CRM faz só ela preencher o próprio checklist e puxa ligações/vendas do CRM.">
      <ul className="space-y-2">
        {base.sellers.map((s) => (
          <li key={s.id} className={cn("rounded-xl border border-line bg-ink-850 p-2.5", !s.active && "opacity-60")}>
            <div className="flex items-center gap-2">
              <input className="field h-9 min-w-0 flex-1 font-medium" defaultValue={s.name} maxLength={80} aria-label="Nome"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void patch(s, { name: v }); }} />
              <Button size="sm" variant="ghost" onClick={() => void patch(s, { active: !s.active })}>{s.active ? "Inativar" : "Reativar"}</Button>
              <button type="button" onClick={() => void remove(s)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Excluir ${s.name}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <select className="field h-9 text-sm" value={s.role ?? ""} aria-label="Função" onChange={(e) => void patch(s, { role: (e.target.value || null) as TeamRole | null })}>
                <option value="">Sem função</option><option value="sdr">SDR</option><option value="closer">Closer</option>
              </select>
              <select className="field h-9 text-sm" value={s.store_id ?? ""} aria-label="Loja" onChange={(e) => void patch(s, { store_id: e.target.value || null })}>
                <option value="">Sem loja</option>{base.stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
              <select className="field h-9 text-sm" value={s.user_id ?? ""} aria-label="Login no CRM" onChange={(e) => void patch(s, { user_id: e.target.value || null })}>
                <option value="">Sem login</option>
                {ws.members.map((m) => <option key={m.user_id} value={m.user_id} disabled={used.has(m.user_id) && s.user_id !== m.user_id}>{m.full_name || m.email}</option>)}
              </select>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="field" placeholder="Nome" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <select className="field w-32" value={role} onChange={(e) => setRole(e.target.value as TeamRole | "")} aria-label="Função da nova pessoa">
          <option value="">Função…</option><option value="sdr">SDR</option><option value="closer">Closer</option>
        </select>
        <Button onClick={add} loading={busy} disabled={!name.trim()}><Plus className="h-4 w-4" /></Button>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- lojas

function Stores({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const sb = supabaseBrowser();
  const [name, setName] = useState("");
  async function add() {
    const n = name.trim();
    if (!n) return;
    if (okErr((await sb.from("team_stores").insert({ organization_id: ws.orgId, name: n.slice(0, 60), position: base.stores.length })).error)) { setName(""); await reload(); }
  }
  async function patch(st: TeamStore, p: Partial<TeamStore>) {
    if (okErr((await sb.from("team_stores").update(p).eq("id", st.id)).error)) await reload();
  }
  async function remove(st: TeamStore) {
    if (!confirm(`Excluir a loja ${st.name}? As pessoas e OS ficam sem loja.`)) return;
    if (okErr((await sb.from("team_stores").delete().eq("id", st.id)).error)) await reload();
  }
  const money = (st: TeamStore, raw: string, field: "revenue_goal" | "os_daily_goal") => {
    const v = raw.trim() ? parseBRL(raw) : null;
    if (raw.trim() && (v === null || v < 0)) return toast.error("Valor inválido");
    if (v !== st[field]) void patch(st, { [field]: v } as Partial<TeamStore>);
  };
  return (
    <Section title="Lojas" text={`Meta de faturamento do ${base.settings.cycle_start ? "ciclo (30 dias)" : "mês"} e meta de OS por dia. Opcional — use se a empresa tem mais de uma unidade ou meta de faturamento.`}>
      {base.stores.length > 0 && (
        <ul className="space-y-2">
          {base.stores.map((st) => (
            <li key={st.id} className="grid grid-cols-[minmax(0,1fr)_7.5rem_5rem_auto] items-center gap-2 rounded-xl border border-line bg-ink-850 p-2.5">
              <input className="field h-9 font-medium" defaultValue={st.name} maxLength={60} aria-label="Nome da loja" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== st.name) void patch(st, { name: v }); }} />
              <input className="field h-9 text-sm" inputMode="decimal" defaultValue={showN(st.revenue_goal)} placeholder="Meta R$" aria-label="Meta de faturamento" onBlur={(e) => money(st, e.target.value, "revenue_goal")} />
              <input className="field h-9 text-sm" inputMode="decimal" defaultValue={showN(st.os_daily_goal)} placeholder="OS/dia" aria-label="Meta de OS por dia" onBlur={(e) => money(st, e.target.value, "os_daily_goal")} />
              <button type="button" onClick={() => void remove(st)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Excluir ${st.name}`}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input className="field" placeholder="Nome da loja (ex.: Matriz)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <Button variant="secondary" onClick={add} disabled={!name.trim()}><Plus className="h-4 w-4" /> Loja</Button>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- indicadores

function Metrics({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const sb = supabaseBrowser();
  const metrics = base.metrics;
  const parents = metrics.filter((m) => !m.result_of && m.source === "manual");

  async function patch(m: TeamMetric, p: Partial<TeamMetric>) {
    if (okErr((await sb.from("team_metrics").update(p).eq("id", m.id)).error)) await reload();
  }
  async function add(resultOf?: TeamMetric) {
    const row = resultOf
      ? { name: "Resultado", unit: "count", source: "manual", role: resultOf.role, result_of: resultOf.id }
      : { name: "Nova atividade", unit: "count", source: "manual", role: "todos" };
    if (okErr((await sb.from("team_metrics").insert({ organization_id: ws.orgId, ...row, position: metrics.length })).error)) await reload();
  }
  async function move(i: number, dir: -1 | 1) {
    const a = metrics[i], b = metrics[i + dir];
    if (!a || !b) return;
    await Promise.all([sb.from("team_metrics").update({ position: i + dir }).eq("id", a.id), sb.from("team_metrics").update({ position: i }).eq("id", b.id)]);
    await reload();
  }
  async function remove(m: TeamMetric) {
    if (!confirm(`Excluir "${m.name}" e todo o histórico dele${resultsCount(m) ? " (e os resultados ligados)" : ""}?\n\nPara só esconder, use "Inativar".`)) return;
    if (okErr((await sb.from("team_metrics").delete().eq("id", m.id)).error)) await reload();
  }
  const resultsCount = (m: TeamMetric) => metrics.filter((x) => x.result_of === m.id).length;
  const target = (m: TeamMetric, raw: string, field: "daily_target" | "weekly_target" | "monthly_target") => {
    const v = raw.trim() ? parseBRL(raw) : null;
    if (raw.trim() && (v === null || v < 0)) return toast.error("Meta inválida");
    if (v !== m[field]) void patch(m, { [field]: v } as Partial<TeamMetric>);
  };

  return (
    <Section title="Metas do checklist" text={`Atividades preenchidas com + e −, resultados (para a conversão) e indicadores automáticos. Semana e mês vazios = diária × ${WORKDAYS_WEEK} e × ${WORKDAYS_MONTH} dias úteis.`}
      action={<Button size="sm" variant="secondary" onClick={() => void add()}><Plus className="h-3.5 w-3.5" /> Atividade</Button>}>
      <ul className="space-y-2">
        {metrics.map((m, i) => {
          const isResult = !!m.result_of;
          return (
            <li key={m.id} className={cn("rounded-xl border border-line bg-ink-850 p-3", !m.active && "opacity-60", isResult && "ml-6 border-dashed")}>
              <div className="flex items-center gap-2">
                {isResult && <span className="text-slate-500">↳</span>}
                <input className="field h-9 min-w-0 flex-1 font-medium" defaultValue={m.name} maxLength={80} aria-label="Nome"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) void patch(m, { name: v }); }} />
                <button type="button" disabled={i === 0} onClick={() => void move(i, -1)} className="rounded p-1.5 text-slate-500 hover:bg-ink-700 disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={i === metrics.length - 1} onClick={() => void move(i, 1)} className="rounded p-1.5 text-slate-500 hover:bg-ink-700 disabled:opacity-30" aria-label="Descer"><ArrowDown className="h-4 w-4" /></button>
                <Button size="sm" variant="ghost" onClick={() => void patch(m, { active: !m.active })}>{m.active ? "Inativar" : "Reativar"}</Button>
                <button type="button" onClick={() => void remove(m)} className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Excluir ${m.name}`}><Trash2 className="h-4 w-4" /></button>
              </div>
              {isResult ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  Resultado de
                  <select className="field h-8 w-auto py-0 text-xs" value={m.result_of ?? ""} aria-label="Resultado de" onChange={(e) => void patch(m, { result_of: e.target.value })}>
                    {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <span>— conta para a conversão (resultado ÷ feito). Não tem meta própria.</span>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[7rem_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
                  <select className="field h-9 text-sm" value={m.role} aria-label="Função" onChange={(e) => void patch(m, { role: e.target.value as MetricRole })}>
                    <option value="todos">Todos</option><option value="sdr">SDR</option><option value="closer">Closer</option>
                  </select>
                  <select className="field h-9 text-sm" value={m.source} aria-label="Origem" title={SOURCE_LABELS[m.source]} disabled={resultsCount(m) > 0}
                    onChange={(e) => { const source = e.target.value as TeamSource; void patch(m, { source, unit: source.endsWith("_value") ? "money" : source === "manual" ? m.unit : "count" }); }}>
                    {(Object.keys(SOURCE_SHORT) as TeamSource[]).map((k) => <option key={k} value={k} title={SOURCE_LABELS[k]}>{SOURCE_SHORT[k]}</option>)}
                  </select>
                  {(["daily_target", "weekly_target", "monthly_target"] as const).map((f) => (
                    <label key={f} className="flex items-center gap-1 text-[11px] text-slate-500">{f === "daily_target" ? "dia" : f === "weekly_target" ? "sem" : "mês"}
                      <input className="field h-9 px-2 text-sm" inputMode="decimal" defaultValue={showN(m[f])} aria-label={`Meta ${f}`}
                        placeholder={f === "daily_target" ? "—" : m.daily_target ? showN(m.daily_target * (f === "weekly_target" ? WORKDAYS_WEEK : WORKDAYS_MONTH)) : "—"}
                        onBlur={(e) => target(m, e.target.value, f)} />
                    </label>
                  ))}
                </div>
              )}
              {!isResult && m.source === "manual" && (
                <button type="button" onClick={() => void add(m)} className="mt-2 text-xs font-medium text-brand-300 hover:text-brand-200">+ resultado desta atividade (conversão)</button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ----------------------------------------------------------------------------- metas individuais

function IndividualGoals({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const people = base.sellers.filter((s) => s.active);
  const cols = base.metrics.filter((m) => m.active && !m.result_of);
  const init = () => Object.fromEntries(base.goals.flatMap((g) => [
    [`${g.seller_id}:${g.metric_id}:d`, showN(g.daily_target)], [`${g.seller_id}:${g.metric_id}:w`, showN(g.weekly_target)], [`${g.seller_id}:${g.metric_id}:m`, showN(g.monthly_target)],
  ]));
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [saving, setSaving] = useState(false);

  async function save() {
    const rows: object[] = [];
    const clear: { s: string; m: string }[] = [];
    for (const s of people) for (const m of cols) {
      if (!metricApplies(m, s)) continue;
      const read = (k: string) => { const r = vals[`${s.id}:${m.id}:${k}`] ?? ""; return r.trim() ? parseBRL(r) : null; };
      const d = read("d"), w = read("w"), mo = read("m");
      if ([d, w, mo].some((x) => x !== null && x < 0)) return toast.error(`Meta inválida: ${s.name} · ${m.name}`);
      if (d === null && w === null && mo === null) clear.push({ s: s.id, m: m.id });
      else rows.push({ organization_id: ws.orgId, seller_id: s.id, metric_id: m.id, daily_target: d, weekly_target: w, monthly_target: mo, updated_at: new Date().toISOString() });
    }
    setSaving(true);
    const sb = supabaseBrowser();
    const res = await Promise.all([
      rows.length ? sb.from("team_seller_goals").upsert(rows, { onConflict: "seller_id,metric_id" }) : Promise.resolve({ error: null }),
      ...clear.filter((c) => base.goals.some((g) => g.seller_id === c.s && g.metric_id === c.m)).map((c) => sb.from("team_seller_goals").delete().eq("seller_id", c.s).eq("metric_id", c.m)),
    ]);
    setSaving(false);
    const e = res.find((r) => r.error)?.error;
    if (e) return toast.error(e.message);
    toast.success("Metas individuais salvas");
    await reload();
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h3 className="font-semibold text-white">Meta de cada pessoa</h3>
        <p className="mt-0.5 text-sm text-slate-400">Ex.: Alison 25 ligações/dia, Victor 20. Vazio = meta padrão (em cinza). Cada célula: dia · semana · mês.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5 font-medium">Pessoa</th>
            {cols.map((m) => <th key={m.id} className="px-3 py-2.5 font-medium">{m.name}{m.role !== "todos" && <span className="ml-1 text-[10px] text-slate-600">{ROLE_LABEL[m.role]}</span>}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {people.map((s) => (
              <tr key={s.id}>
                <td className="sticky left-0 z-10 bg-ink-900 px-5 py-2.5"><p className="font-medium text-slate-100">{s.name}</p><p className="text-[11px] text-slate-500">{s.role ? ROLE_LABEL[s.role] : "sem função"}</p></td>
                {cols.map((m) => (
                  <td key={m.id} className="px-3 py-2.5">
                    {!metricApplies(m, s) ? <span className="text-slate-700">—</span> : (
                      <div className="flex gap-1">
                        {(["d", "w", "m"] as const).map((k) => {
                          const def = k === "d" ? m.daily_target : k === "w" ? m.weekly_target ?? (m.daily_target ? m.daily_target * WORKDAYS_WEEK : null) : m.monthly_target ?? (m.daily_target ? m.daily_target * WORKDAYS_MONTH : null);
                          const key = `${s.id}:${m.id}:${k}`;
                          return <input key={k} className="field h-8 w-16 px-1.5 text-center text-xs" inputMode="decimal" aria-label={`${s.name} ${m.name} ${k}`}
                            placeholder={def === null ? "—" : showN(def)} value={vals[key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))} />;
                        })}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3"><Button onClick={save} loading={saving}>Salvar metas</Button></div>
    </div>
  );
}

// ----------------------------------------------------------------------------- ciclo e marco zero

function CycleBaseline({ base, reload }: { base: TeamBase; reload: () => Promise<void> }) {
  const ws = useWorkspace();
  const [start, setStart] = useState(base.settings.cycle_start ?? "");
  const [bl, setBl] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(base.settings.baseline).map(([k, v]) => [k, showN(Number(v))])));
  const [note, setNote] = useState(base.settings.baseline_note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const baseline: Record<string, number> = {};
    for (const [k, raw] of Object.entries(bl)) {
      if (!raw.trim()) continue;
      const v = parseBRL(raw);
      if (v === null || v < 0) return toast.error("Valor do marco zero inválido");
      baseline[k] = v;
    }
    setBusy(true);
    const { error } = await supabaseBrowser().from("team_settings").upsert(
      { organization_id: ws.orgId, cycle_start: start || null, baseline, baseline_note: note.trim().slice(0, 2000) || null, updated_at: new Date().toISOString() },
      { onConflict: "organization_id" },
    );
    setBusy(false);
    if (!okErr(error)) return;
    toast.success("Configuração salva");
    await reload();
  }

  return (
    <Section title="Consultoria: início e marco zero" text="Com a data de início, o acompanhamento passa a ser por ciclos de 30 dias (Ciclo 1, 2, 3). O marco zero é como a empresa estava antes — base do “antes x depois”.">
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <label className="block"><span className="label">Início da consultoria</span>
            <input type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <p className="text-xs text-slate-500">Vazio = meses do calendário (1º ao último dia).</p>
          <label className="block"><span className="label">Observação do marco zero</span>
            <textarea className="field min-h-[90px] text-sm" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: antes não havia registro de ligações; 11 vendas no CRM em setembro." /></label>
        </div>
        <div>
          <span className="label">Marco zero (total de um mês antes da consultoria)</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {base.metrics.filter((m) => m.active).map((m) => (
              <label key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-850 px-3 py-1.5 text-sm text-slate-300">
                <span className="truncate">{m.result_of ? "↳ " : ""}{m.name}</span>
                <input className="field h-8 w-28 text-right text-sm" inputMode="decimal" placeholder="—" value={bl[m.id] ?? ""} onChange={(e) => setBl((b) => ({ ...b, [m.id]: e.target.value }))} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={save} loading={busy}>Salvar</Button></div>
    </Section>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Hourglass, KanbanSquare, Search, Tag as TagIcon, UserPlus, X } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { IDLE_MAX, idleLabel, type Audience, type Idle, type IdleUnit } from "@/lib/broadcasts";

export type PickedLead = { id: string; name: string; phone: string | null };
type Section = "tags" | "stages" | "idle" | "leads";

const IDLE_PRESETS: Idle[] = [
  { amount: 3, unit: "day" }, { amount: 7, unit: "day" }, { amount: 15, unit: "day" }, { amount: 30, unit: "day" },
  { amount: 60, unit: "day" }, { amount: 90, unit: "day" }, { amount: 6, unit: "month" }, { amount: 12, unit: "month" },
];
const UNIT_LABEL: Record<IdleUnit, string> = { day: "dias", week: "semanas", month: "meses" };
const sameIdle = (a: Idle | null, b: Idle | null) => !!a && !!b && a.amount === b.amount && a.unit === b.unit;
const presetLabel = (i: Idle) => (i.unit === "month" && i.amount === 12 ? "1 ano" : idleLabel(i));

export function AudienceBuilder({ aud, setAud, picked, setPicked }: {
  aud: Audience; setAud: (fn: (a: Audience) => Audience) => void;
  picked: PickedLead[]; setPicked: (fn: (p: PickedLead[]) => PickedLead[]) => void;
}) {
  const ws = useWorkspace();
  const [open, setOpen] = useState<Section | null>("tags");
  const [tagQ, setTagQ] = useState("");
  const isCustom = aud.idle !== null && !IDLE_PRESETS.some((p) => sameIdle(p, aud.idle));
  const [custom, setCustom] = useState<{ amount: string; unit: IdleUnit }>({ amount: isCustom ? String(aud.idle!.amount) : "", unit: isCustom ? aud.idle!.unit : "day" });

  const pipes = useMemo(() => ws.pipelines.map((p) => ({ p, stages: ws.stages.filter((s) => s.pipeline_id === p.id).sort((a, b) => a.position - b.position) })), [ws.pipelines, ws.stages]);
  const tags = useMemo(() => {
    const q = tagQ.trim().toLowerCase();
    return q ? ws.tags.filter((t) => t.name.toLowerCase().includes(q)) : ws.tags;
  }, [ws.tags, tagQ]);

  const toggle = (list: "tagIds" | "stageIds", id: string) =>
    setAud((a) => ({ ...a, [list]: a[list].includes(id) ? a[list].filter((x) => x !== id) : [...a[list], id] }));
  const setStages = (ids: string[], on: boolean) =>
    setAud((a) => ({ ...a, stageIds: on ? [...new Set([...a.stageIds, ...ids])] : a.stageIds.filter((x) => !ids.includes(x)) }));
  function applyCustom(next: { amount: string; unit: IdleUnit }) {
    setCustom(next);
    const n = Math.floor(Number(next.amount));
    setAud((a) => ({ ...a, idle: n >= 1 && n <= IDLE_MAX[next.unit] ? { amount: n, unit: next.unit } : null }));
  }
  const removeLead = (id: string) => { setPicked((p) => p.filter((x) => x.id !== id)); setAud((a) => ({ ...a, leadIds: a.leadIds.filter((x) => x !== id) })); };

  const active = [
    ...aud.tagIds.map((id) => ({ key: `t${id}`, label: ws.tagById.get(id)?.name ?? "Tag", color: ws.tagById.get(id)?.color, kind: "Tag", off: () => toggle("tagIds", id) })),
    ...aud.stageIds.map((id) => ({ key: `s${id}`, label: ws.stageById.get(id)?.name ?? "Etapa", color: ws.stageById.get(id)?.color, kind: "Etapa", off: () => toggle("stageIds", id) })),
    ...(aud.idle ? [{ key: "idle", label: `+ de ${idleLabel(aud.idle)}`, color: undefined, kind: "Sem interação", off: () => setAud((a) => ({ ...a, idle: null })) }] : []),
    ...picked.map((l) => ({ key: `l${l.id}`, label: l.name, color: undefined, kind: "Lead", off: () => removeLead(l.id) })),
  ];
  const clearAll = () => { setAud((a) => ({ ...a, tagIds: [], stageIds: [], idle: null, leadIds: [] })); setPicked(() => []); setCustom({ amount: "", unit: "day" }); };

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Quem vai receber</p>
          <p className="mt-0.5 text-xs text-slate-400">Combine os filtros: o lead precisa atender a todos os que você usar.</p>
        </div>
        {active.length > 0 && <button onClick={clearAll} className="shrink-0 text-xs text-slate-400 hover:text-white">Limpar tudo</button>}
      </div>

      {active.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 rounded-xl border border-line bg-ink-850 p-2">
          {active.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg bg-ink-700/70 py-1 pl-2 pr-1 text-xs text-slate-200">
              <span className="text-slate-500">{f.kind}:</span>
              {f.color && <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />}
              <span className="max-w-[160px] truncate">{f.label}</span>
              <button onClick={f.off} className="rounded p-0.5 text-slate-500 hover:bg-ink-600 hover:text-white" aria-label={`Remover ${f.label}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        <Row id="tags" open={open} setOpen={setOpen} icon={TagIcon} title="Tags" hint="Tem pelo menos uma das tags" count={aud.tagIds.length} unit={["tag", "tags"]}>
          {!ws.tags.length ? <p className="text-sm text-slate-500">Nenhuma tag criada ainda.</p> : (
            <>
              {ws.tags.length > 8 && (
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input className="field pl-9" placeholder="Buscar tag" value={tagQ} onChange={(e) => setTagQ(e.target.value)} />
                </div>
              )}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {tags.map((t) => <Check2 key={t.id} on={aud.tagIds.includes(t.id)} onClick={() => toggle("tagIds", t.id)} color={t.color} label={t.name} />)}
              </div>
              {!tags.length && <p className="text-sm text-slate-500">Nenhuma tag com esse nome.</p>}
            </>
          )}
        </Row>

        <Row id="stages" open={open} setOpen={setOpen} icon={KanbanSquare} title="Etapa do funil" hint="Está em uma das etapas" count={aud.stageIds.length} unit={["etapa", "etapas"]}>
          <div className="space-y-4">
            {pipes.map(({ p, stages }) => {
              const ids = stages.map((s) => s.id);
              const all = ids.length > 0 && ids.every((id) => aud.stageIds.includes(id));
              return (
                <div key={p.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.name}</p>
                    <button onClick={() => setStages(ids, !all)} className="text-xs text-brand-300 hover:text-brand-200">{all ? "Desmarcar todas" : "Marcar todas"}</button>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {stages.map((s) => (
                      <Check2 key={s.id} on={aud.stageIds.includes(s.id)} onClick={() => toggle("stageIds", s.id)} color={s.color} label={s.name}
                        extra={s.kind === "won" ? "Ganho" : s.kind === "lost" ? "Perdido" : undefined} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Row>

        <Row id="idle" open={open} setOpen={setOpen} icon={Hourglass} title="Tempo sem interação" hint="Sem mensagem e sem mudar de etapa"
          summary={aud.idle ? `+ de ${idleLabel(aud.idle)}` : undefined}>
          <p className="mb-2 text-xs text-slate-400">Sem interação há mais de:</p>
          <div className="grid grid-cols-4 gap-1.5">
            {IDLE_PRESETS.map((p) => {
              const on = sameIdle(p, aud.idle);
              return (
                <button key={presetLabel(p)} onClick={() => { setAud((a) => ({ ...a, idle: on ? null : p })); setCustom({ amount: "", unit: "day" }); }}
                  className={cn("rounded-lg border px-2 py-2 text-xs font-medium transition", on ? "border-brand-400/60 bg-brand-500/15 text-white" : "border-line text-slate-300 hover:bg-ink-800")}>
                  {presetLabel(p)}
                </button>
              );
            })}
          </div>
          <div className={cn("mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-2", isCustom ? "border-brand-400/60 bg-brand-500/10" : "border-line")}>
            <span className="text-xs text-slate-400">Personalizado:</span>
            <input type="number" min={1} max={IDLE_MAX[custom.unit]} inputMode="numeric" className="field h-8 w-20 px-2 text-sm" placeholder="Nº"
              value={custom.amount} onChange={(e) => applyCustom({ ...custom, amount: e.target.value })} />
            <select className="field h-8 w-auto px-2 text-sm" value={custom.unit} onChange={(e) => applyCustom({ ...custom, unit: e.target.value as IdleUnit })}>
              {(Object.keys(UNIT_LABEL) as IdleUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
            {aud.idle && <button onClick={() => { setAud((a) => ({ ...a, idle: null })); setCustom({ amount: "", unit: "day" }); }} className="ml-auto text-xs text-slate-400 hover:text-white">Remover filtro</button>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Conta a última mensagem (enviada ou recebida) ou a última troca de etapa, o que for mais recente.</p>
        </Row>

        <Row id="leads" open={open} setOpen={setOpen} icon={UserPlus} title="Leads específicos" hint="Entram mesmo fora dos filtros" count={aud.leadIds.length} unit={["lead", "leads"]}>
          <LeadPicker orgId={ws.orgId} selected={picked} onAdd={(l) => { setPicked((p) => [...p, l]); setAud((a) => ({ ...a, leadIds: [...a.leadIds, l.id] })); }} onRemove={removeLead} />
        </Row>
      </div>
    </div>
  );
}

function Row({ id, open, setOpen, icon: Icon, title, hint, count, unit, summary, children }: {
  id: Section; open: Section | null; setOpen: (s: Section | null) => void; icon: typeof TagIcon; title: string; hint: string;
  count?: number; unit?: [string, string]; summary?: string; children: React.ReactNode;
}) {
  const isOpen = open === id;
  const badge = summary ?? (count ? `${count} ${count === 1 ? unit![0] : unit![1]}` : undefined);
  return (
    <div className={cn(isOpen && "bg-ink-850/60")}>
      <button onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-800/60">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", badge ? "bg-brand-500/20 text-brand-200" : "bg-ink-700 text-slate-400")}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{title}</span>
          <span className="block truncate text-xs text-slate-500">{hint}</span>
        </span>
        {badge ? <span className="shrink-0 rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-200">{badge}</span>
          : <span className="shrink-0 text-xs text-slate-600">Sem filtro</span>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}

function Check2({ on, onClick, color, label, extra }: { on: boolean; onClick: () => void; color: string; label: string; extra?: string }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={on}
      className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition", on ? "border-brand-400/50 bg-brand-500/10 text-white" : "border-line text-slate-300 hover:bg-ink-800")}>
      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-400 bg-brand-500 text-white" : "border-slate-600")}>{on && <Check className="h-3 w-3" />}</span>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra && <span className="shrink-0 text-[11px] text-slate-500">{extra}</span>}
    </button>
  );
}

function LeadPicker({ orgId, selected, onAdd, onRemove }: {
  orgId: string; selected: PickedLead[]; onAdd: (l: PickedLead) => void; onRemove: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PickedLead[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, "");
      let query = supabaseBrowser().from("leads").select("id, name, phone").eq("organization_id", orgId).not("phone", "is", null).limit(8);
      query = digits.length >= 4 ? query.ilike("phone", `%${digits}%`) : query.ilike("name", `%${term.replace(/[%_]/g, "")}%`);
      const { data } = await query;
      if (alive) setRes((data ?? []) as PickedLead[]);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, orgId]);
  const shown = q.trim().length >= 2 ? res.filter((r) => !selected.some((s) => s.id === r.id)) : [];
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input className="field pl-9" placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-ink-800 shadow-2xl">
            {shown.map((r) => (
              <li key={r.id}><button onClick={() => { onAdd(r); setQ(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-ink-700">
                <span className="truncate">{r.name}</span><span className="text-xs text-slate-500">+{r.phone}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {selected.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-200">{s.name}</span>
              <span className="text-xs text-slate-500">+{s.phone}</span>
              <button onClick={() => onRemove(s.id)} className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-red-300" aria-label="Remover"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

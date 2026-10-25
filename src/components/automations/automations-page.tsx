"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Bell, Bot, CheckCircle2, ChevronDown, Clock, Copy, DollarSign, Filter, GitBranch, History, KanbanSquare,
  MessageCircle, MessageSquareText, Plus, StickyNote, Tag as TagIcon, Trash2, UserRoundCog, Webhook, Workflow, XCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { cn, relativeTime } from "@/lib/utils";
import {
  COND_LABEL, STEP_LABEL, TEMPLATES, TRIGGER_LABEL, VARIABLES,
  type AutomationBody, type CondField, type Step, type Trigger,
} from "@/lib/automations/schema";

interface Automation extends AutomationBody { id: string; created_at: string; updated_at: string }
interface Stat { total: number; waiting: number; failed: number; last: string | null }
const ZERO = "00000000-0000-0000-0000-000000000000";

const STEP_ICON: Record<Step["type"], typeof Zap> = {
  send_message: MessageCircle, notify: Bell, wait: Clock, condition: Filter, move_stage: KanbanSquare, add_tag: TagIcon, remove_tag: TagIcon,
  assign: UserRoundCog, set_value: DollarSign, add_note: StickyNote, ai: Bot, webhook: Webhook,
};
const GROUP_COLOR: Record<string, string> = { Mensagens: "#22c55e", Lead: "#3b82f6", Fluxo: "#f59e0b", Integrações: "#a855f7" };

function newStep(type: Step["type"], ws: ReturnType<typeof useWorkspace>): Step {
  switch (type) {
    case "send_message": return { type, text: "Olá, {{primeiro_nome}}! " };
    case "notify": return { type, phone: "", text: "Novo lead: {{nome}} ({{telefone}}) — etapa {{etapa}}" };
    case "wait": return { type, amount: 1, unit: "days" };
    case "condition": return { type, field: "business_hours", value: null };
    case "move_stage": return { type, stage_id: ws.stages[0]?.id ?? ZERO };
    case "add_tag": case "remove_tag": return { type, tag_id: ws.tags[0]?.id ?? ZERO };
    case "assign": return { type, mode: "round_robin", user_ids: ws.members.map((m) => m.user_id) };
    case "set_value": return { type, value: 0 };
    case "add_note": return { type, text: "" };
    case "ai": return { type, mode: "pause" };
    case "webhook": return { type, url: "https://" };
  }
}

export function AutomationsPage() {
  const [list, setList] = useState<{ automations: Automation[]; stats: Record<string, Stat> } | null>(null);
  const [editing, setEditing] = useState<(AutomationBody & { id?: string }) | null>(null);
  const [gallery, setGallery] = useState(false);
  const [runsOf, setRunsOf] = useState<Automation | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/automations");
    const d = await r.json();
    if (!r.ok) { toast.error(d.error); return; }
    setList(d);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function toggle(a: Automation) {
    const r = await fetch(`/api/automations/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !a.enabled }) });
    const d = await r.json();
    if (!r.ok) return toast.error(d.error);
    toast.success(!a.enabled ? "Automação ligada" : "Automação desligada");
    void load();
  }
  async function remove(a: Automation) {
    if (!confirm(`Excluir a automação "${a.name}"? As execuções em andamento param.`)) return;
    await fetch(`/api/automations/${a.id}`, { method: "DELETE" });
    void load();
  }

  if (editing) return <Editor initial={editing} onClose={() => { setEditing(null); void load(); }} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200"><Workflow className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Automações</h2>
            <p className="text-sm text-slate-400">Quando algo acontece no CRM, o sistema faz por você: manda mensagem, espera, move, coloca tag, distribui leads, chama o n8n…</p>
          </div>
          <Button onClick={() => setGallery(true)}><Plus className="h-4 w-4" /> Nova automação</Button>
        </div>

        {!list ? <div className="flex justify-center py-16"><Spinner /></div> : !list.automations.length ? (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center">
            <Workflow className="mx-auto h-10 w-10 text-brand-300" />
            <p className="mt-3 font-semibold text-white">Nenhuma automação ainda</p>
            <p className="mt-1 text-sm text-slate-400">Comece por um modelo pronto — boas-vindas, follow-up, pós-venda, rodízio de leads.</p>
            <Button className="mt-4" onClick={() => setGallery(true)}>Ver modelos</Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.automations.map((a) => {
              const s = list.stats[a.id];
              return (
                <li key={a.id} className="rounded-xl border border-line bg-ink-900 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button role="switch" aria-checked={a.enabled} onClick={() => void toggle(a)} title={a.enabled ? "Desligar" : "Ligar"}
                      className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", a.enabled ? "bg-emerald-500" : "bg-ink-600")}>
                      <span className={cn("block h-4 w-4 rounded-full bg-white transition", a.enabled && "translate-x-4")} />
                    </button>
                    <button onClick={() => setEditing(a)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-medium text-white">{a.name}</p>
                      <p className="text-xs text-slate-400"><Zap className="mr-1 inline h-3 w-3 text-amber-300" />{triggerSummary(a.trigger)}</p>
                    </button>
                    <div className="flex items-center gap-1">
                      {a.steps.slice(0, 8).map((st, i) => { const I = STEP_ICON[st.type]; return <span key={i} title={STEP_LABEL[st.type].label} className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-800" style={{ color: GROUP_COLOR[STEP_LABEL[st.type].group] }}><I className="h-3.5 w-3.5" /></span>; })}
                      {a.steps.length > 8 && <span className="text-xs text-slate-500">+{a.steps.length - 8}</span>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-slate-400">
                    <span>{s?.total ?? 0} execuções em 30 dias</span>
                    {s?.waiting ? <span className="text-amber-300">{s.waiting} aguardando</span> : null}
                    {s?.failed ? <span className="text-red-300">{s.failed} com falha</span> : null}
                    {s?.last && <span>última {relativeTime(s.last)}</span>}
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setRunsOf(a)}><History className="h-3.5 w-3.5" /> Execuções</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ ...a, id: undefined, name: `${a.name} (cópia)`, enabled: false })}><Copy className="h-3.5 w-3.5" /> Duplicar</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Editar</Button>
                      <button onClick={() => void remove(a)} className="rounded-md p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {gallery && <Gallery onClose={() => setGallery(false)} onPick={(b) => { setGallery(false); setEditing({ ...b, enabled: false }); }} />}
      {runsOf && <Runs a={runsOf} onClose={() => setRunsOf(null)} />}
    </div>
  );
}

function useNames() {
  const ws = useWorkspace();
  return useMemo(() => ({
    stage: (id: string | null | undefined) => (id ? ws.stageById.get(id)?.name ?? "etapa removida" : "qualquer etapa"),
    tag: (id: string) => ws.tagById.get(id)?.name ?? "escolha a tag",
    member: (id: string) => ws.memberById.get(id)?.full_name ?? ws.memberById.get(id)?.email ?? "vendedor",
  }), [ws]);
}

function triggerSummary(t: Trigger): string {
  switch (t.type) {
    case "message_received": return t.keywords.length ? `Mensagem com: ${t.keywords.join(", ")}` : "Qualquer mensagem do cliente";
    case "idle": return `Lead parado há ${t.days} dia${t.days > 1 ? "s" : ""}`;
    default: return TRIGGER_LABEL[t.type].label;
  }
}

function Gallery({ onClose, onPick }: { onClose: () => void; onPick: (b: Omit<AutomationBody, "enabled">) => void }) {
  const ws = useWorkspace();
  const fix = (b: Omit<AutomationBody, "enabled">) => ({
    ...b, steps: b.steps.map((s) => (s.type === "assign" && !s.user_ids.length ? { ...s, user_ids: ws.members.filter((m) => m.role === "agent").map((m) => m.user_id).concat(ws.members.length && !ws.members.some((m) => m.role === "agent") ? [ws.members[0]!.user_id] : []) } : s)),
  });
  return (
    <Modal open onClose={onClose} title="Nova automação" wide>
      <div className="grid gap-3 sm:grid-cols-2" data-modal-body>
        <button onClick={() => onPick({ name: "Nova automação", trigger: { type: "lead_created", source: null }, steps: [], once_per_lead: true, stop_on_reply: false })}
          className="rounded-xl border border-dashed border-brand-400/40 p-4 text-left hover:bg-brand-500/5">
          <Plus className="h-5 w-5 text-brand-300" />
          <p className="mt-2 font-medium text-white">Começar do zero</p>
          <p className="text-xs text-slate-400">Escolha o gatilho e monte as ações.</p>
        </button>
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => onPick(fix(t.body))} className="rounded-xl border border-line p-4 text-left hover:border-brand-400/50 hover:bg-ink-850">
            <div className="flex gap-1">{t.body.steps.map((s, i) => { const I = STEP_ICON[s.type]; return <I key={i} className="h-4 w-4" style={{ color: GROUP_COLOR[STEP_LABEL[s.type].group] }} />; })}</div>
            <p className="mt-2 font-medium text-white">{t.name}</p>
            <p className="text-xs text-slate-400">{t.text}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------
// Editor visual (fluxo vertical, como n8n / Salesbot)
// ------------------------------------------------------------------------------------------------

function Editor({ initial, onClose }: { initial: AutomationBody & { id?: string }; onClose: () => void }) {
  const ws = useWorkspace();
  const [a, setA] = useState(initial);
  const [open, setOpen] = useState<number | "trigger" | null>(initial.steps.length ? null : "trigger");
  const [adding, setAdding] = useState<number | null>(initial.steps.length ? null : 0);
  const [busy, setBusy] = useState(false);

  const setStep = (i: number, s: Step) => setA({ ...a, steps: a.steps.map((x, k) => (k === i ? s : x)) });
  const insert = (i: number, type: Step["type"]) => { const steps = [...a.steps]; steps.splice(i, 0, newStep(type, ws)); setA({ ...a, steps }); setAdding(null); setOpen(i); };
  const move = (i: number, d: -1 | 1) => { const steps = [...a.steps]; const [x] = steps.splice(i, 1); steps.splice(i + d, 0, x!); setA({ ...a, steps }); setOpen(i + d); };
  const del = (i: number) => { setA({ ...a, steps: a.steps.filter((_, k) => k !== i) }); setOpen(null); };

  async function save(enable?: boolean) {
    const body = { ...a, enabled: enable ?? a.enabled };
    if (JSON.stringify(body).includes(ZERO)) return toast.error("Escolha a tag/etapa em todas as ações (marcadas em amarelo).");
    setBusy(true);
    try {
      const r = await fetch(a.id ? `/api/automations/${a.id}` : "/api/automations", { method: a.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(body.enabled ? "Automação salva e ligada" : "Automação salva (desligada)");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-900/70 px-4 py-2.5">
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></button>
        <input className="field h-9 max-w-xs flex-1 font-medium" value={a.name} maxLength={80} onChange={(e) => setA({ ...a, name: e.target.value })} />
        <label className="flex items-center gap-1.5 text-xs text-slate-300" title="Cada lead passa por esta automação uma única vez">
          <input type="checkbox" checked={a.once_per_lead} onChange={(e) => setA({ ...a, once_per_lead: e.target.checked })} /> Uma vez por lead
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-300" title="Se o cliente responder enquanto a automação espera, ela para">
          <input type="checkbox" checked={a.stop_on_reply} onChange={(e) => setA({ ...a, stop_on_reply: e.target.checked })} /> Parar se o cliente responder
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void save(false)} loading={busy}>Salvar desligada</Button>
          <Button onClick={() => void save(true)} loading={busy}><CheckCircle2 className="h-4 w-4" /> Salvar e ligar</Button>
        </div>
      </header>

      <div className="flow-bg min-h-0 flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto flex max-w-xl flex-col items-center">
          <Node color="#f59e0b" icon={Zap} kicker="Quando" title={triggerSummary(a.trigger)} active={open === "trigger"} onClick={() => setOpen(open === "trigger" ? null : "trigger")}>
            {open === "trigger" && <TriggerForm t={a.trigger} onChange={(t) => setA({ ...a, trigger: t })} />}
          </Node>

          {a.steps.map((s, i) => {
            const meta = STEP_LABEL[s.type];
            return (
              <div key={i} className="flex w-full flex-col items-center">
                <Connector onAdd={() => setAdding(adding === i ? null : i)} adding={adding === i} onPick={(t) => insert(i, t)} />
                <Node color={GROUP_COLOR[meta.group]!} icon={STEP_ICON[s.type]} kicker={`${i + 1}. ${meta.label}`} title={<StepSummary s={s} />} warn={JSON.stringify(s).includes(ZERO)}
                  active={open === i} onClick={() => setOpen(open === i ? null : i)}
                  tools={<>
                    <button disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }} className="rounded p-1 text-slate-500 hover:text-white disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button disabled={i === a.steps.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }} className="rounded p-1 text-slate-500 hover:text-white disabled:opacity-30" aria-label="Descer"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); del(i); }} className="rounded p-1 text-slate-500 hover:text-red-300" aria-label="Remover"><Trash2 className="h-3.5 w-3.5" /></button>
                  </>}>
                  {open === i && <StepForm s={s} onChange={(n) => setStep(i, n)} />}
                </Node>
              </div>
            );
          })}

          <Connector onAdd={() => setAdding(adding === a.steps.length ? null : a.steps.length)} adding={adding === a.steps.length} onPick={(t) => insert(a.steps.length, t)} last />
          <div className="mt-1 rounded-full border border-line bg-ink-900 px-3 py-1 text-[11px] text-slate-500">Fim</div>
        </div>
      </div>
      <style>{`.flow-bg{background-image:radial-gradient(rgb(var(--brand-300)/.12) 1px,transparent 1px);background-size:22px 22px}`}</style>
    </div>
  );
}

function Node({ color, icon: I, kicker, title, active, onClick, children, tools, warn }: {
  color: string; icon: typeof Zap; kicker: string; title: React.ReactNode; active: boolean; onClick: () => void; children?: React.ReactNode; tools?: React.ReactNode; warn?: boolean;
}) {
  return (
    <div className={cn("w-full overflow-hidden rounded-2xl border bg-ink-900 shadow-card transition", active ? "border-brand-400/60 ring-1 ring-brand-400/30" : warn ? "border-amber-400/60" : "border-line hover:border-slate-500")}>
      <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}22`, color }}><I className="h-4.5 h-[18px] w-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{kicker}</span>
          <span className="block truncate text-sm text-slate-100">{title}</span>
        </span>
        {tools && <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>{tools}</span>}
        <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", active && "rotate-180")} />
      </button>
      {children && <div className="border-t border-line bg-ink-850/60 p-4">{children}</div>}
    </div>
  );
}

function Connector({ onAdd, adding, onPick, last }: { onAdd: () => void; adding: boolean; onPick: (t: Step["type"]) => void; last?: boolean }) {
  const groups = ["Mensagens", "Lead", "Fluxo", "Integrações"] as const;
  return (
    <div className="relative flex w-full flex-col items-center">
      <div className="h-4 w-px bg-line" />
      <button onClick={onAdd} className={cn("flex h-7 w-7 items-center justify-center rounded-full border text-slate-300 transition", adding ? "border-brand-400 bg-brand-500 text-white" : "border-line bg-ink-900 hover:border-brand-400/60 hover:text-white")} aria-label="Adicionar ação">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {!last && <div className="h-4 w-px bg-line" />}
      {last && <div className="h-3 w-px bg-line" />}
      {adding && (
        <div className="z-10 my-2 grid w-full gap-3 rounded-2xl border border-line bg-ink-850 p-3 shadow-xl sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: GROUP_COLOR[g] }}>{g}</p>
              {(Object.keys(STEP_LABEL) as Step["type"][]).filter((k) => STEP_LABEL[k].group === g).map((k) => {
                const I = STEP_ICON[k];
                return (
                  <button key={k} onClick={() => onPick(k)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-ink-700">
                    <I className="h-4 w-4" style={{ color: GROUP_COLOR[g] }} /> {STEP_LABEL[k].label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepSummary({ s }: { s: Step }) {
  const n = useNames();
  switch (s.type) {
    case "send_message": case "add_note": return <>{s.text || "—"}</>;
    case "notify": return <>{s.phone || "escolha o número"} · {s.text}</>;
    case "wait": return <>{s.amount} {s.unit === "minutes" ? "minuto(s)" : s.unit === "hours" ? "hora(s)" : "dia(s)"}</>;
    case "condition": return <>o lead {COND_LABEL[s.field]} {s.field === "stage" ? n.stage(s.value) : s.field === "tag" || s.field === "no_tag" ? n.tag(s.value ?? "") : s.field === "assigned" ? n.member(s.value ?? "") : s.value ?? ""}</>;
    case "move_stage": return <>{n.stage(s.stage_id)}</>;
    case "add_tag": case "remove_tag": return <>{n.tag(s.tag_id)}</>;
    case "assign": return <>{s.mode === "round_robin" ? "Rodízio: " : ""}{s.user_ids.map(n.member).join(", ") || "escolha"}</>;
    case "set_value": return <>{s.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</>;
    case "ai": return <>{s.mode === "pause" ? "Pausar a IA" : s.mode === "resume" ? "Ligar a IA" : "Desligar a IA"} nesta conversa</>;
    case "webhook": return <>{s.url}</>;
  }
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1"><span className="text-xs font-medium text-slate-400">{label}</span>{children}</label>
);

function StagePick({ value, onChange, any }: { value: string | null; onChange: (v: string | null) => void; any?: boolean }) {
  const ws = useWorkspace();
  return (
    <select className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {any && <option value="">Qualquer etapa</option>}
      {!any && <option value={ZERO} disabled>Escolha a etapa</option>}
      {ws.pipelines.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {ws.stages.filter((s) => s.pipeline_id === p.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
function TagPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ws = useWorkspace();
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ZERO} disabled>Escolha a tag</option>
      {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}
function TextWithVars({ value, onChange, rows = 4 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div className="space-y-1.5">
      <textarea className="field text-sm" rows={rows} maxLength={4000} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">{VARIABLES.map((v) => <button key={v} type="button" onClick={() => onChange(`${value}${v}`)} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-brand-200 hover:bg-ink-700">{v}</button>)}</div>
    </div>
  );
}

function TriggerForm({ t, onChange }: { t: Trigger; onChange: (t: Trigger) => void }) {
  const [kw, setKw] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {(Object.keys(TRIGGER_LABEL) as Trigger["type"][]).map((k) => (
          <button key={k} onClick={() => onChange(
            k === "lead_created" ? { type: k, source: null } : k === "stage_changed" ? { type: k, stage_id: null } : k === "tag_added" ? { type: k, tag_id: ZERO }
              : k === "message_received" ? { type: k, keywords: [] } : k === "idle" ? { type: k, days: 3, stage_id: null } : { type: k })}
            className={cn("rounded-lg border px-3 py-2 text-left", t.type === k ? "border-amber-400/60 bg-amber-500/10" : "border-line hover:border-slate-500")}>
            <span className="block font-medium text-slate-100">{TRIGGER_LABEL[k].label}</span>
            <span className="block text-[11px] text-slate-500">{TRIGGER_LABEL[k].hint}</span>
          </button>
        ))}
      </div>
      {t.type === "lead_created" && <F label="Só leads com origem contendo (opcional)"><input className="field" placeholder="Ex.: WhatsApp, Instagram, Planilha" value={t.source ?? ""} onChange={(e) => onChange({ ...t, source: e.target.value || null })} /></F>}
      {t.type === "stage_changed" && <F label="Para a etapa"><StagePick any value={t.stage_id} onChange={(v) => onChange({ ...t, stage_id: v })} /></F>}
      {t.type === "tag_added" && <F label="Tag"><TagPick value={t.tag_id} onChange={(v) => onChange({ ...t, tag_id: v })} /></F>}
      {t.type === "message_received" && (
        <F label="Palavras-chave (vazio = qualquer mensagem)">
          <div className="flex flex-wrap gap-1.5">
            {t.keywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-ink-700 px-2 py-0.5 text-xs">{k}<button onClick={() => onChange({ ...t, keywords: t.keywords.filter((x) => x !== k) })}><XCircle className="h-3 w-3" /></button></span>)}
          </div>
          <input className="field mt-1.5" placeholder="Digite e aperte Enter (ex.: preço)" value={kw} onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && kw.trim()) { e.preventDefault(); onChange({ ...t, keywords: [...new Set([...t.keywords, kw.trim()])].slice(0, 20) }); setKw(""); } }} />
        </F>
      )}
      {t.type === "idle" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <F label="Parado há (dias)"><input type="number" min={1} max={180} className="field" value={t.days} onChange={(e) => onChange({ ...t, days: Math.min(180, Math.max(1, Number(e.target.value) || 1)) })} /></F>
          <F label="Na etapa"><StagePick any value={t.stage_id} onChange={(v) => onChange({ ...t, stage_id: v })} /></F>
        </div>
      )}
    </div>
  );
}

function StepForm({ s, onChange }: { s: Step; onChange: (s: Step) => void }) {
  const ws = useWorkspace();
  switch (s.type) {
    case "send_message": return <F label="Mensagem para o cliente"><TextWithVars value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>;
    case "add_note": return <F label="Anotação (aparece no histórico do lead)"><TextWithVars rows={2} value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>;
    case "notify": return (
      <div className="space-y-2">
        <F label="WhatsApp de quem recebe o aviso (DDI + DDD + número)"><input className="field" inputMode="tel" placeholder="5585999990000" value={s.phone} onChange={(e) => onChange({ ...s, phone: e.target.value.replace(/\D/g, "") })} /></F>
        <F label="Mensagem"><TextWithVars rows={2} value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>
      </div>
    );
    case "wait": return (
      <div className="flex gap-2">
        <input type="number" min={1} max={365} className="field w-24" value={s.amount} onChange={(e) => onChange({ ...s, amount: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} />
        <select className="field" value={s.unit} onChange={(e) => onChange({ ...s, unit: e.target.value as typeof s.unit })}>
          <option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option>
        </select>
      </div>
    );
    case "condition": return (
      <div className="space-y-2">
        <F label="Continuar só se o lead…">
          <select className="field" value={s.field} onChange={(e) => onChange({ ...s, field: e.target.value as CondField, value: null })}>
            {(Object.keys(COND_LABEL) as CondField[]).map((k) => <option key={k} value={k}>{COND_LABEL[k]}</option>)}
          </select>
        </F>
        {s.field === "stage" && <StagePick value={s.value ?? ZERO} onChange={(v) => onChange({ ...s, value: v })} />}
        {(s.field === "tag" || s.field === "no_tag") && <TagPick value={s.value ?? ZERO} onChange={(v) => onChange({ ...s, value: v })} />}
        {s.field === "assigned" && (
          <select className="field" value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })}>
            <option value="" disabled>Escolha</option>{ws.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</option>)}
          </select>
        )}
        {(s.field === "value_gte" || s.field === "value_lte") && <input type="number" min={0} className="field" value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })} />}
        {(s.field === "source" || s.field === "last_message_contains") && <input className="field" placeholder={s.field === "source" ? "Ex.: Instagram" : "Palavras separadas por vírgula"} value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })} />}
        <p className="text-[11px] text-slate-500"><GitBranch className="mr-1 inline h-3 w-3" />Se não atender, a automação para aqui para este lead.</p>
      </div>
    );
    case "move_stage": return <F label="Mover para"><StagePick value={s.stage_id} onChange={(v) => onChange({ ...s, stage_id: v ?? ZERO })} /></F>;
    case "add_tag": case "remove_tag": return <F label="Tag"><TagPick value={s.tag_id} onChange={(v) => onChange({ ...s, tag_id: v })} /></F>;
    case "assign": return (
      <div className="space-y-2">
        <div className="flex gap-2 text-xs">
          {(["round_robin", "fixed"] as const).map((m) => <button key={m} onClick={() => onChange({ ...s, mode: m })} className={cn("rounded-full border px-3 py-1", s.mode === m ? "border-brand-400/60 bg-brand-500/15 text-brand-100" : "border-line text-slate-400")}>{m === "round_robin" ? "Rodízio (um por vez)" : "Sempre o mesmo"}</button>)}
        </div>
        <div className="space-y-1">
          {ws.members.map((m) => (
            <label key={m.user_id} className="flex items-center gap-2 text-sm text-slate-200">
              <input type={s.mode === "fixed" ? "radio" : "checkbox"} name="assign" checked={s.user_ids.includes(m.user_id)}
                onChange={(e) => onChange({ ...s, user_ids: s.mode === "fixed" ? [m.user_id] : e.target.checked ? [...s.user_ids, m.user_id] : s.user_ids.filter((u) => u !== m.user_id) })} />
              {m.full_name ?? m.email} <span className="text-xs text-slate-500">{m.role === "agent" ? "vendedor" : m.role === "owner" ? "dono" : "admin"}</span>
            </label>
          ))}
        </div>
      </div>
    );
    case "set_value": return <F label="Valor (R$)"><input type="number" min={0} className="field" value={s.value} onChange={(e) => onChange({ ...s, value: Math.max(0, Number(e.target.value) || 0) })} /></F>;
    case "ai": return (
      <select className="field" value={s.mode} onChange={(e) => onChange({ ...s, mode: e.target.value as typeof s.mode })}>
        <option value="pause">Pausar a IA (um vendedor assume)</option><option value="resume">Ligar a IA nesta conversa</option><option value="off">Desligar a IA nesta conversa</option>
      </select>
    );
    case "webhook": return (
      <div className="space-y-1.5">
        <F label="Endereço do webhook (n8n, Make, Zapier…)"><input className="field font-mono text-xs" value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value.trim() })} /></F>
        <p className="text-[11px] text-slate-500"><MessageSquareText className="mr-1 inline h-3 w-3" />Envia um POST com nome, telefone, valor, etapa, origem, responsável e tags do lead. Cabeçalho <code>x-nexo-signature</code> para conferir a origem.</p>
      </div>
    );
  }
}

// ------------------------------------------------------------------------------------------------

interface RunRow { id: number; status: string; step_index: number; resume_at: string | null; error: string | null; created_at: string; log: { at: string; step: number; type: string; ok: boolean; info?: string }[]; leads: { id: string; name: string } | null }
const RUN_STATUS: Record<string, { l: string; c: string }> = {
  running: { l: "Na fila", c: "text-slate-300" }, processing: { l: "Rodando", c: "text-brand-200" }, waiting: { l: "Aguardando", c: "text-amber-300" },
  done: { l: "Concluída", c: "text-emerald-300" }, stopped: { l: "Parou", c: "text-slate-400" }, failed: { l: "Falhou", c: "text-red-300" },
};

function Runs({ a, onClose }: { a: Automation; onClose: () => void }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    void fetch(`/api/automations/${a.id}`).then(async (r) => { const d = await r.json(); setRuns(r.ok ? d.runs : []); });
  }, [a.id]);
  return (
    <Modal open onClose={onClose} title={`Execuções — ${a.name}`} wide>
      <div data-modal-body>
        {!runs ? <div className="flex justify-center py-8"><Spinner /></div> : !runs.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma execução ainda.</p> : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-850">
                  <span className={cn("w-24 text-xs font-medium", RUN_STATUS[r.status]?.c)}>{RUN_STATUS[r.status]?.l ?? r.status}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-100">{r.leads?.name ?? "—"}</span>
                  {r.status === "waiting" && r.resume_at && <span className="text-xs text-amber-300">continua {relativeTime(r.resume_at).replace("há ", "em ")}</span>}
                  {r.error && <span className="max-w-[180px] truncate text-xs text-slate-500">{r.error}</span>}
                  <span className="text-xs text-slate-500">{relativeTime(r.created_at)}</span>
                </button>
                {open === r.id && (
                  <ol className="space-y-1 bg-ink-850 px-4 py-2 text-xs">
                    {r.log.map((l, i) => (
                      <li key={i} className="flex gap-2">
                        {l.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                        <span className="text-slate-300">{l.step + 1}. {STEP_LABEL[l.type as Step["type"]]?.label ?? l.type}</span>
                        {l.info && <span className="truncate text-slate-500">— {l.info}</span>}
                        <span className="ml-auto text-slate-600">{new Date(l.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </li>
                    ))}
                    {!r.log.length && <li className="text-slate-500">Ainda não começou.</li>}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

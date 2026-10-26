"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, History, Plus, Trash2, Workflow, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { cn, relativeTime } from "@/lib/utils";
import { graphSteps, STEP_LABEL, TEMPLATES, type AutomationBody, type Step } from "@/lib/automations/schema";
import { GROUP_COLOR, STEP_ICON, triggerSummary } from "./forms";
import { FlowEditor } from "./flow-editor";

interface Automation extends AutomationBody { id: string; created_at: string; updated_at: string }
interface Stat { total: number; waiting: number; failed: number; last: string | null }

export function AutomationsPage() {
  const [list, setList] = useState<{ automations: Automation[]; stats: Record<string, Stat> } | null>(null);
  const [editing, setEditing] = useState<(AutomationBody & { id?: string; assinatura?: string }) | null>(null);
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

  if (editing) return <FlowEditor initial={editing} onClose={() => { setEditing(null); void load(); }} />;

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
                      {(() => { const all = a.graph ? graphSteps(a.graph) : a.steps; return <>
                        {all.slice(0, 8).map((st, i) => { const I = STEP_ICON[st.type]; return <span key={i} title={STEP_LABEL[st.type].label} className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-800" style={{ color: GROUP_COLOR[STEP_LABEL[st.type].group] }}><I className="h-3.5 w-3.5" /></span>; })}
                        {all.length > 8 && <span className="text-xs text-slate-500">+{all.length - 8}</span>}
                      </>; })()}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-slate-400">
                    <span>{s?.total ?? 0} execuções em 30 dias</span>
                    {s?.waiting ? <span className="text-amber-300">{s.waiting} aguardando</span> : null}
                    {s?.failed ? <span className="text-red-300">{s.failed} com falha</span> : null}
                    {s?.last && <span>última {relativeTime(s.last)}</span>}
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setRunsOf(a)}><History className="h-3.5 w-3.5" /> Execuções</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ ...a, id: undefined, assinatura: undefined, name: `${a.name} (cópia)`, enabled: false })}><Copy className="h-3.5 w-3.5" /> Duplicar</Button>
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

function Gallery({ onClose, onPick }: { onClose: () => void; onPick: (b: Omit<AutomationBody, "enabled">) => void }) {
  const ws = useWorkspace();
  const fix = (b: Omit<AutomationBody, "enabled">) => ({
    ...b, steps: b.steps.map((s) => (s.type === "assign" && !s.user_ids.length ? { ...s, user_ids: ws.members.filter((m) => m.role === "agent").map((m) => m.user_id).concat(ws.members.length && !ws.members.some((m) => m.role === "agent") ? [ws.members[0]!.user_id] : []) } : s)),
  });
  return (
    <Modal open onClose={onClose} title="Nova automação" wide>
      <div className="grid gap-3 sm:grid-cols-2" data-modal-body>
        <button onClick={() => onPick({ name: "Nova automação", trigger: { type: "lead_created", source: null }, steps: [], graph: { nodes: [{ id: "trigger", x: 0, y: 0, step: null }], edges: [] }, once_per_lead: true, stop_on_reply: false })}
          className="rounded-xl border border-dashed border-brand-400/40 p-4 text-left hover:bg-brand-500/5">
          <Plus className="h-5 w-5 text-brand-300" />
          <p className="mt-2 font-medium text-white">Começar do zero</p>
          <p className="text-xs text-slate-400">Escolha o gatilho e monte as ações.</p>
        </button>
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => onPick(fix(t.body))} className="rounded-xl border border-line p-4 text-left hover:border-brand-400/50 hover:bg-ink-850">
            <div className="flex gap-1">{(t.body.graph ? graphSteps(t.body.graph) : t.body.steps).map((s, i) => { const I = STEP_ICON[s.type]; return <I key={i} className="h-4 w-4" style={{ color: GROUP_COLOR[STEP_LABEL[s.type].group] }} />; })}</div>
            <p className="mt-2 font-medium text-white">{t.name}</p>
            <p className="text-xs text-slate-400">{t.text}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
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

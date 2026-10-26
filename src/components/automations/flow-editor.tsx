"use client";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  addEdge, Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getSmoothStepPath, Handle, MiniMap, Position, ReactFlow,
  ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, CheckCircle2, Copy, LayoutGrid, MousePointerClick, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace";
import { cn } from "@/lib/utils";
import {
  graphIssues, linearToGraph, portsOf, STEP_LABEL, TRIGGER_NODE,
  type AutomationBody, type Graph, type Step, type Trigger,
} from "@/lib/automations/schema";
import { GROUP_COLOR, newStep, STEP_ICON, StepForm, StepSummary, TriggerForm, triggerSummary, ZERO } from "./forms";

// Editor de automação em canvas (estilo n8n): blocos ligados por conexões, da esquerda para a direita.

type NodeData = { step: Step | null; trigger: Trigger };
type FlowNode = Node<NodeData, "block">;

const PORT_COLOR: Record<string, string> = { yes: "#22c55e", no: "#ef4444", a: "#3b82f6", b: "#a855f7", replied: "#22c55e", timeout: "#f59e0b", out: "#64748b" };
const GROUPS = ["Mensagens", "Lead", "Fluxo", "Integrações"] as const;
const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function toFlow(g: Graph, trigger: Trigger): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: "block", position: { x: n.x, y: n.y }, data: { step: n.step, trigger }, deletable: n.id !== TRIGGER_NODE })),
    edges: g.edges.map((e) => ({ id: `${e.from}:${e.port}`, source: e.from, sourceHandle: e.port, target: e.to, type: "del" })),
  };
}
function fromFlow(nodes: FlowNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), step: n.data.step })),
    edges: edges.map((e) => ({ from: e.source, port: e.sourceHandle ?? "out", to: e.target })),
  };
}

/** Organiza os blocos em colunas (gatilho → ações), como o n8n. */
function autoLayout(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const depth = new Map<string, number>([[TRIGGER_NODE, 0]]);
  const queue = [TRIGGER_NODE];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges.filter((x) => x.source === id)) {
      if (!depth.has(e.target)) { depth.set(e.target, depth.get(id)! + 1); queue.push(e.target); }
    }
  }
  const maxD = Math.max(0, ...depth.values());
  const rows = new Map<number, number>();
  return nodes.map((n) => {
    const d = depth.get(n.id) ?? maxD + 1;
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    return { ...n, position: { x: d * 320, y: r * 170 } };
  });
}

// ------------------------------------------------------------------------------------------------
// Bloco e conexão
// ------------------------------------------------------------------------------------------------

const Block = memo(function Block({ id, data, selected }: NodeProps<FlowNode>) {
  const s = data.step;
  const isTrigger = id === TRIGGER_NODE;
  const meta = s ? STEP_LABEL[s.type] : null;
  const color = isTrigger ? "#f59e0b" : GROUP_COLOR[meta!.group]!;
  const Icon = isTrigger ? Zap : STEP_ICON[s!.type];
  const ports = portsOf(s?.type ?? null);
  const warn = s ? JSON.stringify(s).includes(ZERO) || (s.type === "notify" && !s.phone) : data.trigger.type === "tag_added" && data.trigger.tag_id === ZERO;
  return (
    <div className={cn("relative w-[250px] rounded-2xl border bg-ink-900 shadow-card transition",
      selected ? "border-brand-400 ring-2 ring-brand-400/30" : warn ? "border-amber-400/70" : "border-line hover:border-slate-500")}>
      {!isTrigger && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-ink-900 !bg-slate-400" />}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}22`, color }}><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{isTrigger ? "Quando" : meta!.label}</p>
          <p className="line-clamp-2 text-xs leading-snug text-slate-200">{isTrigger ? triggerSummary(data.trigger) : <StepSummary s={s!} />}</p>
        </div>
      </div>
      {warn && <p className="border-t border-amber-400/30 px-3 py-1 text-[10px] text-amber-300">Falta configurar</p>}
      {ports.length === 1 ? (
        <Handle type="source" id={ports[0]!.id} position={Position.Right} className="!h-3 !w-3 !border-2 !border-ink-900 !bg-brand-400" />
      ) : (
        <div className="border-t border-line px-3 py-1.5">
          {ports.map((p) => (
            <div key={p.id} className="relative flex h-6 items-center justify-end pr-1 text-[11px] font-medium" style={{ color: PORT_COLOR[p.id] }}>
              {p.label}
              <Handle type="source" id={p.id} position={Position.Right} className="!-right-[19px] !h-3 !w-3 !border-2 !border-ink-900" style={{ background: PORT_COLOR[p.id] }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sourceHandleId, selected }: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 });
  const color = PORT_COLOR[sourceHandleId ?? "out"] ?? "#64748b";
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? "#93c5fd" : color, strokeWidth: selected ? 2.5 : 2 }} />
      <EdgeLabelRenderer>
        <button onClick={() => setEdges((es) => es.filter((e) => e.id !== id))} title="Remover conexão"
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: "all" }}
          className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-line bg-ink-900 text-slate-400 opacity-60 hover:border-red-400 hover:text-red-300 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { block: Block };
const edgeTypes = { del: DeletableEdge };

// ------------------------------------------------------------------------------------------------
// Editor
// ------------------------------------------------------------------------------------------------

export type EditorValue = AutomationBody & { id?: string; assinatura?: string };

export function FlowEditor(props: { initial: EditorValue; onClose: () => void }) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}

function Inner({ initial, onClose }: { initial: EditorValue; onClose: () => void }) {
  const ws = useWorkspace();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState({ name: initial.name, once_per_lead: initial.once_per_lead, stop_on_reply: initial.stop_on_reply, trigger: initial.trigger });
  const start = useMemo(() => toFlow(initial.graph ?? linearToGraph(initial.steps), initial.trigger), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(start.nodes.length > 1 ? start.nodes : start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [selected, setSelected] = useState<string | null>(initial.steps.length || initial.graph ? null : TRIGGER_NODE);
  const [busy, setBusy] = useState(false);

  const sel = nodes.find((n) => n.id === selected) ?? null;
  const setTrigger = (t: Trigger) => { setMeta((m) => ({ ...m, trigger: t })); setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, trigger: t } }))); };
  const setStep = (id: string, step: Step) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, step } } : n)));

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || c.target === TRIGGER_NODE) return;
    const port = c.sourceHandle ?? "out";
    // Cada saída liga em um bloco só: a nova conexão substitui a antiga
    setEdges((es) => addEdge({ ...c, id: `${c.source}:${port}`, sourceHandle: port, type: "del" }, es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "out") === port))));
  }, [setEdges]);

  /** Adiciona um bloco: ao lado do bloco selecionado (e já conectado nele), ou no fim. */
  const add = useCallback((type: Step["type"], at?: { x: number; y: number }) => {
    const id = newId();
    const step = newStep(type, ws);
    const from = nodes.find((n) => n.id === selected) ?? [...nodes].sort((a, b) => b.position.x - a.position.x)[0];
    const free = from ? portsOf(from.data.step?.type ?? null).find((p) => !edges.some((e) => e.source === from.id && (e.sourceHandle ?? "out") === p.id)) : null;
    const used = edges.filter((e) => from && e.source === from.id).length;
    const position = at ?? (from ? { x: from.position.x + 320, y: from.position.y + used * 160 } : { x: 320, y: 0 });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "block", position, data: { step, trigger: meta.trigger }, selected: true }]);
    if (from && free && !at) setEdges((es) => [...es, { id: `${from.id}:${free.id}`, source: from.id, sourceHandle: free.id, target: id, type: "del" }]);
    setSelected(id);
  }, [nodes, edges, selected, ws, meta.trigger, setNodes, setEdges]);

  const remove = (id: string) => {
    if (id === TRIGGER_NODE) return;
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
  };
  const duplicate = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n?.data.step) return;
    const nid = newId();
    setNodes((ns) => [...ns, { ...n, id: nid, selected: false, position: { x: n.position.x + 40, y: n.position.y + 120 } }]);
    setSelected(nid);
  };

  async function save(enable?: boolean) {
    const graph = fromFlow(nodes, edges);
    const issues = graphIssues(graph);
    if (issues.length) return toast.error(issues[0]);
    // Blocos soltos (sem nada ligando neles) nunca rodam
    const reach = new Set([TRIGGER_NODE]);
    for (let changed = true; changed;) { changed = false; for (const e of graph.edges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); changed = true; } }
    const loose = graph.nodes.filter((n) => !reach.has(n.id));
    if (loose.length) { setSelected(loose[0]!.id); return toast.error(`${loose.length} bloco(s) sem ligação — ligue ou apague (selecionado em azul).`); }
    const bad = graph.nodes.find((n) => n.step && (JSON.stringify(n.step).includes(ZERO) || (n.step.type === "notify" && !n.step.phone)));
    if (bad || (meta.trigger.type === "tag_added" && meta.trigger.tag_id === ZERO)) { setSelected(bad?.id ?? TRIGGER_NODE); return toast.error("Termine de configurar os blocos marcados em amarelo."); }
    const body = { ...meta, enabled: enable ?? initial.enabled, steps: [], graph };
    setBusy(true);
    try {
      const r = await fetch(initial.id ? `/api/automations/${initial.id}` : "/api/automations", { method: initial.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(body.enabled ? "Automação salva e ligada" : "Automação salva (desligada)");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/nexo-step") as Step["type"];
    if (type) add(type, rf.screenToFlowPosition({ x: e.clientX - 125, y: e.clientY - 30 }));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-900/70 px-4 py-2.5">
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></button>
        <input className="field h-9 max-w-xs flex-1 font-medium" value={meta.name} maxLength={80} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
        <label className="flex items-center gap-1.5 text-xs text-slate-300" title="Cada lead passa por esta automação uma única vez">
          <input type="checkbox" checked={meta.once_per_lead} onChange={(e) => setMeta({ ...meta, once_per_lead: e.target.checked })} /> Uma vez por lead
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-300" title="Se o cliente responder enquanto a automação espera, ela para. Exceção: o bloco 'Esperar o cliente responder' segue pelo caminho 'Respondeu'.">
          <input type="checkbox" checked={meta.stop_on_reply} onChange={(e) => setMeta({ ...meta, stop_on_reply: e.target.checked })} /> Parar se o cliente responder
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void save(false)} loading={busy}>Salvar desligada</Button>
          <Button onClick={() => void save(true)} loading={busy}><CheckCircle2 className="h-4 w-4" /> Salvar e ligar</Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Blocos disponíveis */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-ink-900/60 p-3 md:block">
          <p className="mb-2 text-xs text-slate-500">Clique para adicionar depois do bloco selecionado, ou arraste para o canvas.</p>
          {GROUPS.map((g) => (
            <div key={g} className="mb-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: GROUP_COLOR[g] }}>{g}</p>
              {(Object.keys(STEP_LABEL) as Step["type"][]).filter((k) => STEP_LABEL[k].group === g).map((k) => {
                const I = STEP_ICON[k];
                return (
                  <button key={k} draggable onDragStart={(e) => { e.dataTransfer.setData("application/nexo-step", k); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => add(k)} className="flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-slate-200 hover:bg-ink-700 active:cursor-grabbing">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${GROUP_COLOR[g]}22`, color: GROUP_COLOR[g] }}><I className="h-3.5 w-3.5" /></span>
                    {STEP_LABEL[k].label}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <div ref={wrap} className="relative min-w-0 flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6}
            onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
            onNodesDelete={(ns) => { if (ns.some((n) => n.id === selected)) setSelected(null); }}
            deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "del" }} connectionLineStyle={{ stroke: "#60a5fa", strokeWidth: 2 }}
            className="!bg-ink-950">
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(96 165 250 / .18)" />
            <Controls showInteractive={false} className="!border-line !bg-ink-900 [&_button]:!border-line [&_button]:!bg-ink-900 [&_button]:!fill-slate-300" />
            <MiniMap pannable zoomable className="!bg-ink-900" maskColor="rgb(2 6 23 / .7)" nodeColor={(n) => ((n as FlowNode).data.step ? GROUP_COLOR[STEP_LABEL[(n as FlowNode).data.step!.type].group]! : "#f59e0b")} />
          </ReactFlow>
          <div className="absolute left-3 top-3 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setNodes((ns) => autoLayout(ns, edges)); setTimeout(() => rf.fitView({ padding: 0.3, maxZoom: 1 }), 50); }}><LayoutGrid className="h-3.5 w-3.5" /> Organizar</Button>
            <select className="field h-8 w-44 text-xs md:hidden" value="" onChange={(e) => e.target.value && add(e.target.value as Step["type"])} aria-label="Adicionar bloco">
              <option value="">+ Adicionar bloco</option>
              {(Object.keys(STEP_LABEL) as Step["type"][]).map((k) => <option key={k} value={k}>{STEP_LABEL[k].label}</option>)}
            </select>
          </div>
          {nodes.length === 1 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 mx-auto w-fit rounded-full border border-line bg-ink-900/90 px-4 py-2 text-xs text-slate-300">
              <MousePointerClick className="mr-1 inline h-3.5 w-3.5 text-brand-300" />Adicione um bloco (lista à esquerda ou “+ Adicionar bloco”). Ligue as bolinhas para criar o caminho.
            </div>
          )}
        </div>

        {/* Configuração do bloco selecionado */}
        {sel && (
          <aside className="absolute inset-x-0 bottom-0 z-20 max-h-[70%] overflow-y-auto border-t border-line bg-ink-900 p-4 md:static md:inset-auto md:max-h-none md:w-96 md:shrink-0 md:border-l md:border-t-0">
            <div className="mb-3 flex items-center gap-2">
              <p className="flex-1 text-sm font-semibold text-white">{sel.id === TRIGGER_NODE ? "Quando a automação começa" : STEP_LABEL[sel.data.step!.type].label}</p>
              {sel.id !== TRIGGER_NODE && (
                <>
                  <button onClick={() => duplicate(sel.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800 hover:text-white" title="Duplicar"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => remove(sel.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" title="Apagar bloco"><Trash2 className="h-4 w-4" /></button>
                </>
              )}
              <button onClick={() => setSelected(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            {sel.id === TRIGGER_NODE
              ? <TriggerForm t={meta.trigger} onChange={setTrigger} />
              : <StepForm s={sel.data.step!} onChange={(st) => setStep(sel.id, st)} assinatura={initial.assinatura} />}
            {sel.id !== TRIGGER_NODE && portsOf(sel.data.step!.type).length > 1 && (
              <p className="mt-3 rounded-lg bg-ink-800 p-2 text-[11px] text-slate-400">Este bloco tem {portsOf(sel.data.step!.type).length} saídas. Arraste da bolinha de cada saída até o próximo bloco.</p>
            )}
            {/* Celular: adicionar blocos */}
            <div className="mt-4 md:hidden">
              <p className="mb-1 text-xs text-slate-500">Adicionar depois deste bloco:</p>
              <select className="field" value="" onChange={(e) => e.target.value && add(e.target.value as Step["type"])}>
                <option value="">Escolha um bloco…</option>
                {(Object.keys(STEP_LABEL) as Step["type"][]).map((k) => <option key={k} value={k}>{STEP_LABEL[k].label}</option>)}
              </select>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCorners, DndContext, pointerWithin, rectIntersection, type CollisionDetection, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Filter, KanbanSquare, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { idleSince, LeadCardView, SortableLeadCard } from "./card";
import { LeadDrawer } from "@/components/lead/lead-drawer";
import { ScheduleModal } from "@/components/lead/schedule-modal";
import { Button } from "@/components/ui/button";
import { Empty, Spinner } from "@/components/ui/misc";
import { KANBAN_PAGE_SIZE } from "@/lib/constants";
import { between, cn, formatBRL, norm } from "@/lib/utils";
import type { Lead, Stage } from "@/lib/types";
import { useLatest } from "@/lib/hooks";

type TagRow = { lead_id: string; tag_id: string };

/**
 * Colisão guiada pelo ponteiro: solta onde o mouse está (inclusive em coluna
 * vazia). Dentro de uma coluna, prefere o card sob o ponteiro.
 */
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const cards = hits.filter((h) => !String(h.id).startsWith("col:"));
    if (cards.length) return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => cards.some((h) => h.id === c.id)) });
    return hits;
  }
  return rectIntersection(args);
};

export function KanbanBoard({
  pipelineId, initialLeads, initialCounts, initialTags,
}: { pipelineId: string | null; initialLeads: Lead[]; initialCounts: Record<string, number>; initialTags: TagRow[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [leads, setLeads] = useState<Record<string, Lead>>(() => Object.fromEntries(initialLeads.map((l) => [l.id, l])));
  const [counts, setCounts] = useState(initialCounts);
  const [tagsByLead, setTagsByLead] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    initialTags.forEach((r) => (m[r.lead_id] ??= []).push(r.tag_id));
    return m;
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{ id: string; name: string } | null>(null);
  const leadsRef = useLatest(leads);

  const stages = useMemo(() => ws.stages.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.position - b.position), [ws.stages, pipelineId]);
  const stageIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages]);

  // Re-sincroniza quando o servidor manda dados novos (router.refresh)
  const [synced, setSynced] = useState(initialLeads);
  if (synced !== initialLeads) {
    setSynced(initialLeads);
    setLeads(Object.fromEntries(initialLeads.map((l) => [l.id, l])));
    setCounts(initialCounts);
    const m: Record<string, string[]> = {};
    initialTags.forEach((r) => (m[r.lead_id] ??= []).push(r.tag_id));
    setTagsByLead(m);
  }

  useEffect(() => {
    const onRefresh = () => router.refresh();
    window.addEventListener("crm:refresh", onRefresh);
    return () => window.removeEventListener("crm:refresh", onRefresh);
  }, [router]);

  // Tempo real: outras pessoas movendo/criando leads aparecem na hora
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`kanban:${ws.orgId}:${pipelineId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `organization_id=eq.${ws.orgId}` }, (p) => {
        if (p.eventType === "DELETE") {
          const old = p.old as Partial<Lead>;
          const gone = old.id ? leadsRef.current[old.id] : undefined;
          if (!gone) return;
          setCounts((c) => ({ ...c, [gone.stage_id]: Math.max(0, (c[gone.stage_id] ?? 1) - 1) }));
          setLeads((cur) => {
            const { [gone.id]: _x, ...rest } = cur;
            return rest;
          });
          return;
        }
        const nl = p.new as Lead;
        const old = p.old as Partial<Lead>;
        const prev = leadsRef.current[nl.id];
        const prevStage = prev?.stage_id ?? old.stage_id;
        if (prevStage !== nl.stage_id) {
          setCounts((c) => {
            const n = { ...c };
            if (prevStage && stageIds.has(prevStage)) n[prevStage] = Math.max(0, (n[prevStage] ?? 1) - 1);
            if (stageIds.has(nl.stage_id)) n[nl.stage_id] = (n[nl.stage_id] ?? 0) + 1;
            return n;
          });
        }
        if (!stageIds.has(nl.stage_id)) {
          if (prev) setLeads((cur) => {
            const { [nl.id]: _x, ...rest } = cur;
            return rest;
          });
          return;
        }
        leadsRef.current = { ...leadsRef.current, [nl.id]: nl };
        setLeads((cur) => ({ ...cur, [nl.id]: nl }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_tags", filter: `organization_id=eq.${ws.orgId}` }, (p) => {
        if (p.eventType === "INSERT") {
          const r = p.new as TagRow;
          setTagsByLead((m) => (m[r.lead_id]?.includes(r.tag_id) ? m : { ...m, [r.lead_id]: [...(m[r.lead_id] ?? []), r.tag_id] }));
        } else if (p.eventType === "DELETE") {
          const r = p.old as TagRow;
          if (r.lead_id) setTagsByLead((m) => ({ ...m, [r.lead_id]: (m[r.lead_id] ?? []).filter((t) => t !== r.tag_id) }));
        }
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [ws.orgId, pipelineId, stageIds, leadsRef]);

  const matches = useCallback((l: Lead) => {
    if (q) {
      const nq = norm(q);
      const digits = q.replace(/\D/g, "");
      if (!norm(l.name).includes(nq) && !(digits.length >= 3 && l.phone?.includes(digits))) return false;
    }
    if (tagFilter && !tagsByLead[l.id]?.includes(tagFilter)) return false;
    if (ownerFilter === "me" && l.assigned_to !== ws.userId) return false;
    if (ownerFilter === "none" && l.assigned_to) return false;
    if (ownerFilter && !["me", "none"].includes(ownerFilter) && l.assigned_to !== ownerFilter) return false;
    if (ageFilter) {
      // "idle:7" = parado há 7+ dias; "base:7" = criado há 7+ dias
      const [kind, d] = ageFilter.split(":");
      const ref = kind === "idle" ? idleSince(l) : new Date(l.created_at).getTime();
      if (Date.now() - ref < Number(d) * 86_400_000) return false;
    }
    return true;
  }, [q, tagFilter, ownerFilter, ageFilter, tagsByLead, ws.userId]);

  const columns = useMemo(() => {
    const by: Record<string, Lead[]> = Object.fromEntries(stages.map((s) => [s.id, []]));
    Object.values(leads).forEach((l) => by[l.stage_id]?.push(l));
    for (const k in by) by[k]!.sort((a, b) => a.position - b.position);
    return by;
  }, [leads, stages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const stageOf = (id: string | undefined | null): string | null => {
    if (!id) return null;
    if (id.startsWith("col:")) return id.slice(4);
    return leads[id]?.stage_id ?? null;
  };

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }
  function onDragOver(e: DragOverEvent) { setOverStage(stageOf(e.over ? String(e.over.id) : null)); }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setOverStage(null);
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const lead = leads[id];
    const toStage = stageOf(overId);
    if (!lead || !toStage || overId === id) return;

    const col = (columns[toStage] ?? []).filter((l) => l.id !== id);
    let index = overId?.startsWith("col:") ? col.length : col.findIndex((l) => l.id === overId);
    if (index < 0) index = col.length;
    // Mesmo coluna, arrastando para baixo: insere depois do alvo
    if (toStage === lead.stage_id && !overId?.startsWith("col:")) {
      const full = columns[toStage] ?? [];
      if (full.findIndex((l) => l.id === id) < full.findIndex((l) => l.id === overId)) index += 1;
    }
    const position = between(col[index - 1]?.position, col[index]?.position);
    if (toStage === lead.stage_id && Math.abs(position - lead.position) < 1e-9) return;

    const before = lead;
    const updated = { ...lead, stage_id: toStage, position };
    leadsRef.current = { ...leadsRef.current, [id]: updated };
    setLeads((cur) => ({ ...cur, [id]: updated }));
    if (toStage !== before.stage_id) setCounts((c) => ({ ...c, [before.stage_id]: Math.max(0, (c[before.stage_id] ?? 1) - 1), [toStage]: (c[toStage] ?? 0) + 1 }));

    const { error } = await supabaseBrowser().from("leads").update({ stage_id: toStage, position }).eq("id", id);
    if (error) {
      leadsRef.current = { ...leadsRef.current, [id]: before };
      setLeads((cur) => ({ ...cur, [id]: before }));
      if (toStage !== before.stage_id) setCounts((c) => ({ ...c, [before.stage_id]: (c[before.stage_id] ?? 0) + 1, [toStage]: Math.max(0, (c[toStage] ?? 1) - 1) }));
      toast.error("Não foi possível mover o lead. Tente novamente.");
      return;
    }
    // Soltou na etapa de agendamento: já abre para escolher dia e hora
    // (só nos funis com "abrir agendamento ao mover" ligado — Automações → Reuniões)
    if (toStage !== before.stage_id && norm(ws.stageById.get(toStage)?.name ?? "").includes("agend")
      && ws.pipelines.find((p) => p.id === ws.stageById.get(toStage)?.pipeline_id)?.schedule_on_move !== false) {
      setScheduleFor({ id, name: before.name });
    }
  }

  async function loadMore(stageId: string) {
    setLoadingMore(stageId);
    const loaded = columns[stageId]?.length ?? 0;
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("leads").select("*").eq("stage_id", stageId).order("position").range(loaded, loaded + KANBAN_PAGE_SIZE - 1);
    if (!error && data?.length) {
      const ids = data.map((l) => l.id);
      const { data: tr } = await sb.from("lead_tags").select("lead_id, tag_id").in("lead_id", ids);
      setLeads((cur) => ({ ...cur, ...Object.fromEntries((data as Lead[]).map((l) => [l.id, l])) }));
      setTagsByLead((m) => {
        const n = { ...m };
        (tr ?? []).forEach((r) => { if (!n[r.lead_id]?.includes(r.tag_id)) n[r.lead_id] = [...(n[r.lead_id] ?? []), r.tag_id]; });
        return n;
      });
    }
    setLoadingMore(null);
  }

  async function quickAdd(stage: Stage, name: string) {
    const first = columns[stage.id]?.[0];
    const { data, error } = await supabaseBrowser().from("leads")
      .insert({ organization_id: ws.orgId, pipeline_id: stage.pipeline_id, stage_id: stage.id, name, position: between(undefined, first?.position) })
      .select("*").single();
    if (error) { toast.error(error.message); return; }
    if (!leadsRef.current[data.id]) {
      leadsRef.current = { ...leadsRef.current, [data.id]: data as Lead };
      setLeads((cur) => ({ ...cur, [data.id]: data as Lead }));
      setCounts((c) => ({ ...c, [stage.id]: (c[stage.id] ?? 0) + 1 }));
    }
    setAdding(null);
  }

  if (!pipelineId || !stages.length) {
    return <Empty icon={<KanbanSquare className="h-5 w-5" />} title="Nenhum funil configurado" text="Crie etapas em Configurações → Funil." />;
  }

  const active = activeId ? leads[activeId] : null;
  const hasFilter = Boolean(q || tagFilter || ownerFilter || ageFilter);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-6">
        {ws.pipelines.length > 1 && (
          <select className="field h-9 w-auto" value={pipelineId} onChange={(e) => router.push(`/pipeline?p=${e.target.value}`)}>
            {ws.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="field h-9 pl-9" placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select className="field h-9 w-auto" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filtrar por tag">
            <option value="">Todas as tags</option>
            {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="field h-9 w-auto" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} aria-label="Filtrar por tempo">
            <option value="">Qualquer tempo</option>
            <optgroup label="Parados (sem mensagem nem mudança de etapa)">
              <option value="idle:3">Parados há 3+ dias</option>
              <option value="idle:7">Parados há 7+ dias</option>
              <option value="idle:14">Parados há 14+ dias</option>
              <option value="idle:30">Parados há 1+ mês</option>
            </optgroup>
            <optgroup label="Na base (desde que o lead entrou)">
              <option value="base:7">Na base há 7+ dias</option>
              <option value="base:14">Na base há 14+ dias</option>
              <option value="base:30">Na base há 1+ mês</option>
            </optgroup>
          </select>
          <select className="field h-9 w-auto" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            <option value="me">Meus leads</option>
            <option value="none">Sem responsável</option>
            {ws.members.filter((m) => m.user_id !== ws.userId).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</option>)}
          </select>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setQ(""); setTagFilter(""); setOwnerFilter(""); setAgeFilter(""); }}><X className="h-3.5 w-3.5" /> Limpar</Button>
          )}
        </div>
      </div>

      <DndContext id={`kanban-${pipelineId}`} sensors={sensors} collisionDetection={pointerFirst} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverStage(null); }}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:px-6">
          {stages.map((stage) => {
            const all = columns[stage.id] ?? [];
            const visible = hasFilter ? all.filter(matches) : all;
            const total = all.reduce((s, l) => s + Number(l.value || 0), 0);
            const count = counts[stage.id] ?? all.length;
            return (
              <Column key={stage.id} stage={stage} highlight={overStage === stage.id && activeId !== null && leads[activeId]?.stage_id !== stage.id}>
                <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color, boxShadow: `0 0 10px ${stage.color}` }} />
                  <h3 className="flex-1 truncate text-sm font-semibold text-slate-100">{stage.name}</h3>
                  <span className="rounded-md bg-ink-700 px-1.5 py-0.5 text-xs tabular-nums text-slate-300">{count}</span>
                  <button onClick={() => setAdding(stage.id)} className="rounded-md p-1 text-slate-500 hover:bg-ink-700 hover:text-white" aria-label={`Novo lead em ${stage.name}`}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <p className="px-3 pb-2 text-xs tabular-nums text-slate-500">{formatBRL(total)}{all.length < count ? " (parcial)" : ""}</p>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {adding === stage.id && <QuickAdd onCancel={() => setAdding(null)} onSave={(n) => quickAdd(stage, n)} />}
                  <SortableContext items={visible.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                    {visible.map((l) => (
                      <SortableLeadCard key={l.id} lead={l} tagIds={tagsByLead[l.id] ?? []} onOpen={() => setOpenLead(l.id)} />
                    ))}
                  </SortableContext>
                  {!visible.length && adding !== stage.id && (
                    <p className="rounded-lg border border-dashed border-line py-8 text-center text-xs text-slate-600">{hasFilter ? "Nenhum resultado" : "Arraste leads para cá"}</p>
                  )}
                  {all.length < count && !hasFilter && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => loadMore(stage.id)} loading={loadingMore === stage.id}>
                      Carregar mais ({count - all.length})
                    </Button>
                  )}
                </div>
              </Column>
            );
          })}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
          {active ? <div className="w-[272px]"><LeadCardView lead={active} tagIds={tagsByLead[active.id] ?? []} dragging /></div> : null}
        </DragOverlay>
      </DndContext>

      <ScheduleModal open={!!scheduleFor} onClose={() => setScheduleFor(null)} leadId={scheduleFor?.id ?? null} leadName={scheduleFor?.name ?? ""} />

      <LeadDrawer
        leadId={openLead}
        onClose={() => setOpenLead(null)}
        onSaved={(l) => setLeads((cur) => (stageIds.has(l.stage_id) ? { ...cur, [l.id]: l } : cur))}
        onTagsChange={(id, tags) => setTagsByLead((m) => ({ ...m, [id]: tags }))}
        onDeleted={(id) => {
          const gone = leadsRef.current[id];
          if (!gone) return;
          setCounts((c) => ({ ...c, [gone.stage_id]: Math.max(0, (c[gone.stage_id] ?? 1) - 1) }));
          setLeads((cur) => {
            const { [id]: _x, ...rest } = cur;
            return rest;
          });
        }}
      />
    </div>
  );
}

function Column({ stage, highlight, children }: { stage: Stage; highlight: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `col:${stage.id}` });
  return (
    <section ref={setNodeRef}
      className={cn("flex w-[288px] shrink-0 flex-col rounded-xl border bg-ink-900/70 transition-colors",
        highlight ? "border-brand-400/60 bg-brand-500/5" : "border-line")}>
      {children}
    </section>
  );
}

function QuickAdd({ onSave, onCancel }: { onSave: (name: string) => Promise<void> | void; onCancel: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="rounded-lg border border-brand-400/40 bg-ink-800 p-2"
      onSubmit={async (e) => { e.preventDefault(); if (!v.trim()) return; setBusy(true); await onSave(v.trim()); setBusy(false); }}
    >
      <input autoFocus className="field h-9" placeholder="Nome do lead" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} maxLength={160} />
      <div className="mt-2 flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" type="submit" disabled={!v.trim()}>{busy ? <Spinner className="h-3.5 w-3.5" /> : "Adicionar"}</Button>
      </div>
    </form>
  );
}

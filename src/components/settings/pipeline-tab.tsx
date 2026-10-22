"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { PALETTE } from "./tags-tab";
import type { Stage, StageKind } from "@/lib/types";

export function PipelineTab() {
  const ws = useWorkspace();
  const [newPipeline, setNewPipeline] = useState("");

  if (!ws.canManage) {
    return <Section title="Funil" text="Apenas administradores podem editar as etapas."><p className="text-sm text-slate-500">Fale com o responsável pela conta.</p></Section>;
  }

  const sb = () => supabaseBrowser();
  const reload = () => ws.reload(["stages", "pipelines"]);

  async function rename(s: Stage, name: string) {
    if (!name.trim() || name === s.name) return;
    const { error } = await sb().from("stages").update({ name: name.trim().slice(0, 60) }).eq("id", s.id);
    if (error) toast.error(error.message); else await reload();
  }
  async function patch(s: Stage, p: Partial<Pick<Stage, "color" | "kind">>) {
    const { error } = await sb().from("stages").update(p).eq("id", s.id);
    if (error) toast.error(error.message); else await reload();
  }
  async function move(list: Stage[], i: number, dir: -1 | 1) {
    const a = list[i], b = list[i + dir];
    if (!a || !b) return;
    const r1 = await sb().from("stages").update({ position: b.position }).eq("id", a.id);
    const r2 = await sb().from("stages").update({ position: a.position }).eq("id", b.id);
    if (r1.error || r2.error) toast.error("Falha ao reordenar");
    await reload();
  }
  async function add(pipelineId: string, list: Stage[]) {
    const { error } = await sb().from("stages").insert({ organization_id: ws.orgId, pipeline_id: pipelineId, name: "Nova etapa", position: (list.at(-1)?.position ?? -1) + 1, color: PALETTE[list.length % PALETTE.length] });
    if (error) toast.error(error.message); else await reload();
  }
  async function remove(s: Stage) {
    if (!confirm(`Excluir a etapa "${s.name}"?`)) return;
    const { error } = await sb().from("stages").delete().eq("id", s.id);
    if (error) toast.error(error.code === "23503" ? "Esta etapa tem leads. Mova-os para outra etapa antes de excluir." : error.message);
    else await reload();
  }
  async function addPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!newPipeline.trim()) return;
    const { data, error } = await sb().from("pipelines").insert({ organization_id: ws.orgId, name: newPipeline.trim().slice(0, 80), position: ws.pipelines.length }).select("id").single();
    if (error) return toast.error(error.message);
    await sb().from("stages").insert([
      { organization_id: ws.orgId, pipeline_id: data.id, name: "Entrada", position: 0, color: "#64748b" },
      { organization_id: ws.orgId, pipeline_id: data.id, name: "Ganho", position: 1, color: "#10b981", kind: "won" },
      { organization_id: ws.orgId, pipeline_id: data.id, name: "Perdido", position: 2, color: "#ef4444", kind: "lost" },
    ]);
    setNewPipeline("");
    await reload();
  }
  async function deletePipeline(id: string, name: string) {
    if (ws.pipelines.length <= 1) return toast.error("É preciso ter pelo menos um funil");
    if (!confirm(`Excluir o funil "${name}" e todos os leads dele? Esta ação não pode ser desfeita.`)) return;
    const { error } = await sb().from("pipelines").delete().eq("id", id);
    if (error) toast.error(error.code === "23503" ? "Mova os leads deste funil antes de excluí-lo." : error.message); else await reload();
  }

  return (
    <Section title="Funil de vendas" text="Etapas (colunas) do kanban. Etapas marcadas como Ganho/Perdido indicam o fim da negociação.">
      <div className="space-y-6">
        {ws.pipelines.map((p) => {
          const list = ws.stages.filter((s) => s.pipeline_id === p.id).sort((a, b) => a.position - b.position);
          return (
            <div key={p.id} className="card">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="font-medium text-white">{p.name}</p>
                {ws.pipelines.length > 1 && <Button size="sm" variant="ghost" className="hover:text-red-300" onClick={() => deletePipeline(p.id, p.name)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
              <ul className="divide-y divide-line">
                {list.map((s, i) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <div className="flex flex-col">
                      <button onClick={() => move(list, i, -1)} disabled={i === 0} className="text-slate-500 hover:text-white disabled:opacity-20" aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => move(list, i, 1)} disabled={i === list.length - 1} className="text-slate-500 hover:text-white disabled:opacity-20" aria-label="Descer"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <input type="color" value={s.color} onChange={(e) => patch(s, { color: e.target.value })} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent" aria-label="Cor" />
                    <input className="field h-9 max-w-[220px] flex-1" defaultValue={s.name} onBlur={(e) => rename(s, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} maxLength={60} />
                    <select className="field h-9 w-auto" value={s.kind} onChange={(e) => patch(s, { kind: e.target.value as StageKind })}>
                      <option value="open">Em andamento</option>
                      <option value="won">Ganho</option>
                      <option value="lost">Perdido</option>
                    </select>
                    <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 hover:text-red-300" onClick={() => remove(s)} aria-label="Excluir etapa"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line p-3"><Button size="sm" variant="ghost" onClick={() => add(p.id, list)}><Plus className="h-3.5 w-3.5" /> Adicionar etapa</Button></div>
            </div>
          );
        })}
        <form onSubmit={addPipeline} className="flex gap-2">
          <input className="field max-w-xs" placeholder="Nome do novo funil (ex.: Pós-venda)" value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} maxLength={80} />
          <Button type="submit" variant="outline" disabled={!newPipeline.trim()}><Plus className="h-4 w-4" /> Novo funil</Button>
        </form>
      </div>
    </Section>
  );
}

"use client";
import { useState } from "react";
import { Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Empty, TagPill } from "@/components/ui/misc";
import { Section } from "./section";

export const PALETTE = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#14b8a6", "#64748b"];

export function TagsTab() {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabaseBrowser().from("tags").insert({ organization_id: ws.orgId, name: name.trim().slice(0, 40), color });
    if (error) return toast.error(error.code === "23505" ? "Essa tag já existe" : error.message);
    setName("");
    await ws.reload(["tags"]);
  }
  async function update(id: string, patch: { name?: string; color?: string }) {
    const { error } = await supabaseBrowser().from("tags").update(patch).eq("id", id);
    if (error) return toast.error(error.code === "23505" ? "Já existe uma tag com esse nome" : error.message);
    await ws.reload(["tags"]);
  }
  async function remove(id: string, n: string) {
    if (!confirm(`Excluir a tag "${n}"? Ela será removida de todos os leads.`)) return;
    const { error } = await supabaseBrowser().from("tags").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await ws.reload(["tags"]);
  }

  return (
    <Section title="Tags" text="Etiquetas para segmentar leads (origem, interesse, prioridade…).">
      {ws.canManage && (
        <form onSubmit={add} className="card mb-4 flex flex-wrap items-center gap-3 p-4">
          <input className="field max-w-xs flex-1" placeholder="Nome da tag" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <div className="flex gap-1.5">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} className="h-6 w-6 rounded-full ring-offset-2 ring-offset-ink-850 transition" style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }} aria-label={`Cor ${c}`} />
            ))}
          </div>
          <Button type="submit" size="sm" disabled={!name.trim()}><Plus className="h-3.5 w-3.5" /> Criar</Button>
        </form>
      )}
      {ws.tags.length ? (
        <ul className="card divide-y divide-line">
          {ws.tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <TagPill name={t.name} color={t.color} />
              <div className="ml-auto flex items-center gap-1.5">
                {ws.canManage && PALETTE.map((c) => (
                  <button key={c} onClick={() => update(t.id, { color: c })} className="h-4 w-4 rounded-full opacity-50 transition hover:opacity-100" style={{ background: c, opacity: t.color === c ? 1 : undefined }} aria-label={`Mudar cor para ${c}`} />
                ))}
                {ws.canManage && <Button size="icon" variant="ghost" className="ml-2 h-8 w-8 hover:text-red-300" onClick={() => remove(t.id, t.name)} aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <div className="card"><Empty icon={<Tags className="h-5 w-5" />} title="Nenhuma tag" /></div>}
    </Section>
  );
}

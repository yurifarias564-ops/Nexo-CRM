"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Empty, Field, Modal } from "@/components/ui/misc";
import { Section } from "./section";
import type { QuickReply } from "@/lib/types";

export function QuickRepliesTab() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<Partial<QuickReply> | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const shortcut = (editing.shortcut ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    if (!shortcut) return toast.error("Atalho inválido (use letras, números, - ou _)");
    setBusy(true);
    const sb = supabaseBrowser();
    const payload = { shortcut, title: editing.title?.trim() ?? "", content: editing.content?.trim() ?? "" };
    const { error } = editing.id
      ? await sb.from("quick_replies").update(payload).eq("id", editing.id)
      : await sb.from("quick_replies").insert({ ...payload, organization_id: ws.orgId, created_by: ws.userId });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? `O atalho /${shortcut} já existe` : error.message);
    await ws.reload(["quickReplies"]);
    setEditing(null);
    toast.success("Mensagem rápida salva");
  }

  async function remove(q: QuickReply) {
    if (!confirm(`Excluir /${q.shortcut}?`)) return;
    const { error } = await supabaseBrowser().from("quick_replies").delete().eq("id", q.id);
    if (error) return toast.error(error.message);
    await ws.reload(["quickReplies"]);
  }

  return (
    <Section title="Mensagens rápidas" text="No chat, digite / e o atalho para inserir a mensagem. Variáveis: {nome}, {primeiro_nome}, {atendente}."
      action={<Button size="sm" onClick={() => setEditing({ shortcut: "", title: "", content: "" })}><Plus className="h-3.5 w-3.5" /> Nova</Button>}>
      {ws.quickReplies.length ? (
        <ul className="space-y-2">
          {ws.quickReplies.map((q) => (
            <li key={q.id} className="card group flex items-start gap-3 p-4">
              <code className="rounded-md bg-ink-950 px-2 py-1 text-xs text-brand-300">/{q.shortcut}</code>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-100">{q.title}</p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-400">{q.content}</p>
              </div>
              <div className="flex gap-1 opacity-60 transition group-hover:opacity-100">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(q)} aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-300" onClick={() => remove(q)} aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card"><Empty icon={<Zap className="h-5 w-5" />} title="Nenhuma mensagem rápida" text="Crie respostas prontas para agilizar o atendimento." /></div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar mensagem rápida" : "Nova mensagem rápida"} wide>
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-[160px_1fr] gap-3">
              <Field label="Atalho">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">/</span>
                  <input className="field pl-6" required value={editing.shortcut ?? ""} onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })} placeholder="preco" maxLength={32} />
                </div>
              </Field>
              <Field label="Título"><input className="field" required maxLength={80} value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Tabela de preços" /></Field>
            </div>
            <Field label="Mensagem" hint="Use {primeiro_nome} para personalizar com o nome do cliente.">
              <textarea className="field h-40 resize-y py-2" required maxLength={4096} value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} placeholder="Oi {primeiro_nome}! Segue nossa tabela…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" loading={busy}>Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Section>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Search, Tag as TagIcon, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { LeadDrawer } from "@/components/lead/lead-drawer";
import { ImportModal } from "./import-modal";
import { Button } from "@/components/ui/button";
import { Empty, Field, Modal, Spinner, TagPill } from "@/components/ui/misc";
import { LeadPhoto } from "@/components/lead/lead-photo";
import { formatBRL, formatPhone, normalizePhone } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time-ago";
import type { Lead } from "@/lib/types";

const PAGE = 50;
type Row = Lead & { lead_tags: { tag_id: string }[] };

export function LeadsTable() {
  const ws = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkStage, setBulkStage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabaseBrowser().from("leads").select("*, lead_tags(tag_id)", { count: "exact" })
      .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    const s = q.trim().replace(/[%_,()]/g, "");
    if (s) {
      const digits = s.replace(/\D/g, "");
      query = digits.length >= 4 ? query.like("phone", `%${digits}%`) : query.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    if (stage) query = query.eq("stage_id", stage);
    const { data, count, error } = await query;
    if (error) toast.error("Falha ao carregar leads");
    setRows((data ?? []) as Row[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, q, stage]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    const r = () => load();
    window.addEventListener("crm:refresh", r);
    return () => window.removeEventListener("crm:refresh", r);
  }, [load]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function bulkMove() {
    if (!bulkStage) return;
    const { error } = await supabaseBrowser().from("leads").update({ stage_id: bulkStage }).in("id", [...selected]);
    if (error) return toast.error(error.message);
    toast.success(`${selected.size} leads movidos`);
    setBulkStage(""); setSelected(new Set()); void load();
  }
  async function bulkAddTag() {
    if (!bulkTag) return;
    const { error } = await supabaseBrowser().from("lead_tags")
      .upsert([...selected].map((lead_id) => ({ lead_id, tag_id: bulkTag, organization_id: ws.orgId })), { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
    if (error) return toast.error(error.message);
    toast.success("Tag aplicada");
    setBulkTag(""); setSelected(new Set()); void load();
  }
  async function bulkDelete() {
    if (!confirm(`Excluir ${selected.size} leads permanentemente? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabaseBrowser().from("leads").delete().in("id", [...selected]);
    if (error) return toast.error(error.message);
    toast.success("Leads excluídos");
    setSelected(new Set()); void load();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-6">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="field h-9 pl-9" placeholder="Nome, e-mail ou telefone" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); setSelected(new Set()); }} />
        </div>
        <select className="field h-9 w-auto" value={stage} onChange={(e) => { setStage(e.target.value); setPage(0); setSelected(new Set()); }} aria-label="Filtrar etapa">
          <option value="">Todas as etapas</option>
          {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}><Upload className="h-3.5 w-3.5" /> Importar</Button>
          <a href={`/api/leads/export${stage ? `?stage=${stage}` : ""}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-slate-200 hover:border-brand-400/40 hover:bg-ink-800">
            <Download className="h-3.5 w-3.5" /> Exportar Excel
          </a>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> Novo lead</Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-brand-400/20 bg-brand-500/10 px-4 py-2 text-sm md:px-6">
          <span className="font-medium text-brand-100">{selected.size} selecionado(s)</span>
          <select className="field h-8 w-auto text-xs" value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
            <option value="">Mover para…</option>
            {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={bulkMove} disabled={!bulkStage}>Mover</Button>
          <select className="field h-8 w-auto text-xs" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}>
            <option value="">Adicionar tag…</option>
            {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={bulkAddTag} disabled={!bulkTag}><TagIcon className="h-3.5 w-3.5" /> Aplicar</Button>
          {ws.canManage && <Button size="sm" variant="danger" onClick={bulkDelete} className="ml-auto"><Trash2 className="h-3.5 w-3.5" /> Excluir</Button>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900/95 text-left text-xs uppercase tracking-wide text-slate-500 backdrop-blur">
            <tr className="border-b border-line">
              <th className="w-10 px-4 py-3"><input type="checkbox" className="accent-blue-500" checked={allChecked} onChange={toggleAll} aria-label="Selecionar todos" /></th>
              <th className="px-2 py-3 font-medium">Lead</th>
              <th className="px-2 py-3 font-medium">Etapa</th>
              <th className="px-2 py-3 font-medium">Tags</th>
              <th className="px-2 py-3 text-right font-medium">Valor</th>
              <th className="px-2 py-3 font-medium">Responsável</th>
              <th className="px-4 py-3 font-medium">Última msg.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const st = ws.stageById.get(l.stage_id);
              const owner = l.assigned_to ? ws.memberById.get(l.assigned_to) : null;
              return (
                <tr key={l.id} onClick={() => setOpen(l.id)} className="cursor-pointer border-b border-line/50 transition hover:bg-ink-800/60">
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-blue-500" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Selecionar ${l.name}`} />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-3">
                      <LeadPhoto lead={l} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-100">{l.name}</p>
                        <p className="truncate text-xs text-slate-500">{formatPhone(l.phone) || l.email || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    {st && <span className="inline-flex items-center gap-1.5 text-slate-300"><span className="h-2 w-2 rounded-full" style={{ background: st.color }} />{st.name}</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {l.lead_tags.slice(0, 3).map(({ tag_id }) => { const t = ws.tagById.get(tag_id); return t ? <TagPill key={tag_id} name={t.name} color={t.color} /> : null; })}
                      {l.lead_tags.length > 3 && <span className="text-xs text-slate-500">+{l.lead_tags.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-200">{formatBRL(l.value)}</td>
                  <td className="px-2 py-2.5 text-slate-400">{owner?.full_name ?? owner?.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500"><TimeAgo iso={l.last_message_at} fallback="—" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <div className="flex justify-center py-10"><Spinner /></div>}
        {!loading && !rows.length && (
          <Empty icon={<Users className="h-5 w-5" />} title={q || stage ? "Nenhum lead encontrado" : "Nenhum lead ainda"}
            text={q || stage ? "Ajuste a busca ou os filtros." : "Importe uma planilha, crie manualmente ou conecte o WhatsApp para os leads chegarem sozinhos."}
            action={!q && !stage ? <Button size="sm" onClick={() => setImporting(true)}><Upload className="h-3.5 w-3.5" /> Importar planilha</Button> : undefined} />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-slate-400 md:px-6">
        <span>{total.toLocaleString("pt-BR")} leads</span>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="tabular-nums">{page + 1} / {pages}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => { void load(); void ws.reload(["tags"]); }} />
      <CreateLeadModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void load(); setOpen(id); }} />
      <LeadDrawer leadId={open} onClose={() => setOpen(null)} onSaved={() => void load()} onDeleted={() => void load()} onTagsChange={() => void load()} />
    </div>
  );
}

function CreateLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const ws = useWorkspace();
  const [form, setForm] = useState({ name: "", phone: "", email: "", value: "", stage_id: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const stage = ws.stageById.get(form.stage_id) ?? [...ws.stages].sort((a, b) => a.position - b.position)[0];
    if (!stage) return toast.error("Crie uma etapa primeiro");
    const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
    if (form.phone.trim() && !phone) return toast.error("Telefone inválido");
    setBusy(true);
    const { data, error } = await supabaseBrowser().from("leads").insert({
      organization_id: ws.orgId, pipeline_id: stage.pipeline_id, stage_id: stage.id, name: form.name.trim(), phone,
      email: form.email.trim() || null, value: Number(form.value.replace(",", ".")) || 0, source: "Manual", position: -Date.now() / 1000,
    }).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "Já existe um lead com este telefone" : error.message);
    setForm({ name: "", phone: "", email: "", value: "", stage_id: "" });
    onCreated(data.id);
  }
  return (
    <Modal open={open} onClose={onClose} title="Novo lead">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome"><input className="field" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone"><input className="field" inputMode="tel" placeholder="(85) 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Valor (R$)"><input className="field" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
        </div>
        <Field label="E-mail"><input className="field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Etapa">
          <select className="field" value={form.stage_id} onChange={(e) => setForm({ ...form, stage_id: e.target.value })}>
            <option value="">Primeira etapa</option>
            {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!form.name.trim()}>Criar lead</Button>
        </div>
      </form>
    </Modal>
  );
}

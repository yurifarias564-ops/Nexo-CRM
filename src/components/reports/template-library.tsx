"use client";
import { useRef, useState } from "react";
import { ChevronDown, Download, FileText, Layers, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, type Template } from "./shared";

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/**
 * Relatórios de exemplo do consultor. Cada modelo é dele (vale para todos os
 * clientes que ele administra): envia uma vez e reutiliza em todas as empresas.
 */
export function TemplateLibrary({ templates, selectedId, onSelect, onChange }: {
  templates: Template[]; selectedId: string | null; onSelect: (t: Template) => void; onChange: () => void;
}) {
  const ws = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(file: File) {
    if (file.size > 15 * 1024 * 1024) return toast.error("Arquivo maior que 15 MB");
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    const t = toast.loading("Lendo o relatório de exemplo… (pode levar até 1 minuto)");
    try {
      await api("/api/reports/templates", { method: "POST", body: fd });
      toast.success("Modelo pronto! Escolha-o para esta empresa.", { id: t });
      onChange();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(t: Template) {
    if (!confirm(`Excluir o modelo "${t.name}"? Empresas que usam este modelo ficarão sem modelo até você escolher outro.`)) return;
    setBusy(t.id);
    try { await api(`/api/reports/templates/${t.id}`, { method: "DELETE" }); toast.success("Modelo excluído"); onChange(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  }

  async function applyAll(t: Template) {
    if (!confirm(`Usar "${t.name}" como modelo em TODAS as empresas que você administra?`)) return;
    setBusy(t.id);
    try {
      const r = await api<{ applied: number }>(`/api/reports/templates/${t.id}/apply-all`, { method: "POST" });
      toast.success(`Modelo aplicado em ${r.applied} ${r.applied === 1 ? "empresa" : "empresas"}`);
      onChange();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Modelos de relatório</h3>
          <p className="mt-0.5 text-sm text-slate-400">Envie um relatório de exemplo (PDF ou Word). A IA aprende a estrutura e escreve os próximos no mesmo formato, com os números reais de cada cliente.</p>
        </div>
        {ws.canManage && (
          <>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button size="sm" onClick={() => input.current?.click()} loading={uploading}><Upload className="h-3.5 w-3.5" /> Enviar exemplo</Button>
          </>
        )}
      </div>

      {templates.length === 0 ? (
        <button type="button" disabled={!ws.canManage || uploading} onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && ws.canManage) void upload(f); }}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-slate-400 transition hover:border-brand-400/50 hover:text-slate-200">
          <FileText className="h-6 w-6 text-brand-300" />
          Arraste aqui o relatório de exemplo ou clique para escolher
          <span className="text-xs text-slate-500">PDF, Word (.docx) ou texto · até 15 MB</span>
        </button>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => {
            const selected = t.id === selectedId;
            const expanded = open === t.id;
            return (
              <li key={t.id} className={cn("rounded-xl border bg-ink-850 transition", selected ? "border-brand-400/60 ring-1 ring-brand-400/30" : "border-line")}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-brand-300" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{t.name}{selected && <span className="ml-2 rounded bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-200">em uso</span>}</p>
                    <p className="truncate text-xs text-slate-500">{t.blueprint.sections?.length ?? 0} seções · {t.file_name}</p>
                  </div>
                  <button type="button" onClick={() => setOpen(expanded ? null : t.id)} className="rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-slate-200" aria-label="Ver estrutura" aria-expanded={expanded}>
                    <ChevronDown className={cn("h-4 w-4 transition", expanded && "rotate-180")} />
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-line px-3 py-3 text-sm">
                    {t.blueprint.tone && <p className="mb-2 text-xs text-slate-400"><b className="text-slate-300">Tom:</b> {t.blueprint.tone}</p>}
                    <ol className="list-decimal space-y-1 pl-5 text-slate-300">
                      {(t.blueprint.sections ?? []).map((s, i) => <li key={i}><b>{s.title}</b> <span className="text-slate-500">— {s.purpose}</span></li>)}
                    </ol>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ws.canManage && !selected && <Button size="sm" onClick={() => onSelect(t)}>Usar nesta empresa</Button>}
                      {ws.canManage && <Button size="sm" variant="outline" onClick={() => applyAll(t)} loading={busy === t.id}><Layers className="h-3.5 w-3.5" /> Usar em todos os clientes</Button>}
                      <a href={`/api/reports/templates/${t.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-slate-300 hover:bg-ink-800"><Download className="h-3.5 w-3.5" /> Arquivo original</a>
                      <Button size="sm" variant="danger" onClick={() => remove(t)} disabled={busy === t.id}><Trash2 className="h-3.5 w-3.5" /> Excluir</Button>
                    </div>
                  </div>
                )}
                {!expanded && ws.canManage && !selected && (
                  <div className="px-3 pb-2.5"><button type="button" onClick={() => onSelect(t)} className="text-xs font-medium text-brand-300 hover:text-brand-200">Usar nesta empresa →</button></div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

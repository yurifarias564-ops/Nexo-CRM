"use client";
import { useRef, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Result = { inserted: number; updated: number; skipped: number; errors: { row: number; message: string }[] };

export function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [stageId, setStageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return toast.error("Use um arquivo .xlsx ou .csv");
    if (f.size > 8 * 1024 * 1024) return toast.error("Arquivo maior que 8 MB");
    setFile(f);
    setResult(null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (stageId) fd.append("stageId", stageId);
      const res = await fetch("/api/leads/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na importação");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setFile(null);
    setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Importar leads" wide
      footer={result ? <Button onClick={close}>Concluir</Button> : (
        <>
          <Button variant="ghost" onClick={close}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={!file}><Upload className="h-4 w-4" /> Importar</Button>
        </>
      )}>
      {result ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-6 w-6 text-emerald-300" />
            <div className="text-sm text-emerald-100">
              <b>{result.inserted}</b> novos · <b>{result.updated}</b> atualizados{result.skipped ? <> · <b>{result.skipped}</b> ignorados</> : null}
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="label">Avisos ({result.errors.length})</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink-950/50 p-3 text-xs text-slate-400">
                {result.errors.map((e, i) => <li key={i}><span className="text-amber-300">Linha {e.row}:</span> {e.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            onClick={() => input.current?.click()}
            className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
              drag ? "border-brand-400 bg-brand-500/10" : "border-line hover:border-brand-400/50 hover:bg-ink-800/50")}
          >
            <FileSpreadsheet className="h-8 w-8 text-brand-300" />
            {file ? <p className="font-medium text-white">{file.name}</p> : <p className="text-sm text-slate-300">Arraste a planilha aqui ou <span className="text-brand-300">clique para escolher</span></p>}
            <p className="text-xs text-slate-500">.xlsx ou .csv · até 20.000 linhas</p>
            <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <Field label="Etapa padrão" hint="Usada quando a planilha não tiver a coluna Etapa (ou ela não bater com nenhuma etapa).">
            <select className="field" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Primeira etapa do funil</option>
              {ws.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="rounded-lg border border-line bg-ink-950/50 p-3 text-xs text-slate-400">
            Colunas reconhecidas: <b className="text-slate-300">Nome, Telefone, E-mail, Valor, Etapa, Tags, Origem, Observações</b>. Leads com telefone já cadastrado são <b className="text-slate-300">atualizados</b>, sem duplicar.
            <a href="/api/leads/template" className="mt-2 flex items-center gap-1 text-brand-300 hover:underline"><Download className="h-3.5 w-3.5" /> Baixar planilha modelo</a>
          </div>
        </div>
      )}
    </Modal>
  );
}

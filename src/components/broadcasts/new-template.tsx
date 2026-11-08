"use client";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { formatMoney, META_BR_RATES } from "@/lib/broadcasts";

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

/** Cria um modelo da API oficial e manda para a Meta aprovar. */
export function NewTemplateModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [headerType, setHeaderType] = useState<HeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [sample, setSample] = useState<File | null>(null);
  const [body, setBody] = useState("Olá {{1}}, tudo bem? ");
  const [examples, setExamples] = useState<string[]>(["Maria"]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fields = useMemo(() => {
    const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    return nums.length ? Math.max(...nums) : 0;
  }, [body]);
  const ex = Array.from({ length: fields }, (_, i) => examples[i] ?? "");

  function addField() {
    setBody((b) => `${b}{{${fields + 1}}} `);
  }

  async function submit() {
    setSaving(true);
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ channelId, name, category, headerType, headerText, body, examples: ex, footer, quickReplies: buttons.filter((b) => b.trim()) }));
    if (sample && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) fd.set("sample", sample);
    const r = await fetch("/api/broadcasts/templates", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return toast.error(j.error ?? "A Meta não aceitou o modelo");
    toast.success("Modelo enviado. A Meta costuma aprovar em minutos, mas pode levar até 24 h.");
    onClose();
  }

  const preview = body.replace(/\{\{(\d+)\}\}/g, (_m, n) => ex[Number(n) - 1] || `{{${n}}}`);
  const ok = name.trim() && body.trim() && ex.every((e) => e.trim()) && (headerType !== "TEXT" || headerText.trim()) && (!["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) || sample);

  return (
    <Modal open onClose={onClose} title="Criar modelo para a Meta aprovar" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={saving} disabled={!ok}>Enviar para aprovação</Button></>}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="label">Nome do modelo</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: reativacao_clientes" maxLength={100} />
          <span className="mt-1 block text-xs text-slate-500">Vira letras minúsculas e “_”. Só você vê.</span>
        </label>

        <div>
          <span className="label">Categoria</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["MARKETING", "UTILITY"] as const).map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={cn("rounded-xl border p-3 text-left", category === c ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800")}>
                <p className="font-medium text-white">{c === "MARKETING" ? "Marketing" : "Utilidade"} <span className="text-xs font-normal text-slate-400">· {formatMoney(META_BR_RATES.BRL[c], "BRL")}/msg</span></p>
                <p className="text-xs text-slate-400">{c === "MARKETING" ? "Promoção, oferta, reativação, novidade" : "Aviso de pedido, agendamento, conta. Sem oferta: se tiver, a Meta muda para marketing."}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Cabeçalho (opcional)</span>
          <div className="seg">
            {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const).map((h) => (
              <button key={h} onClick={() => { setHeaderType(h); setSample(null); }} className={cn(headerType === h && "on")}>
                {{ NONE: "Nenhum", TEXT: "Título", IMAGE: "Foto", VIDEO: "Vídeo", DOCUMENT: "PDF" }[h]}
              </button>
            ))}
          </div>
          {headerType === "TEXT" && <input className="field mt-2" maxLength={60} value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Título em negrito" />}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && (
            <label className="mt-2 block">
              <span className="text-xs text-slate-400">Arquivo de exemplo (a Meta usa para aprovar; no disparo você escolhe o arquivo de verdade)</span>
              <input type="file" className="mt-1 block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-slate-100"
                accept={headerType === "IMAGE" ? "image/jpeg,image/png" : headerType === "VIDEO" ? "video/mp4" : "application/pdf"} onChange={(e) => setSample(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Mensagem</span>
            <button onClick={addField} className="rounded-full border border-line px-2 py-0.5 text-xs text-slate-300 hover:bg-ink-800">+ Campo variável {`{{${fields + 1}}}`}</button>
          </div>
          <textarea className="field h-32 resize-y py-2" maxLength={1024} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Campos {"{{1}}"}, {"{{2}}"}… viram o nome do lead ou um texto na hora do disparo. Não comece nem termine a mensagem com um campo.</p>
        </div>

        {fields > 0 && (
          <div className="space-y-2">
            <span className="label">Exemplo de cada campo (exigido pela Meta)</span>
            {ex.map((v, i) => (
              <label key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-400">{`{{${i + 1}}}`}</span>
                <input className="field" value={v} maxLength={200} onChange={(e) => setExamples((xs) => { const n = [...xs]; n[i] = e.target.value; return n; })} placeholder={i === 0 ? "Maria" : "Exemplo"} />
              </label>
            ))}
          </div>
        )}

        <label className="block">
          <span className="label">Rodapé (opcional)</span>
          <input className="field" maxLength={60} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Ex.: Responda SAIR para não receber mais" />
        </label>

        <div>
          <span className="label">Botões de resposta rápida (até 3)</span>
          <div className="space-y-2">
            {buttons.map((b, i) => (
              <div key={i} className="flex gap-2">
                <input className="field" maxLength={25} value={b} onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Ex.: Quero saber mais" />
                <button onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))} className="px-2 text-slate-500 hover:text-red-300" aria-label="Remover"><X className="h-4 w-4" /></button>
              </div>
            ))}
            {buttons.length < 3 && <Button size="sm" variant="outline" onClick={() => setButtons([...buttons, ""])}><Plus className="h-3.5 w-3.5" /> Botão</Button>}
          </div>
        </div>

        <div className="chat-bg rounded-xl p-3">
          <div className="ml-auto max-w-[85%] rounded-lg bg-emerald-900/70 px-2.5 py-1.5 text-[13px] text-slate-100">
            {headerType === "TEXT" && headerText && <p className="font-semibold">{headerText}</p>}
            {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && <p className="mb-1 rounded bg-black/30 py-5 text-center text-xs text-slate-300">{sample?.name ?? "Mídia"}</p>}
            <p className="whitespace-pre-wrap">{preview}</p>
            {footer && <p className="mt-1 text-[11px] text-slate-400">{footer}</p>}
            {buttons.filter((b) => b.trim()).map((b, i) => <p key={i} className="mt-1 border-t border-white/10 pt-1 text-center text-sky-300">{b}</p>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

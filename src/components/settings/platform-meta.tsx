"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Settings2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Info { webhookUrl: string; verifyToken: string | null; appId: string; configId: string | null; appSecret: boolean; fields: string[] }

function copy(v: string) { void navigator.clipboard.writeText(v); toast.success("Copiado"); }
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-40 shrink-0 text-xs text-slate-400">{label}</span>
      {value ? (
        <button type="button" onClick={() => copy(value)} className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-1.5 text-left font-mono text-xs text-slate-200 hover:border-brand-400/50">
          <span className="truncate">{value}</span><Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </button>
      ) : <span className="text-xs text-amber-300">pendente</span>}
    </div>
  );
}
function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">{ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <XCircle className="h-3.5 w-3.5 text-amber-300" />}<span className={ok ? "text-slate-300" : "text-amber-200"}>{text}</span></span>
  );
}

/** Cartão visível só para o dono da plataforma: dados para configurar o app da Meta. */
export function PlatformMeta() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/platform/meta").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setInfo(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!info) return null;

  return (
    <div className="card mb-5 space-y-3 border-brand-400/30 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white"><Settings2 className="h-4 w-4 text-brand-300" /> App da Meta (só você vê — vale para todos os clientes)</div>
      <Row label="URL do webhook" value={info.webhookUrl} />
      <Row label="Token de verificação" value={info.verifyToken} />
      <Row label="ID do app" value={info.appId} />
      <Row label="Campos do webhook" value={info.fields.join(", ")} />
      <div className="flex flex-wrap gap-4 pt-1">
        <Check ok={info.appSecret} text={info.appSecret ? "Chave secreta do app configurada" : "Falta META_APP_SECRET na Vercel"} />
        <Check ok={!!info.configId} text={info.configId ? "Conexão em 1 clique ativa" : "Falta o ID da configuração (Embedded Signup)"} />
      </div>
    </div>
  );
}

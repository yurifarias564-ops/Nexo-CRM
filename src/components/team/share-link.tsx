"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { relativeTime } from "@/lib/utils";

interface Share { url: string; createdAt: string; lastUsedAt: string | null }

/** Link do checklist para o cliente (a empresa atual, ou outra pela aba Parceiros). */
export function ShareLink({ org, compact }: { org?: string; compact?: boolean }) {
  const [share, setShare] = useState<Share | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const q = org ? `?org=${org}` : "";
  const load = useCallback(async () => {
    const r = await fetch(`/api/team/share${q}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? "Erro"); setShare(null); return; }
    setShare(j.share);
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function create(rotate: boolean) {
    if (rotate && !confirm("Gerar um link novo? O link atual para de funcionar para quem já tem.")) return;
    setBusy(true);
    const r = await fetch("/api/team/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: org ?? null }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(j.error ?? "Erro");
    setShare(j.share);
    await copy(j.share.url);
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Link copiado"); } catch { toast.message(url); }
  }

  if (share === undefined) return <Spinner className="h-4 w-4" />;
  if (!share) return <Button size="sm" variant="outline" onClick={() => void create(false)} loading={busy}><Link2 className="h-3.5 w-3.5" /> Criar link do checklist</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && <code className="max-w-full truncate rounded bg-ink-800 px-2 py-1 text-xs text-slate-300">{share.url}</code>}
      <Button size="sm" onClick={() => void copy(share.url)}><Copy className="h-3.5 w-3.5" /> Copiar link</Button>
      <a href={share.url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> Abrir</Button></a>
      <Button size="sm" variant="ghost" onClick={() => void create(true)} loading={busy} title="Gerar um link novo"><RefreshCw className="h-3.5 w-3.5" /></Button>
      {!compact && <span className="text-xs text-slate-500">{share.lastUsedAt ? `usado ${relativeTime(share.lastUsedAt)}` : "ainda não usado"}</span>}
    </div>
  );
}

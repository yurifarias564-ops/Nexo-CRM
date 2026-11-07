"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";
import { toast } from "sonner";

/** Faixa quando o dono da plataforma está dentro da conta de um cliente. */
export function SupportBar({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    const res = await fetch(`/api/platform/partners/${orgId}/access`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json()).error);
    router.push("/parceiros");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-100">
      <Handshake className="h-3.5 w-3.5" />
      <span className="flex-1 truncate">Você está na conta de <b>{orgName}</b> como suporte. Tudo o que fizer aqui fica registrado.</span>
      <button onClick={() => void leave()} disabled={busy} className="rounded-md border border-amber-400/40 px-2.5 py-1 font-medium hover:bg-amber-500/20">{busy ? "Saindo…" : "Sair e voltar para Parceiros"}</button>
    </div>
  );
}

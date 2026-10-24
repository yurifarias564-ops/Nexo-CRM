"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QrCode, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { formatPhone } from "@/lib/utils";

interface Ch {
  id: string; name: string; phone_number: string | null; provider: string; status: string;
  disconnected_at: string | null; next_retry_at: string | null; retry_count: number; needs_qr: boolean;
}
const COLS = "id, name, phone_number, provider, status, disconnected_at, next_retry_at, retry_count, needs_qr";

/**
 * Aviso piscando quando um número por QR Code cai: mostra a contagem regressiva da
 * reconexão automática, avisa quando voltou e, se a sessão foi encerrada, pede o QR.
 */
export function ConnectionAlert() {
  const ws = useWorkspace();
  const [chs, setChs] = useState<Ch[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const prev = useRef<Map<string, string>>(new Map());

  const apply = useCallback((list: Ch[]) => {
    for (const c of list) {
      const was = prev.current.get(c.id);
      if (was && was !== "connected" && c.status === "connected") toast.success(`WhatsApp ${c.name} reconectado ✓`);
      prev.current.set(c.id, c.status);
    }
    setChs(list);
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("whatsapp_channels").select(COLS).eq("organization_id", ws.orgId).in("provider", ["evolution", "zapi"]);
    apply((data ?? []) as Ch[]);
  }, [ws.orgId, apply]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const sb = supabaseBrowser();
    const sub = sb.channel(`conn-alert-${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_channels", filter: `organization_id=eq.${ws.orgId}` }, () => void load())
      .subscribe();
    return () => { clearTimeout(t); void sb.removeChannel(sub); };
  }, [ws.orgId, load]);

  const down = chs.filter((c) => c.status !== "connected" && (c.disconnected_at || c.needs_qr));
  // Reserva se o tempo real atrasar: confere a cada 5 s enquanto há queda, senão a cada 30 s
  useEffect(() => {
    const poll = setInterval(() => void load(), down.length ? 5_000 : 30_000);
    return () => clearInterval(poll);
  }, [down.length, load]);
  useEffect(() => {
    if (!down.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [down.length]);

  async function retry(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/channels/${id}/reconnect`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.result === "needs_qr") toast.error("A sessão foi encerrada no celular: escaneie o QR Code de novo.");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  if (!down.length) return null;
  return (
    <div className="space-y-1.5 px-3 pt-2" role="alert" aria-live="assertive">
      {down.map((c) => {
        const label = c.phone_number ? `${c.name} (${formatPhone(c.phone_number)})` : c.name;
        const secs = c.next_retry_at ? Math.max(0, Math.ceil((new Date(c.next_retry_at).getTime() - now) / 1000)) : 0;
        const offFor = c.disconnected_at ? Math.max(0, Math.floor((now - new Date(c.disconnected_at).getTime()) / 1000)) : 0;
        const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/50 bg-red-600/15 px-4 py-2.5 text-sm text-red-50 shadow-card">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            {c.needs_qr ? <QrCode className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0 animate-pulse" />}
            <p className="min-w-0 flex-1">
              <b>WhatsApp {label} desconectou.</b>{" "}
              {c.needs_qr ? (
                <>A sessão foi encerrada no celular — é preciso escanear o QR Code de novo.</>
              ) : c.status === "connecting" || secs === 0 ? (
                <>Reconectando agora… aguarde.</>
              ) : (
                <>Aguarde: reconexão automática em <b className="tabular-nums">{mmss(secs)}</b>{c.retry_count > 0 ? ` (tentativa ${c.retry_count + 1})` : ""}.</>
              )}
              {offFor > 0 && <span className="ml-1 text-red-200/80">Fora do ar há {mmss(offFor)}.</span>}
            </p>
            {c.needs_qr ? (
              ws.canManage
                ? <Link href="/settings?tab=whatsapp" className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Escanear QR Code</Link>
                : <span className="text-xs text-red-200">Avise o administrador</span>
            ) : (
              <button onClick={() => void retry(c.id)} disabled={busy === c.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/40 px-3 py-1.5 text-xs font-medium hover:bg-red-500/20 disabled:opacity-60">
                <RefreshCw className={`h-3.5 w-3.5 ${busy === c.id ? "animate-spin" : ""}`} /> Tentar agora
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

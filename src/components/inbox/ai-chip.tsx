"use client";
import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { cn } from "@/lib/utils";

type State = "auto" | "paused" | "off";
const LABEL: Record<State, string> = { auto: "IA atendendo", paused: "IA pausada", off: "IA desligada" };

let agentOnCache: { org: string; on: boolean; at: number } | null = null;

/** Mostra e muda o estado da IA nesta conversa. Só aparece se o agente da empresa estiver ligado. */
export function AiChip({ conv }: { conv: { id: string; ai_state?: string; ai_paused_until?: string | null } }) {
  const ws = useWorkspace();
  const [agentOn, setAgentOn] = useState<boolean>(() => (agentOnCache?.org === ws.orgId ? agentOnCache.on : false));
  const [state, setState] = useState<State>((conv.ai_state as State) ?? "auto");
  const [until, setUntil] = useState(conv.ai_paused_until ?? null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (agentOnCache?.org === ws.orgId && Date.now() - agentOnCache.at < 60_000) return;
    void supabaseBrowser().from("ai_agents").select("enabled").eq("organization_id", ws.orgId).maybeSingle().then(({ data }) => {
      agentOnCache = { org: ws.orgId, on: Boolean(data?.enabled), at: Date.now() };
      setAgentOn(Boolean(data?.enabled));
    });
  }, [ws.orgId]);

  // Acompanha mudanças feitas pela própria IA (ex.: transferiu para vendedor)
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => sb.from("conversations").select("ai_state, ai_paused_until").eq("id", conv.id).maybeSingle()
      .then(({ data }) => { if (data) { setState(data.ai_state as State); setUntil(data.ai_paused_until); } });
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [conv.id]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (!agentOn) return null;

  async function change(s: State) {
    setOpen(false);
    const res = await fetch(`/api/conversations/${conv.id}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: s }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setState(s); setUntil(null);
    toast.success(s === "auto" ? "A IA volta a responder nesta conversa" : s === "paused" ? "IA pausada nesta conversa" : "IA desligada nesta conversa");
  }

  const pausedUntil = state === "paused" && until ? new Date(until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} title={pausedUntil ? `Pausada até ${pausedUntil}` : LABEL[state]}
        className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
          state === "auto" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : state === "paused" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-line text-slate-400")}>
        <Bot className="h-3.5 w-3.5" /> <span className="hidden lg:inline">{LABEL[state]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl border border-line bg-ink-850 py-1 text-sm shadow-xl">
          {pausedUntil && <p className="px-3 py-1.5 text-[11px] text-slate-500">Pausada até {pausedUntil}</p>}
          {state !== "auto" && <button onClick={() => void change("auto")} className="block w-full px-3 py-2 text-left text-emerald-200 hover:bg-ink-800">▶ IA volta a responder</button>}
          {state !== "paused" && <button onClick={() => void change("paused")} className="block w-full px-3 py-2 text-left text-amber-200 hover:bg-ink-800">⏸ Pausar (eu assumo)</button>}
          {state !== "off" && <button onClick={() => void change("off")} className="block w-full px-3 py-2 text-left text-slate-300 hover:bg-ink-800">⏹ Desligar nesta conversa</button>}
        </div>
      )}
    </div>
  );
}

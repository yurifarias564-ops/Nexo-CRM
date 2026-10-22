"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Avatar, Portal } from "@/components/ui/misc";
import { cn, formatPhone } from "@/lib/utils";
import { createPeer, fmtDuration, getMic, makeAnswer, makeOffer, ringtone, startMixRecorder } from "./webrtc";

type Phase = "preparing" | "ringing" | "connecting" | "connected" | "ended";
interface Active { callId: string | null; name: string; phone: string; direction: "out" | "in"; phase: Phase; since: number | null; muted: boolean; recording: string; endedLabel?: string }
interface Incoming { id: string; name: string; phone: string; sdp: string; recording: string }
interface CallRowLive { id: string; direction: string; status: string; sdp_offer: string | null; sdp_answer: string | null; wa_id: string; conversation_id: string | null; recording_mode: string; started_by: string | null; answered_by: string | null }

const TERMINAL = ["completed", "failed", "rejected", "missed", "canceled"];
const END_LABEL: Record<string, string> = { completed: "Ligação encerrada", failed: "A ligação falhou", rejected: "O cliente recusou", missed: "O cliente não atendeu", canceled: "Ligação cancelada" };

interface Ctx { start: (p: { conversationId: string; name: string; phone: string }) => Promise<void>; busy: boolean }
const CallCtx = createContext<Ctx | null>(null);
export const useCalls = () => {
  const c = useContext(CallCtx);
  if (!c) throw new Error("useCalls fora do CallProvider");
  return c;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? "Erro na ligação"), { code: (body as { code?: string }).code });
  return body as T;
}

/** Mantém a ligação viva enquanto a pessoa navega pelo CRM (barra flutuante). */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const [active, setActive] = useState<Active | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [tick, setTick] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<{ stop: () => Promise<Blob | null> } | null>(null);
  const answeredRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const recModeRef = useRef("meta");

  const cleanupMedia = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    remoteRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    answeredRef.current = false;
  }, []);

  const finish = useCallback(async (status: string) => {
    const id = callIdRef.current;
    callIdRef.current = null;
    const rec = recRef.current;
    recRef.current = null;
    cleanupMedia();
    setActive((a) => (a ? { ...a, phase: "ended", endedLabel: END_LABEL[status] ?? "Ligação encerrada" } : a));
    setTimeout(() => setActive((a) => (a?.phase === "ended" ? null : a)), 6000);
    if (rec && id) {
      const blob = await rec.stop();
      if (blob && blob.size > 2000) {
        const res = await fetch(`/api/calls/${id}/recording`, { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob });
        if (!res.ok) toast.error("Não foi possível salvar a cópia da gravação");
      }
    }
  }, [cleanupMedia]);

  const onRemote = useCallback((s: MediaStream) => {
    remoteRef.current = s;
    if (audioRef.current) { audioRef.current.srcObject = s; void audioRef.current.play().catch(() => {}); }
  }, []);

  const connected = useCallback((recording: string) => {
    setActive((a) => (a ? { ...a, phase: "connected", since: Date.now() } : a));
    // Grava sempre no navegador também (principal no modo navegador; cópia de segurança no modo WhatsApp)
    void recording;
    if (micRef.current && remoteRef.current && !recRef.current) recRef.current = startMixRecorder(micRef.current, remoteRef.current);
  }, []);

  /** Aplica o que mudou na ligação (tempo real ou consulta). */
  const applyRow = useCallback(async (row: { id: string; status: string; sdp_answer: string | null; recording_mode?: string }) => {
    if (row.id !== callIdRef.current) return;
    if (row.sdp_answer && !answeredRef.current && pcRef.current) {
      answeredRef.current = true;
      try {
        await pcRef.current.setRemoteDescription({ type: "answer", sdp: row.sdp_answer });
        connected(recModeRef.current);
      } catch {
        toast.error("Falha ao conectar o áudio");
      }
    }
    if (row.status === "ringing") setActive((a) => (a && a.phase === "preparing" ? { ...a, phase: "ringing" } : a));
    if (TERMINAL.includes(row.status)) await finish(row.status);
  }, [connected, finish]);

  const showIncoming = useCallback(async (row: CallRowLive) => {
    if (row.direction !== "in") return;
    if (row.status !== "ringing" || !row.sdp_offer) { setIncoming((cur) => (cur?.id === row.id ? null : cur)); return; }
    if (callIdRef.current) return;
    let name = formatPhone(row.wa_id);
    if (row.conversation_id) {
      const { data } = await supabaseBrowser().from("conversations").select("contact_name, leads(name)").eq("id", row.conversation_id).maybeSingle();
      const lead = (Array.isArray(data?.leads) ? data?.leads[0] : data?.leads) as { name?: string } | undefined;
      name = lead?.name ?? data?.contact_name ?? name;
    }
    setIncoming((cur) => (cur?.id === row.id ? cur : { id: row.id, name, phone: row.wa_id, sdp: row.sdp_offer!, recording: row.recording_mode }));
  }, []);

  // Tempo real: atualizações da ligação ativa e chamadas recebidas
  const liveRef = useRef(false);
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel(`calls-${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_calls", filter: `organization_id=eq.${ws.orgId}` }, (p) => {
        const row = p.new as CallRowLive;
        if (!row?.id) return;
        void applyRow(row);
        void showIncoming(row);
      })
      .subscribe((st) => { liveRef.current = st === "SUBSCRIBED"; });
    return () => { liveRef.current = false; void sb.removeChannel(ch); };
  }, [ws.orgId, applyRow, showIncoming]);

  // Se o tempo real cair, procura chamadas recebidas a cada 5s (nenhuma passa despercebida)
  useEffect(() => {
    const t = setInterval(async () => {
      if (liveRef.current || callIdRef.current || document.visibilityState !== "visible") return;
      const { data } = await supabaseBrowser().from("wa_calls")
        .select("id, direction, status, sdp_offer, sdp_answer, wa_id, conversation_id, recording_mode, started_by, answered_by")
        .eq("organization_id", ws.orgId).eq("direction", "in").eq("status", "ringing")
        .gt("created_at", new Date(Date.now() - 70_000).toISOString()).order("created_at", { ascending: false }).limit(1);
      const row = (data?.[0] ?? null) as CallRowLive | null;
      if (row) void showIncoming(row);
      else setIncoming(null);
    }, 5000);
    return () => clearInterval(t);
  }, [ws.orgId, showIncoming]);

  // Toque enquanto há chamada recebida
  useEffect(() => {
    if (!incoming) return;
    stopRingRef.current = ringtone();
    const t = setTimeout(() => setIncoming((c) => (c?.id === incoming.id ? null : c)), 60_000);
    return () => { stopRingRef.current?.(); stopRingRef.current = null; clearTimeout(t); };
  }, [incoming]);

  // Cronômetro
  useEffect(() => {
    if (active?.phase !== "connected") return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active?.phase]);

  // Não deixa a página fechar no meio da ligação sem aviso
  useEffect(() => {
    if (!active || active.phase === "ended") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active]);

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await api<{ status: string; sdpAnswer: string | null }>(`/api/calls/${id}`);
        await applyRow({ id, status: r.status, sdp_answer: r.sdpAnswer });
      } catch { /* tenta de novo */ }
    }, 3000);
  }, [applyRow]);

  const start = useCallback(async ({ conversationId, name, phone }: { conversationId: string; name: string; phone: string }) => {
    if (callIdRef.current || active) return void toast.error("Já existe uma ligação em andamento");
    setActive({ callId: null, name, phone, direction: "out", phase: "preparing", since: null, muted: false, recording: "meta" });
    try {
      const mic = await getMic();
      micRef.current = mic;
      const pc = createPeer(mic, onRemote);
      pcRef.current = pc;
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") void hangup(); };
      const sdp = await makeOffer(pc);
      const r = await api<{ id: string; recording: string }>("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, sdp }) });
      callIdRef.current = r.id;
      recModeRef.current = r.recording;
      setActive((a) => (a ? { ...a, callId: r.id, phase: "ringing", recording: r.recording } : a));
      startPolling(r.id);
    } catch (e) {
      cleanupMedia();
      callIdRef.current = null;
      setActive(null);
      toast.error((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onRemote, startPolling, cleanupMedia]);

  async function hangup() {
    const id = callIdRef.current;
    if (id) { try { await api(`/api/calls/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hangup" }) }); } catch { /* segue */ } }
    await finish("completed");
  }

  async function accept() {
    const call = incoming;
    if (!call) return;
    setIncoming(null);
    setActive({ callId: call.id, name: call.name, phone: call.phone, direction: "in", phase: "connecting", since: null, muted: false, recording: call.recording });
    callIdRef.current = call.id;
    recModeRef.current = call.recording;
    try {
      const mic = await getMic();
      micRef.current = mic;
      const pc = createPeer(mic, onRemote);
      pcRef.current = pc;
      answeredRef.current = true;
      const sdp = await makeAnswer(pc, call.sdp);
      await api(`/api/calls/${call.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", sdp }) });
      connected(call.recording);
      startPolling(call.id);
    } catch (e) {
      cleanupMedia();
      callIdRef.current = null;
      setActive(null);
      toast.error((e as Error).message);
    }
  }

  async function reject() {
    const call = incoming;
    setIncoming(null);
    if (!call) return;
    try { await api(`/api/calls/${call.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject" }) }); }
    catch (e) { toast.error((e as Error).message); }
  }

  function toggleMute() {
    const mic = micRef.current;
    if (!mic) return;
    const muted = !active?.muted;
    mic.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setActive((a) => (a ? { ...a, muted } : a));
  }

  const elapsed = active?.since ? Math.floor((Date.now() - active.since) / 1000) : 0;
  void tick;

  return (
    <CallCtx.Provider value={{ start, busy: !!active }}>
      {children}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <Portal>
        {incoming && !active && (
          <div className="fixed right-4 top-16 z-[60] w-[320px] animate-fadeIn rounded-2xl border border-emerald-500/40 bg-ink-900 p-4 shadow-2xl" role="alertdialog" aria-label="Chamada recebida">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300"><PhoneIncoming className="h-4 w-4 animate-pulse" /> Chamada no WhatsApp</p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={incoming.name} className="h-11 w-11" />
              <div className="min-w-0"><p className="truncate font-semibold text-white">{incoming.name}</p><p className="text-xs text-slate-400">{formatPhone(incoming.phone)}</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void reject()} className="flex items-center justify-center gap-2 rounded-xl bg-red-500/15 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/25"><PhoneOff className="h-4 w-4" /> Recusar</button>
              <button type="button" onClick={() => void accept()} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400"><Phone className="h-4 w-4" /> Atender</button>
            </div>
          </div>
        )}
        {active && (
          <div className="fixed right-4 top-16 z-[60] w-[320px] animate-fadeIn rounded-2xl border border-line bg-ink-900/95 p-4 shadow-2xl backdrop-blur" role="dialog" aria-label="Ligação">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar name={active.name} className="h-11 w-11" />
                {active.phase === "connected" && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-ink-900 bg-emerald-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{active.name}</p>
                <p className={cn("text-xs", active.phase === "connected" ? "font-mono text-emerald-300" : active.phase === "ended" ? "text-slate-400" : "animate-pulse text-slate-300")}>
                  {active.phase === "preparing" ? "Preparando o microfone…" : active.phase === "ringing" ? "Chamando no WhatsApp…" : active.phase === "connecting" ? "Conectando…"
                    : active.phase === "connected" ? fmtDuration(elapsed) : active.endedLabel}
                </p>
              </div>
            </div>
            {active.phase !== "ended" && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                {active.recording === "meta" ? "Gravando — o WhatsApp avisa o cliente antes de começar" : "Gravando no navegador — avise o cliente"}
              </p>
            )}
            {active.phase === "ended" && (
              <Link href="/ligacoes" className="mt-3 block text-center text-xs font-medium text-brand-300 hover:text-brand-200">Ver em Ligações →</Link>
            )}
            {active.phase !== "ended" && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <button type="button" onClick={toggleMute} disabled={active.phase !== "connected"}
                  className={cn("flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-30", active.muted ? "bg-white text-ink-900" : "bg-ink-700 text-white hover:bg-ink-600")}
                  aria-label={active.muted ? "Ativar microfone" : "Silenciar microfone"}>{active.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
                <button type="button" onClick={() => void hangup()} className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-400" aria-label="Desligar"><PhoneOff className="h-5 w-5" /></button>
              </div>
            )}
          </div>
        )}
      </Portal>
    </CallCtx.Provider>
  );
}

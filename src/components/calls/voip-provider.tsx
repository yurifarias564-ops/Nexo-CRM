"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Headphones, Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, Portal } from "@/components/ui/misc";
import { cn, formatPhone } from "@/lib/utils";
import { fmtDuration, ringtone, startMixRecorder } from "./webrtc";

/*
 * Telefone VoIP embutido no CRM (central Api4Com, SIP sobre WebSocket).
 * Fluxo do botão "Ligar": o CRM pede a ligação à central → a central chama o
 * ramal do vendedor (este navegador atende sozinho) → disca para o lead.
 * A central grava; o navegador guarda uma cópia de segurança.
 */

type Phase = "calling" | "connected" | "ended";
interface Active { callId: string | null; name: string; phone: string; phase: Phase; since: number | null; muted: boolean; endedLabel?: string }
interface Me { enabled: boolean; ready?: boolean; ramal?: string | null; domain?: string; sip?: string | null; reason?: string }
interface Ctx { ready: boolean; online: boolean; busy: boolean; call: (p: { leadId?: string | null; conversationId?: string | null; name: string; phone: string }) => Promise<void> }

const VoipCtx = createContext<Ctx>({ ready: false, online: false, busy: false, call: async () => {} });
export const useVoip = () => useContext(VoipCtx);

// Tipos mínimos do JsSIP (carregado só no navegador)
interface JsSession {
  direction: "incoming" | "outgoing";
  remote_identity?: { uri?: { user?: string }; display_name?: string };
  connection?: RTCPeerConnection;
  answer: (o: unknown) => void;
  terminate: () => void;
  mute: () => void;
  unmute: () => void;
  isEnded: () => boolean;
  on: (ev: string, cb: (e?: unknown) => void) => void;
}
interface JsUA { start: () => void; stop: () => void; on: (ev: string, cb: (e: { session?: JsSession; originator?: string }) => void) => void }

export function VoipProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [online, setOnline] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [incoming, setIncoming] = useState<JsSession | null>(null);
  const [now, setNow] = useState(0);
  const uaRef = useRef<JsUA | null>(null);
  const sessionRef = useRef<JsSession | null>(null);
  const pendingRef = useRef<{ callId: string | null; until: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<{ stop: () => Promise<Blob | null> } | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/voip/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: Me | null) => { if (alive) setMe(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const ready = Boolean(me?.enabled && me.ready && me.ramal && me.domain && me.sip);

  const finish = useCallback(async (label: string) => {
    stopRingRef.current?.(); stopRingRef.current = null;
    const id = active?.callId ?? pendingRef.current?.callId ?? null;
    pendingRef.current = null;
    sessionRef.current = null;
    const rec = recRef.current; recRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop()); micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setActive((a) => (a ? { ...a, phase: "ended", endedLabel: label } : a));
    setTimeout(() => setActive((a) => (a?.phase === "ended" ? null : a)), 6000);
    if (rec && id) {
      const blob = await rec.stop();
      if (blob && blob.size > 2000) await fetch(`/api/calls/${id}/recording`, { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob }).catch(() => {});
    }
  }, [active?.callId]);
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; }, [finish]);

  const wireSession = useCallback((s: JsSession) => {
    sessionRef.current = s;
    const attach = () => {
      const pc = s.connection;
      if (!pc) return;
      const remote = new MediaStream();
      pc.getReceivers().forEach((r) => r.track && remote.addTrack(r.track));
      pc.addEventListener("track", (ev) => { ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t)); if (audioRef.current) audioRef.current.srcObject = remote; });
      if (audioRef.current) { audioRef.current.srcObject = remote; void audioRef.current.play().catch(() => {}); }
      const local = new MediaStream();
      pc.getSenders().forEach((x) => x.track && local.addTrack(x.track));
      micRef.current = local;
      if (!recRef.current && remote.getAudioTracks().length && local.getAudioTracks().length) recRef.current = startMixRecorder(local, remote);
    };
    s.on("confirmed", () => {
      stopRingRef.current?.(); stopRingRef.current = null;
      attach();
      setActive((a) => (a ? { ...a, phase: "connected", since: Date.now() } : a));
    });
    s.on("ended", () => void finishRef.current("Ligação encerrada"));
    s.on("failed", () => void finishRef.current("A ligação não completou"));
  }, []);

  // Registra o ramal na central assim que a pessoa entra no CRM
  useEffect(() => {
    if (!ready || !me) return;
    let ua: JsUA | null = null;
    let cancelled = false;
    void (async () => {
      const JsSIP = (await import("jssip")).default;
      if (cancelled) return;
      const socket = new JsSIP.WebSocketInterface(`wss://${me.domain}:6443`);
      ua = new JsSIP.UA({
        sockets: [socket], uri: `sip:${me.ramal}@${me.domain}`, password: me.sip!, authorization_user: me.ramal!,
        realm: me.domain, register: true, register_expires: 600, session_timers: false, connection_recovery_min_interval: 2, connection_recovery_max_interval: 30,
      }) as unknown as JsUA;
      ua.on("registered", () => setOnline(true));
      ua.on("unregistered", () => setOnline(false));
      ua.on("registrationFailed", () => { setOnline(false); toast.error("O telefone do CRM não conectou na central. Confira o ramal em Configurações → Integrações."); });
      ua.on("disconnected", () => setOnline(false));
      ua.on("newRTCSession", ({ session, originator }) => {
        if (!session || originator !== "remote") return;
        const p = pendingRef.current;
        if (p && Date.now() < p.until) {
          // É a ligação que acabamos de pedir: atende sozinho e a central disca para o lead
          wireSession(session);
          session.answer({ mediaConstraints: { audio: true, video: false } });
          return;
        }
        if (sessionRef.current) { session.terminate(); return; }
        stopRingRef.current = ringtone();
        setIncoming(session);
        session.on("ended", () => { stopRingRef.current?.(); stopRingRef.current = null; setIncoming((x) => (x === session ? null : x)); });
        session.on("failed", () => { stopRingRef.current?.(); stopRingRef.current = null; setIncoming((x) => (x === session ? null : x)); });
      });
      ua.start();
      uaRef.current = ua;
    })();
    return () => { cancelled = true; try { ua?.stop(); } catch { /* já parado */ } uaRef.current = null; setOnline(false); };
  }, [ready, me, wireSession]);

  useEffect(() => {
    if (active?.phase !== "connected") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active?.phase]);

  const call = useCallback(async (p: { leadId?: string | null; conversationId?: string | null; name: string; phone: string }) => {
    if (!ready) return void toast.error(me?.reason ?? "Telefonia não configurada para você. Peça um ramal ao administrador.");
    if (sessionRef.current || active?.phase === "calling") return void toast.error("Você já está numa ligação");
    if (!online) toast.message("Conectando o telefone do CRM…");
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch {
      return void toast.error("Permita o uso do microfone para ligar.");
    }
    pendingRef.current = { callId: null, until: Date.now() + 45_000 };
    setActive({ callId: null, name: p.name, phone: p.phone, phase: "calling", since: null, muted: false });
    const res = await fetch("/api/voip/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: p.leadId ?? null, conversationId: p.conversationId ?? null, phone: p.phone }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { pendingRef.current = null; setActive(null); return void toast.error(body.error ?? "Não foi possível ligar"); }
    if (pendingRef.current) pendingRef.current.callId = body.id;
    setActive((a) => (a ? { ...a, callId: body.id } : a));
    setTimeout(() => { if (pendingRef.current && !sessionRef.current) void finishRef.current("A central não chamou o seu ramal. Confira se o telefone do CRM está online."); }, 45_000);
  }, [ready, online, active?.phase, me?.reason]);

  function hangup() {
    const s = sessionRef.current;
    if (s && !s.isEnded()) s.terminate(); else void finish("Ligação cancelada");
  }
  function toggleMute() {
    const s = sessionRef.current;
    if (!s || !active) return;
    if (active.muted) s.unmute(); else s.mute();
    setActive({ ...active, muted: !active.muted });
  }
  function acceptIncoming() {
    const s = incoming;
    if (!s) return;
    stopRingRef.current?.(); stopRingRef.current = null;
    setIncoming(null);
    const who = s.remote_identity?.display_name || s.remote_identity?.uri?.user || "Chamada recebida";
    setActive({ callId: null, name: who, phone: s.remote_identity?.uri?.user ?? "", phase: "calling", since: null, muted: false });
    wireSession(s);
    s.answer({ mediaConstraints: { audio: true, video: false } });
  }

  const busy = Boolean(active && active.phase !== "ended");
  const secs = active?.since && now > active.since ? (now - active.since) / 1000 : 0;

  return (
    <VoipCtx.Provider value={{ ready, online, busy, call }}>
      {children}
      <audio ref={audioRef} autoPlay className="hidden" />
      {(active || incoming) && (
        <Portal>
          <div className="fixed right-4 top-16 z-[60] w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-line bg-ink-900/95 p-4 shadow-2xl backdrop-blur">
            {incoming && !active ? (
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"><PhoneIncoming className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{incoming.remote_identity?.display_name || formatPhone(incoming.remote_identity?.uri?.user ?? "")}</p>
                  <p className="text-xs text-slate-400">Chamada no seu ramal</p>
                </div>
                <button onClick={() => { incoming.terminate(); setIncoming(null); }} className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white" aria-label="Recusar"><PhoneOff className="h-4 w-4" /></button>
                <button onClick={acceptIncoming} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white" aria-label="Atender"><Phone className="h-4 w-4" /></button>
              </div>
            ) : active ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={active.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{active.name}</p>
                    <p className="text-xs text-slate-400">
                      {active.phase === "calling" ? `Ligando para ${formatPhone(active.phone)}…` : active.phase === "connected" ? <>Em ligação · {fmtDuration(secs)} · <span className="text-red-300">● gravando</span></> : active.endedLabel}
                    </p>
                  </div>
                  <Headphones className="h-4 w-4 text-slate-500" />
                </div>
                {active.phase !== "ended" ? (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button onClick={toggleMute} disabled={active.phase !== "connected"} className={cn("flex h-10 w-10 items-center justify-center rounded-full border border-line text-slate-200 disabled:opacity-40", active.muted && "bg-amber-500/20 text-amber-200")} aria-label={active.muted ? "Ativar microfone" : "Silenciar"}>
                      {active.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>
                    <button onClick={hangup} className="flex h-10 items-center gap-2 rounded-full bg-red-500 px-4 text-sm font-medium text-white" aria-label="Desligar"><PhoneOff className="h-4 w-4" /> Desligar</button>
                  </div>
                ) : (
                  <Link href="/ligacoes" className="mt-3 block text-right text-xs text-brand-300 hover:text-brand-200">Ver em Ligações</Link>
                )}
              </>
            ) : null}
          </div>
        </Portal>
      )}
    </VoipCtx.Provider>
  );
}

/** Botão "Ligar" (telefone comum, gravado). Aparece quando a pessoa tem ramal. */
export function VoipCallButton({ leadId, conversationId, name, phone, compact }: { leadId?: string | null; conversationId?: string | null; name: string; phone: string | null; compact?: boolean }) {
  const v = useVoip();
  const [loading, setLoading] = useState(false);
  if (!v.ready || !phone) return null;
  return (
    <button type="button" disabled={v.busy || loading} title="Ligar para o celular (gravado)"
      onClick={async () => { setLoading(true); try { await v.call({ leadId, conversationId, name, phone }); } finally { setLoading(false); } }}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50", compact && "px-2")}>
      <Phone className="h-3.5 w-3.5" /> <span className={compact ? "hidden sm:inline" : ""}>Ligar</span>
      <span className={cn("h-1.5 w-1.5 rounded-full", v.online ? "bg-emerald-400" : "bg-slate-500")} aria-hidden />
    </button>
  );
}

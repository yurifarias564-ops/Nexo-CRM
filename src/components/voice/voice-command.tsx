"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Keyboard, Mic, Square, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { describe, type ResolvedAction } from "@/lib/voice-actions";
import { cn } from "@/lib/utils";

type Phase = "idle" | "recording" | "thinking" | "review" | "executing";
const MAX_SECONDS = 60;
const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/Sao_Paulo"; } };

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// Reconhecimento de fala do próprio navegador (Chrome, Edge, Safari): grátis e em tempo real
interface SR { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null }
function makeRecognizer(): SR | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = "pt-BR"; r.continuous = true; r.interimResults = true;
  return r;
}

export function VoiceCommand() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<(ResolvedAction & { enabled: boolean })[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number>(0);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audioCtx = useRef<AudioContext | null>(null);
  const srRef = useRef<SR | null>(null);
  const srText = useRef({ final: "", interim: "" });
  const srDone = useRef<Promise<void>>(Promise.resolve());
  const [live, setLive] = useState("");

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    clearInterval(tick.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const interpret = useCallback(async (body: FormData | { text: string; tz: string }) => {
    setPhase("thinking");
    try {
      const res = await fetch("/api/voice/interpret", body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTranscript(data.transcript);
      setActions((data.actions as ResolvedAction[]).map((a) => ({ ...a, enabled: true })));
      setIssues(data.issues ?? []);
      setPhase("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível entender o comando");
      setPhase("idle");
    }
  }, []);

  const stop = useCallback(() => {
    try { srRef.current?.stop(); } catch { /* já parado */ }
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("Seu navegador não permite gravar áudio");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        cleanup();
        setPhase("thinking");
        // Espera o reconhecimento do navegador fechar a última frase (máx. 1,5 s)
        await Promise.race([srDone.current, new Promise((r) => setTimeout(r, 1500))]);
        srRef.current = null;
        const said = `${srText.current.final} ${srText.current.interim}`.replace(/\s+/g, " ").trim();
        setLive("");
        if (said.length >= 3) return void interpret({ text: said, tz: userTz() });
        if (blob.size < 1500) { setPhase("idle"); return toast.message("Gravação muito curta — segure por um instante e fale o comando."); }
        const fd = new FormData();
        fd.append("tz", userTz());
        fd.append("audio", blob, `comando.${type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm"}`);
        void interpret(fd);
      };
      rec.start(250);
      recRef.current = rec;

      // Transcrição no próprio navegador (sem custo); o áudio fica de reserva
      srText.current = { final: "", interim: "" };
      setLive("");
      const sr = makeRecognizer();
      srRef.current = sr;
      srDone.current = sr ? new Promise<void>((resolve) => {
        sr.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) srText.current.final += ` ${r[0].transcript}`;
            else interim += r[0].transcript;
          }
          srText.current.interim = interim;
          setLive(`${srText.current.final} ${interim}`.trim());
        };
        sr.onerror = () => resolve();
        sr.onend = () => resolve();
        try { sr.start(); } catch { resolve(); }
      }) : Promise.resolve();

      // Medidor de volume para feedback visual
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteFrequencyData(buf);
        setLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 128);
        raf.current = requestAnimationFrame(loop);
      };
      loop();

      setSeconds(0);
      tick.current = setInterval(() => setSeconds((v) => {
        if (v + 1 >= MAX_SECONDS) stop();
        return v + 1;
      }), 1000);
      setPhase("recording");
    } catch {
      cleanup();
      toast.error("Permita o acesso ao microfone para usar comandos de voz");
    }
  }, [cleanup, interpret, stop]);

  // Atalho: Ctrl/Cmd + Shift + M
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (phase === "idle") void start();
        else if (phase === "recording") stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start, stop]);

  async function execute() {
    const chosen = actions.filter((a) => a.enabled).map(({ enabled: _e, ...a }) => a as ResolvedAction);
    if (!chosen.length) return close();
    if (chosen.some((a) => "leadId" in a && !a.leadId)) return toast.error("Escolha qual lead você quis dizer");
    setPhase("executing");
    try {
      const res = await fetch("/api/voice/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript, actions: chosen }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.failure) {
        toast.warning(`Feito: ${data.done.join("; ")}`, { description: `Não executado — ${data.failure.action}: ${data.failure.error}`, duration: 10000 });
      } else {
        toast.success(data.done.length === 1 ? data.done[0] : `${data.done.length} ações executadas`);
      }
      window.dispatchEvent(new CustomEvent("crm:refresh"));
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao executar");
      setPhase("review");
    }
  }

  function close() {
    setPhase("idle");
    setActions([]);
    setIssues([]);
    setTranscript("");
    setTyping(false);
    setTyped("");
  }

  const recording = phase === "recording";

  return (
    <>
      <div className="flex items-center gap-2">
        {recording && (
          <span className="hidden items-center gap-2 text-xs tabular-nums text-red-300 sm:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> Ouvindo… 0:{String(seconds).padStart(2, "0")}
          </span>
        )}
        {recording && live && (
          <span className="hidden max-w-[320px] truncate rounded-full bg-ink-800 px-3 py-1 text-xs text-slate-200 md:inline" title={live}>“{live}”</span>
        )}
        <button
          type="button"
          onClick={() => (recording ? stop() : phase === "idle" ? start() : undefined)}
          disabled={phase === "thinking" || phase === "executing"}
          title="Comando de voz (Ctrl+Shift+M)"
          aria-label={recording ? "Parar gravação" : "Falar um comando"}
          className={cn(
            "relative flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition",
            recording ? "bg-red-500 text-white" : "bg-gradient-to-r from-brand-500 to-navy-400 text-white shadow-glow hover:brightness-110",
          )}
        >
          {recording && (
            <span className="pointer-events-none absolute inset-0 rounded-full bg-red-500/60 animate-pulseRing" style={{ transform: `scale(${1 + level * 0.4})` }} />
          )}
          {phase === "thinking" ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : recording ? <Square className="relative h-3.5 w-3.5 fill-current" /> : <Mic className="relative h-4 w-4" />}
          <span className="relative hidden sm:inline">{phase === "thinking" ? "Entendendo…" : recording ? "Parar" : "Comando de voz"}</span>
        </button>
        {phase === "idle" && (
          <button onClick={() => { setTyping(true); setPhase("review"); }} className="hidden rounded-full p-2 text-slate-400 hover:bg-ink-800 hover:text-slate-200 sm:block" title="Digitar comando" aria-label="Digitar comando">
            <Keyboard className="h-4 w-4" />
          </button>
        )}
      </div>

      <Modal
        open={phase === "review" || phase === "executing"}
        onClose={close}
        title={typing && !transcript ? "Digite o comando" : "Confirmar comando"}
        wide
        footer={
          typing && !transcript ? (
            <>
              <Button variant="ghost" onClick={close}>Cancelar</Button>
              <Button onClick={() => typed.trim() && interpret({ text: typed, tz: userTz() })} disabled={!typed.trim()}><Wand2 className="h-4 w-4" /> Interpretar</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>Cancelar</Button>
              <Button onClick={execute} loading={phase === "executing"} disabled={!actions.some((a) => a.enabled)}>
                <Check className="h-4 w-4" /> Confirmar {actions.filter((a) => a.enabled).length > 1 ? `(${actions.filter((a) => a.enabled).length})` : ""}
              </Button>
            </>
          )
        }
      >
        {typing && !transcript ? (
          <div className="space-y-3">
            <textarea
              className="field h-24 resize-none py-2"
              placeholder='Ex.: "Mova o lead Yuri para Negociação, coloque a tag Anúncio e mande pra ele: já separei sua proposta"'
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && typed.trim()) { e.preventDefault(); void interpret({ text: typed, tz: userTz() }); } }}
            />
            <p className="text-xs text-slate-500">Dica: use o microfone (Ctrl+Shift+M) para falar o mesmo comando.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-ink-950/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Você disse</p>
              <p className="mt-1 text-slate-100">“{transcript}”</p>
            </div>

            {actions.length > 0 && (
              <ul className="space-y-2">
                {actions.map((a, i) => {
                  const ambiguous = "leadId" in a && !a.leadId;
                  return (
                    <li key={i} className={cn("rounded-lg border p-3 transition", a.enabled ? "border-brand-400/30 bg-brand-500/5" : "border-line opacity-60")}>
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="checkbox" className="mt-1 accent-blue-500" checked={a.enabled}
                          onChange={(e) => setActions((arr) => arr.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                        <span className="text-sm text-slate-100">{describe(a)}</span>
                      </label>
                      {ambiguous && "leadCandidates" in a && (
                        <div className="ml-7 mt-2">
                          {a.leadCandidates.length ? (
                            <select className="field h-9" defaultValue=""
                              onChange={(e) => {
                                const c = a.leadCandidates.find((x) => x.id === e.target.value);
                                if (c) setActions((arr) => arr.map((x, j) => (j === i ? ({ ...x, leadId: c.id, leadName: c.name } as typeof x) : x)));
                              }}>
                              <option value="" disabled>Qual “{a.leadName}”? Escolha…</option>
                              {a.leadCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · +${c.phone}` : ""}</option>)}
                            </select>
                          ) : (
                            <p className="text-xs text-amber-300">Lead não encontrado — desmarque esta ação.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {issues.length > 0 && (
              <ul className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                {issues.map((t, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t}</li>
                ))}
              </ul>
            )}

            {!actions.length && !issues.length && <p className="text-sm text-slate-400">Nenhuma ação identificada. Tente: “mova o lead Maria para Proposta enviada”.</p>}
          </div>
        )}
      </Modal>
    </>
  );
}

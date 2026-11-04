"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, PencilLine, Square } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { TeamSeller } from "@/lib/team";
import { useTeamApi, type VoiceFill } from "./data";

const MAX_MS = 120_000;

/** "Conte seu dia por áudio": grava (ou escreve/dita no teclado), entende e preenche o checklist sozinho. */
export function VoiceFillButton({ seller, onFill, onNote }: {
  seller: TeamSeller; onFill: (u: { metric_id: string; add: number }[]) => string[]; onNote: (text: string) => void;
}) {
  const api = useTeamApi();
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); if (stopT.current) clearTimeout(stopT.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (typing) box.current?.focus(); }, [typing]);

  function openTyping(msg?: string) {
    setTyping(true);
    if (msg) toast.message(msg);
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return openTyping("Este navegador não grava áudio. Escreva ou use o microfone do teclado para ditar.");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return openTyping("Microfone bloqueado. Escreva ou use o microfone do teclado para ditar."); }
    const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void sendAudio(new Blob(chunks.current, { type: r.mimeType || "audio/webm" })); };
    rec.current = r;
    r.start();
    setSecs(0); setState("rec");
    tick.current = setInterval(() => setSecs((s) => s + 1), 1000);
    stopT.current = setTimeout(stop, MAX_MS);
  }

  function stop() {
    if (tick.current) clearInterval(tick.current);
    if (stopT.current) clearTimeout(stopT.current);
    if (rec.current?.state === "recording") rec.current.stop();
  }

  function apply(r: VoiceFill) {
    const names = onFill(r.updates);
    if (r.note) onNote(r.note);
    if (names.length) toast.success(`Preenchido: ${names.join(", ")}`, { description: r.heard ? `“${r.heard.slice(0, 160)}”` : undefined });
    else toast.message("Não achei números de atividades", { description: r.note ? "Guardei o que você contou nas notas." : `Entendi: “${r.heard.slice(0, 160)}”` });
    return names.length > 0 || !!r.note;
  }

  async function sendAudio(blob: Blob) {
    if (blob.size < 1500) { setState("idle"); return toast.error("Áudio muito curto. Toque, fale o que fez hoje e toque de novo para enviar."); }
    setState("busy");
    try { apply(await api.voice(blob, seller.id, "")); }
    catch (e) { openTyping(); toast.error((e as Error).message); }
    setState("idle");
  }

  async function sendText() {
    const t = text.trim();
    if (t.length < 3) return toast.error("Conte o que você fez hoje, com os números.");
    setState("busy");
    try { if (apply(await api.voice(null, seller.id, t))) { setText(""); setTyping(false); } }
    catch (e) { toast.error((e as Error).message); }
    setState("idle");
  }

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-brand-400/25 bg-brand-500/[0.06] p-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={state === "rec" ? stop : () => void start()} disabled={state === "busy"}
          className={cn("flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60 sm:flex-none",
            state === "rec" ? "animate-pulse bg-red-500 text-white" : "bg-brand-500 text-white hover:bg-brand-400")}>
          {state === "busy" ? <Spinner className="h-4 w-4" /> : state === "rec" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {state === "busy" ? "Preenchendo…" : state === "rec" ? `Parar e enviar · ${secs}s` : "Contar meu dia por áudio"}
        </button>
        {state !== "rec" && (
          <button type="button" onClick={() => setTyping((v) => !v)} disabled={state === "busy"}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-slate-200 transition hover:bg-white/5 disabled:opacity-60">
            <PencilLine className="h-4 w-4" /> Escrever meu dia
          </button>
        )}
      </div>
      {typing ? (
        <div className="space-y-2">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000}
            placeholder="Ex.: liguei para 30, 9 atenderam, fiz 15 follow-ups e marquei 2 visitas."
            className="w-full resize-none rounded-lg border border-line bg-black/30 p-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">Dica: toque no 🎤 do teclado para ditar em vez de digitar.</p>
            <button type="button" onClick={() => void sendText()} disabled={state === "busy"}
              className="h-9 shrink-0 rounded-full bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-60">
              {state === "busy" ? "Preenchendo…" : "Preencher"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-slate-400">
          Ex.: “Hoje liguei para 30, fiz 15 follow-ups, resgatei 10 clientes e marquei 2 visitas.” O checklist preenche sozinho.
        </p>
      )}
    </div>
  );
}

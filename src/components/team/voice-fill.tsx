"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { TeamSeller } from "@/lib/team";
import { useTeamApi } from "./data";

const MAX_MS = 120_000;

/** "Conte seu dia por áudio": grava, transcreve e preenche o checklist sozinho. */
export function VoiceFillButton({ seller, onFill, onNote }: {
  seller: TeamSeller; onFill: (u: { metric_id: string; add: number }[]) => string[]; onNote: (text: string) => void;
}) {
  const api = useTeamApi();
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopT = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); if (stopT.current) clearTimeout(stopT.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast.error("Este navegador não grava áudio. Use o Chrome ou o Safari atualizado.");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast.error("Libere o microfone para mandar o áudio."); }
    const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void send(new Blob(chunks.current, { type: r.mimeType || "audio/webm" })); };
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

  async function send(blob: Blob) {
    if (blob.size < 1500) { setState("idle"); return toast.error("Áudio muito curto. Segure e fale o que fez hoje."); }
    setState("busy");
    try {
      const r = await api.voice(blob, seller.id, "");
      const names = onFill(r.updates);
      if (r.note) onNote(r.note);
      if (names.length) toast.success(`Preenchido: ${names.join(", ")}`, { description: r.heard ? `“${r.heard.slice(0, 160)}”` : undefined });
      else toast.message("Não achei números de atividades no áudio", { description: r.note ? "Guardei o que você contou nas notas." : `Ouvi: “${r.heard.slice(0, 160)}”` });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setState("idle");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-400/25 bg-brand-500/[0.06] p-3">
      <button type="button" onClick={state === "rec" ? stop : () => void start()} disabled={state === "busy"}
        className={cn("flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60",
          state === "rec" ? "animate-pulse bg-red-500 text-white" : "bg-brand-500 text-white hover:bg-brand-400")}>
        {state === "busy" ? <Spinner className="h-4 w-4" /> : state === "rec" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {state === "busy" ? "Preenchendo…" : state === "rec" ? `Parar e enviar · ${secs}s` : "Contar meu dia por áudio"}
      </button>
      <p className="min-w-0 flex-1 text-xs text-slate-400">
        Ex.: “Hoje liguei para 3, fiz 5 follow-ups, resgatei 10 clientes e fiz uma venda de indicação.” O checklist preenche sozinho.
      </p>
    </div>
  );
}

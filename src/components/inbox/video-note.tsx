"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, RotateCcw, Send, Square, SwitchCamera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/misc";

// O WhatsApp só toca vídeo MP4 (H.264). Chrome e Safari recentes gravam direto em MP4.
const MIMES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
];
// Limite da hospedagem para envio: ~4 MB. 40 s a ~700 kbps cabem com folga.
const MAX_SECONDS = 40;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Grava o vídeo "bolinha" (recado de vídeo redondo do WhatsApp). */
export function VideoNoteModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (f: File) => void }) {
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [phase, setPhase] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (tick.current) clearInterval(tick.current);
  }, []);

  const startCamera = useCallback(async (mode: "user" | "environment") => {
    stopCamera();
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1 },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = s;
      if (live.current) { live.current.srcObject = s; await live.current.play().catch(() => undefined); }
    } catch {
      setError("Permita o acesso à câmera e ao microfone para gravar o vídeo.");
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setPhase("idle"); setSeconds(0); setFile(null);
      setUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
      if (!pickMime()) setError("Este navegador não grava vídeo em MP4 (formato do WhatsApp). Use o Chrome ou o Safari atualizados.");
      else void startCamera(facing);
    }, 0);
    return () => { clearTimeout(t); stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") {
      try { rec.current.requestData(); } catch { /* ok */ }
      rec.current.stop();
    }
  }, []);

  function start() {
    const mime = pickMime();
    if (!stream.current || !mime) return;
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: 700_000, audioBitsPerSecond: 64_000 });
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      if (tick.current) clearInterval(tick.current);
      const blob = new Blob(chunks.current, { type: "video/mp4" });
      if (!blob.size) { setPhase("idle"); return toast.error("Não captei o vídeo. Tente de novo."); }
      const f = new File([blob], `bolinha-${Date.now()}.mp4`, { type: "video/mp4" });
      setFile(f);
      setUrl(URL.createObjectURL(blob));
      setPhase("done");
      stopCamera();
    };
    r.start(500);
    rec.current = r;
    setSeconds(0);
    setPhase("recording");
    tick.current = setInterval(() => setSeconds((v) => { if (v + 1 >= MAX_SECONDS) stop(); return v + 1; }), 1000);
  }

  function redo() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null); setFile(null); setPhase("idle"); setSeconds(0);
    void startCamera(facing);
  }

  function flip() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    void startCamera(next);
  }

  function close() { stop(); stopCamera(); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Vídeo bolinha"
      footer={phase === "done" ? (
        <>
          <Button variant="ghost" onClick={redo}><RotateCcw className="h-4 w-4" /> Gravar de novo</Button>
          <Button onClick={() => { if (file) { onSend(file); close(); } }}><Send className="h-4 w-4" /> Enviar</Button>
        </>
      ) : <Button variant="ghost" onClick={close}>Cancelar</Button>}>
      <div className="flex flex-col items-center gap-4 py-2" data-modal-body>
        <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-emerald-500/60 bg-black shadow-card">
          {phase === "done" && url
            ? <video src={url} controls playsInline className="h-full w-full object-cover" />
            : <video ref={live} muted playsInline className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />}
          {phase === "recording" && (
            <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
              ● {String(Math.floor(seconds / 60)).padStart(1, "0")}:{String(seconds % 60).padStart(2, "0")} / 0:{MAX_SECONDS}
            </span>
          )}
        </div>
        {error ? <p className="max-w-xs text-center text-sm text-amber-300">{error}</p> : phase !== "done" && (
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={flip} disabled={phase === "recording"} aria-label="Trocar câmera" title="Trocar câmera"><SwitchCamera className="h-5 w-5" /></Button>
            {phase === "recording" ? (
              <button onClick={stop} className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg" aria-label="Parar gravação"><Square className="h-6 w-6" /></button>
            ) : (
              <button onClick={start} className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg" aria-label="Começar a gravar"><Circle className="h-7 w-7 fill-white" /></button>
            )}
            <span className="w-10" />
          </div>
        )}
        <p className="max-w-xs text-center text-xs text-slate-500">
          Até {MAX_SECONDS} segundos. No número por QR Code chega como bolinha; na API oficial chega como vídeo comum (a Meta não tem bolinha).
        </p>
      </div>
    </Modal>
  );
}

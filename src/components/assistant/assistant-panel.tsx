"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Mic, Send, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { describe, type ResolvedAction } from "@/lib/voice-actions";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; actions?: ResolvedAction[]; issues?: string[]; done?: boolean };

const SUGGESTIONS = [
  "Quem está parado há mais de 7 dias?",
  "Quanto vendi este mês? Compare com o mês passado.",
  "Quais clientes estão esperando resposta?",
  "Quais são as maiores oportunidades em aberto?",
  "O que tenho na agenda nos próximos dias?",
];

/** Texto do assistente: **negrito**, listas com "- " e quebras de linha. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const inline = (s: string, k: number) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <b key={`${k}-${j}`} className="font-semibold text-white">{p.slice(2, -2)}</b> : <span key={`${k}-${j}`}>{p}</span>));
  return (
    <div className="space-y-1">
      {lines.map((l, k) => {
        const t = l.trim();
        if (!t) return <div key={k} className="h-1" />;
        if (/^[-•*]\s+/.test(t)) return <p key={k} className="flex gap-2 pl-1"><span className="text-brand-300">•</span><span className="min-w-0 flex-1">{inline(t.replace(/^[-•*]\s+/, ""), k)}</span></p>;
        if (/^#{1,4}\s/.test(t)) return <p key={k} className="pt-1 font-semibold text-white">{inline(t.replace(/^#{1,4}\s/, ""), k)}</p>;
        return <p key={k}>{inline(t, k)}</p>;
      })}
    </div>
  );
}

export function AssistantButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Assistente com IA"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-400/40 bg-brand-500/10 px-3 text-sm font-medium text-brand-100 transition hover:bg-brand-500/20">
        <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">Assistente</span>
      </button>
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const key = `nexo-assistant:${ws.orgId}:${ws.userId}`;
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]") as Msg[]; } catch { return []; }
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(msgs.slice(-30))); } catch { /* sem armazenamento */ }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, key]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    input.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsgs((cur) => [...cur, { role: "assistant", content: data.reply, actions: data.actions?.length ? data.actions : undefined, issues: data.issues?.length ? data.issues : undefined }]);
    } catch (e) {
      setMsgs((cur) => [...cur, { role: "assistant", content: `⚠️ ${(e as Error).message || "Não consegui responder agora."}` }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  async function confirm(idx: number, actions: ResolvedAction[]) {
    const prev = msgs[idx - 1];
    try {
      const res = await fetch("/api/voice/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: (prev?.content ?? "Assistente").slice(0, 2000), actions }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.failure) toast.warning(`Feito: ${data.done.join("; ")}`, { description: `Não executado — ${data.failure.action}: ${data.failure.error}`, duration: 10000 });
      else toast.success(data.done.length === 1 ? data.done[0] : `${data.done.length} ações executadas`);
      setMsgs((cur) => cur.map((m, i) => (i === idx ? { ...m, done: true } : m)));
      window.dispatchEvent(new CustomEvent("crm:refresh"));
    } catch (e) { toast.error((e as Error).message); }
  }

  function dictate() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) return toast.message("Ditado não disponível neste navegador. Use o Chrome ou digite a pergunta.");
    const r = new C();
    r.lang = "pt-BR"; r.interimResults = true; r.continuous = false;
    const base = text ? `${text} ` : "";
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i]![0].transcript; setText(base + t); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-[100dvh] w-full flex-col border-l border-line bg-ink-900 shadow-2xl sm:max-w-md" onClick={(e) => e.stopPropagation()} aria-label="Assistente">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-200"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">Assistente</p>
            <p className="text-[11px] text-slate-500">Claude · consulta seus dados e prepara ações para você confirmar</p>
          </div>
          {msgs.length > 0 && <button onClick={() => setMsgs([])} className="rounded-md p-1.5 text-slate-500 hover:bg-ink-800 hover:text-slate-200" title="Nova conversa" aria-label="Nova conversa"><Trash2 className="h-4 w-4" /></button>}
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </header>

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          {!msgs.length && (
            <div className="space-y-3">
              <p className="text-slate-300">Pergunte qualquer coisa sobre seus leads, vendas, conversas e agenda — ou peça para fazer algo no CRM.</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => void ask(s)} className="rounded-xl border border-line bg-ink-850 px-3 py-2 text-left text-slate-200 hover:border-brand-400/40 hover:bg-ink-800">{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[92%] rounded-2xl px-3 py-2", m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md border border-line bg-ink-850 text-slate-200")}>
                {m.role === "assistant" ? <Rich text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                {m.actions && (
                  <div className="mt-2 space-y-1.5 rounded-xl border border-brand-400/30 bg-brand-500/5 p-2">
                    {m.actions.map((a, k) => <p key={k} className="flex gap-1.5 text-xs text-slate-200"><Check className="mt-0.5 h-3 w-3 shrink-0 text-brand-300" /> {describe(a)}</p>)}
                    {m.done
                      ? <p className="pt-1 text-xs font-medium text-emerald-300">✓ Feito</p>
                      : <Button size="sm" className="mt-1 w-full" onClick={() => void confirm(i, m.actions!)}>Confirmar {m.actions.length > 1 ? `(${m.actions.length})` : ""}</Button>}
                  </div>
                )}
                {m.issues && <p className="mt-1 text-[11px] text-amber-300">{m.issues.join(" ")}</p>}
                {m.role === "assistant" && !m.content.startsWith("⚠️") && (
                  <button onClick={() => void navigator.clipboard.writeText(m.content.replace(/\*\*/g, "")).then(() => toast.success("Copiado"))}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"><Copy className="h-3 w-3" /> Copiar</button>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner className="h-4 w-4" /> Consultando o CRM…</div>}
        </div>

        <footer className="border-t border-line p-3">
          <div className="flex items-end gap-2">
            <button onClick={dictate} className={cn("mb-0.5 rounded-lg p-2.5 transition", listening ? "bg-red-500/20 text-red-300" : "text-slate-400 hover:bg-ink-800 hover:text-brand-200")} aria-label="Falar a pergunta" title="Falar a pergunta">
              <Mic className="h-5 w-5" />
            </button>
            <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }}
              placeholder={listening ? "Ouvindo…" : "Pergunte ou peça algo…"} className="field h-auto max-h-32 min-h-[42px] flex-1 resize-none py-2.5 leading-5" />
            <Button size="icon" className="mb-0.5 h-[42px] w-[42px]" onClick={() => void ask(text)} disabled={!text.trim() || busy} aria-label="Enviar">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

interface SpeechLike {
  lang: string; interimResults: boolean; continuous: boolean; start: () => void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}

"use client";
import { useEffect, useMemo, useRef } from "react";
import { Zap } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { cn, norm } from "@/lib/utils";
import type { QuickReply } from "@/lib/types";

/** Lista flutuante de mensagens rápidas, filtrada pelo que vem depois da "/". */
export function QuickReplyMenu({
  query, activeIndex, onHover, onPick,
}: { query: string; activeIndex: number; onHover: (i: number) => void; onPick: (q: QuickReply) => void }) {
  const ws = useWorkspace();
  const list = useQuickReplyMatches(query);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  if (!ws.quickReplies.length) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-line bg-ink-800 p-4 text-sm text-slate-400 shadow-card">
        Nenhuma mensagem rápida cadastrada. Crie em Configurações → Mensagens rápidas.
      </div>
    );
  }
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 animate-fadeIn overflow-hidden rounded-xl border border-line bg-ink-800 shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-slate-400">
        <Zap className="h-3.5 w-3.5 text-brand-300" /> Mensagens rápidas <span className="ml-auto">↑↓ navegar · Enter inserir · Esc fechar</span>
      </div>
      <ul ref={ref} className="max-h-64 overflow-y-auto p-1" role="listbox">
        {list.map((q, i) => (
          <li key={q.id} data-i={i} role="option" aria-selected={i === activeIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => { e.preventDefault(); onPick(q); }}
            className={cn("cursor-pointer rounded-lg px-3 py-2", i === activeIndex ? "bg-brand-500/15" : "hover:bg-ink-700")}>
            <div className="flex items-center gap-2">
              <code className="rounded bg-ink-950 px-1.5 py-0.5 text-xs text-brand-300">/{q.shortcut}</code>
              <span className="text-sm font-medium text-slate-100">{q.title}</span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{q.content}</p>
          </li>
        ))}
        {!list.length && <li className="px-3 py-4 text-center text-sm text-slate-500">Nada encontrado para “/{query}”</li>}
      </ul>
    </div>
  );
}

export function useQuickReplyMatches(query: string) {
  const ws = useWorkspace();
  return useMemo(() => {
    const q = norm(query);
    if (!q) return ws.quickReplies;
    return ws.quickReplies
      .filter((r) => r.shortcut.includes(q) || norm(r.title).includes(q) || norm(r.content).includes(q))
      .sort((a, b) => Number(b.shortcut.startsWith(q)) - Number(a.shortcut.startsWith(q)));
  }, [ws.quickReplies, query]);
}

/** Substitui variáveis: {nome}, {primeiro_nome}, {atendente}. */
export function fillTemplate(text: string, vars: { name?: string | null; agent?: string | null }) {
  const full = (vars.name ?? "").trim();
  return text
    .replace(/\{primeiro_nome\}/gi, full.split(/\s+/)[0] ?? "")
    .replace(/\{nome\}/gi, full)
    .replace(/\{atendente\}/gi, (vars.agent ?? "").split(/\s+/)[0] ?? "");
}

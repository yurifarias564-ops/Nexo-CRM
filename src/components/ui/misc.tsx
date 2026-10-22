"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const hue = [...(name ?? "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
  return (
    <div
      className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-white/10", className)}
      style={{ background: `linear-gradient(135deg, hsl(${215 + hue} 70% 40%), hsl(${225 + hue} 75% 22%))` }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function TagPill({ name, color, onRemove, className }: { name: string; color: string; onRemove?: () => void; className?: string }) {
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium", className)}
      style={{ backgroundColor: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded hover:bg-white/10" aria-label={`Remover ${name}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <div className={cn("h-5 w-5 animate-spin rounded-full border-2 border-brand-400/30 border-t-brand-400", className)} />;
}

export function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-ink-800 text-brand-300">{icon}</div>
      <div>
        <p className="font-medium text-slate-100">{title}</p>
        {text && <p className="mt-1 max-w-sm text-sm text-slate-400">{text}</p>}
      </div>
      {action}
    </div>
  );
}

/** Renderiza no <body>, fora de qualquer ancestral com transform/filter (que prenderia o position:fixed). */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

/** Modal acessível (ESC fecha, foco preso no conteúdo, clique fora fecha). */
export function Modal({
  open, onClose, title, children, wide, footer,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className={cn("relative w-full animate-fadeIn card max-h-[90vh] flex flex-col", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
    </Portal>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

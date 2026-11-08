"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleDollarSign, Megaphone, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { formatMoney, STATUS_LABEL, type BroadcastRow } from "@/lib/broadcasts";
import { NewBroadcast } from "./new-broadcast";
import { BroadcastDetail } from "./broadcast-detail";

export const STATUS_STYLE: Record<BroadcastRow["status"], string> = {
  scheduled: "bg-sky-500/15 text-sky-300",
  sending: "bg-brand-500/20 text-brand-200",
  paused: "bg-amber-500/15 text-amber-300",
  done: "bg-emerald-500/15 text-emerald-300",
  canceled: "bg-ink-700 text-slate-400",
};

export function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

export function Progress({ b }: { b: BroadcastRow }) {
  const pct = (n: number) => (b.total ? (n / b.total) * 100 : 0);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-ink-800" aria-label={`${b.sent} de ${b.total} enviados`}>
      <span className="bg-emerald-400 transition-[width] duration-700" style={{ width: `${pct(b.sent)}%` }} />
      <span className="bg-red-400 transition-[width] duration-700" style={{ width: `${pct(b.failed)}%` }} />
      <span className="bg-slate-600 transition-[width] duration-700" style={{ width: `${pct(b.skipped)}%` }} />
    </div>
  );
}

export function BroadcastsPage() {
  const [list, setList] = useState<BroadcastRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/broadcasts", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setList(j.broadcasts);
  }, []);
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    return () => clearTimeout(t0);
  }, [load]);
  // Enquanto algum estiver enviando, atualiza a lista
  const live = list?.some((b) => b.status === "sending" || b.status === "scheduled");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [live, load]);

  if (creating) {
    return <NewBroadcast onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); void load(); setOpen(id); }} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Disparos</h2>
            <p className="mt-1 text-sm text-slate-400">Envie uma mensagem para muitos leads de uma vez, agora ou no dia e hora que escolher.</p>
          </div>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo disparo</Button>
        </div>

        {list === null ? (
          <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
        ) : !list.length ? (
          <div className="card p-6">
            <Empty icon={<Megaphone className="h-5 w-5" />} title="Nenhum disparo ainda"
              text="Escolha o público (tag, coluna, leads parados ou leads específicos), escreva a mensagem e envie agora ou agende."
              action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Criar o primeiro disparo</Button>} />
          </div>
        ) : (
          <ul className="nx-stagger space-y-3">
            {list.map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpen(b.id)} className="card block w-full p-4 text-left transition hover:border-brand-400/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold text-white">{b.name}</span>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[b.status])}>
                      {b.status === "sending" && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />}
                      {STATUS_LABEL[b.status]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{fmtWhen(b.send_at)}</span>
                    <span className="inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" />{b.sent.toLocaleString("pt-BR")} de {b.total.toLocaleString("pt-BR")} enviados{b.failed ? ` · ${b.failed} falharam` : ""}</span>
                    {b.cost_estimated != null && b.cost_currency && (
                      <span className="inline-flex items-center gap-1"><CircleDollarSign className="h-3.5 w-3.5" />até {formatMoney(Number(b.cost_estimated), b.cost_currency as "BRL")}</span>
                    )}
                    <span className="truncate">{b.audience?.label}</span>
                  </div>
                  <div className="mt-3"><Progress b={b} /></div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <BroadcastDetail id={open} onClose={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

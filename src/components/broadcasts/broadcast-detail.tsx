"use client";
import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { durationLabel, formatMoney, STATUS_LABEL, type BroadcastRow } from "@/lib/broadcasts";
import { fmtWhen, Progress, STATUS_STYLE } from "./broadcasts-page";

type Rcpt = { id: number; lead_id: string; name: string | null; phone: string; status: string; error: string | null; sent_at: string | null };
const TABS = [
  { id: "failed", label: "Falharam" },
  { id: "sent", label: "Enviados" },
  { id: "pending", label: "Na fila" },
  { id: "canceled", label: "Não enviados" },
] as const;

export function BroadcastDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [b, setB] = useState<BroadcastRow | null>(null);
  const [rows, setRows] = useState<Rcpt[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("failed");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/broadcasts/${id}?status=${tab}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setB(j.broadcast); setRows(j.recipients); }
  }, [id, tab]);
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    return () => clearTimeout(t0);
  }, [load]);
  const live = b?.status === "sending" || b?.status === "scheduled";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [live, load]);

  async function act(action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !confirm("Parar o disparo agora? Quem ainda não recebeu não vai receber.")) return;
    setBusy(action);
    const r = await fetch(`/api/broadcasts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return toast.error(j.error ?? "Não deu certo");
    setB(j.broadcast);
    toast.success(action === "cancel" ? "Disparo parado" : action === "pause" ? "Disparo pausado" : "Disparo retomado");
  }

  const pending = b ? b.total - b.sent - b.failed - b.skipped : 0;
  return (
    <Modal open onClose={onClose} title={b?.name ?? "Disparo"} wide
      footer={b && ["scheduled", "sending", "paused"].includes(b.status) ? (
        <>
          {b.status === "paused"
            ? <Button variant="outline" onClick={() => act("resume")} loading={busy === "resume"}><Play className="h-4 w-4" /> Continuar</Button>
            : <Button variant="outline" onClick={() => act("pause")} loading={busy === "pause"}><Pause className="h-4 w-4" /> Pausar</Button>}
          <Button variant="danger" onClick={() => act("cancel")} loading={busy === "cancel"}><Square className="h-4 w-4" /> Parar disparo</Button>
        </>
      ) : undefined}>
      {!b ? <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</span>
            <span className="text-slate-400">{b.status === "scheduled" ? "Começa" : "Início"}: {fmtWhen(b.started_at ?? b.send_at)}</span>
            {b.finished_at && <span className="text-slate-400">· Fim: {fmtWhen(b.finished_at)}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Enviados", b.sent, "text-emerald-300"], ["Falharam", b.failed, "text-red-300"], ["Na fila", Math.max(0, pending), "text-slate-200"], ["Não enviados", b.skipped, "text-slate-400"]].map(([l, v, c]) => (
              <div key={l as string} className="rounded-xl border border-line bg-ink-850 p-3">
                <p className="text-xs text-slate-400">{l}</p>
                <p className={cn("num mt-1 text-xl font-semibold", c as string)}>{(v as number).toLocaleString("pt-BR")}</p>
              </div>
            ))}
          </div>
          <div>
            <Progress b={b} />
            <p className="mt-2 text-xs text-slate-500">
              {b.sent + b.failed} de {b.total} processados
              {b.status === "sending" && pending > 0 && b.interval_seconds > 0 ? ` · faltam ${durationLabel(pending, b.interval_seconds)}` : ""}
            </p>
          </div>

          {b.cost_estimated != null && b.cost_currency && (
            <div className="rounded-xl border border-line bg-ink-850 p-3 text-sm">
              <p className="text-slate-300">Custo na Meta: <b className="text-white">até {formatMoney(Number(b.cost_estimated), b.cost_currency as "BRL")}</b></p>
              <p className="mt-1 text-xs text-slate-500">
                {b.total - b.cost_other_country} mensagens × {formatMoney(Number(b.cost_unit), b.cost_currency as "BRL")} ({b.template_category === "MARKETING" ? "marketing" : "utilidade"}).
                Mensagem que falha não é cobrada{b.sent < b.total ? `; pelo enviado até agora: ${formatMoney(b.sent * Number(b.cost_unit), b.cost_currency as "BRL")}` : ""}.
              </p>
            </div>
          )}

          <div>
            <div className="seg mb-3">
              {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={cn(tab === t.id && "on")}>{t.label}</button>)}
            </div>
            {rows.length ? (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-100">{r.name ?? "Sem nome"} <span className="text-xs text-slate-500">+{r.phone}</span></p>
                      {r.error && <p className="text-xs text-red-300">{r.error}</p>}
                    </div>
                    {r.sent_at && <span className="shrink-0 text-xs text-slate-500">{fmtWhen(r.sent_at)}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-slate-500">Ninguém aqui</p>}
            {rows.length === 200 && <p className="mt-2 text-xs text-slate-500">Mostrando os primeiros 200.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, Check, Pencil, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Empty, Spinner } from "@/components/ui/misc";
import { ScheduleMessageModal, type EditingScheduled } from "./schedule-message-modal";
import { cn, formatPhone } from "@/lib/utils";

export type ScheduledStatus = "pending" | "sending" | "sent" | "failed" | "canceled";
type Row = {
  id: string; lead_id: string | null; conversation_id: string | null; created_by: string | null; body: string | null;
  template_name: string | null; send_at: string; time_zone: string; status: ScheduledStatus; attempts: number;
  last_error: string | null; sent_at: string | null;
  leads: { name: string } | { name: string }[] | null;
  conversations: { contact_name: string | null; wa_id: string } | { contact_name: string | null; wa_id: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const STATUS: Record<ScheduledStatus, { label: string; cls: string }> = {
  pending: { label: "Agendada", cls: "bg-brand-500/15 text-brand-200" },
  sending: { label: "Enviando", cls: "bg-brand-500/15 text-brand-200" },
  sent: { label: "Enviada", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Falhou", cls: "bg-red-500/15 text-red-300" },
  canceled: { label: "Cancelada", cls: "bg-ink-700 text-slate-400" },
};

function when(iso: string, tz: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Lista de mensagens agendadas (de um lead ou da empresa toda). */
export function ScheduledList({ leadId, statuses, compact, refreshKey = 0, emptyText }: {
  leadId?: string; statuses: ScheduledStatus[]; compact?: boolean; refreshKey?: number; emptyText?: string;
}) {
  const ws = useWorkspace();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<(EditingScheduled & { name: string }) | null>(null);
  const [tick, setTick] = useState(0);
  const key = statuses.join(",");

  const load = useCallback(async () => {
    let q = supabaseBrowser().from("scheduled_messages")
      .select("id, lead_id, conversation_id, created_by, body, template_name, send_at, time_zone, status, attempts, last_error, sent_at, leads(name), conversations(contact_name, wa_id)")
      .in("status", key.split(","))
      .order("send_at", { ascending: key.includes("pending") })
      .limit(compact ? 20 : 200);
    if (leadId) q = q.eq("lead_id", leadId);
    const { data, error } = await q;
    if (error) { toast.error("Falha ao carregar mensagens agendadas"); return; }
    setRows((data ?? []) as Row[]);
  }, [leadId, key, compact]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const iv = setInterval(() => void load(), 30_000); // acompanha os envios automáticos
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [load, refreshKey, tick]);

  async function cancel(r: Row) {
    if (!confirm("Cancelar esta mensagem agendada? Ela não será enviada.")) return;
    const res = await fetch(`/api/scheduled-messages/${r.id}`, { method: "DELETE" });
    const b = await res.json();
    if (!res.ok) return toast.error(b.error);
    toast.success("Mensagem cancelada");
    setTick((x) => x + 1);
  }
  async function retry(r: Row) {
    const res = await fetch(`/api/scheduled-messages/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryNow: true }) });
    const b = await res.json();
    if (!res.ok) return toast.error(b.error);
    toast.success("Voltou para a fila: será enviada no próximo minuto");
    setTick((x) => x + 1);
  }

  if (!rows) return <div className="flex justify-center py-6"><Spinner /></div>;
  if (!rows.length) {
    return compact
      ? <p className="text-sm text-slate-600">{emptyText ?? "Nenhuma mensagem agendada."}</p>
      : <Empty icon={<CalendarClock className="h-5 w-5" />} title={emptyText ?? "Nada por aqui"} text="Agende pelo chat, pelo lead ou por voz: “mande para o Yuri dia 31 às 9h: e aí, tudo certo?”" />;
  }

  return (
    <>
      <ul className={cn("space-y-2", compact && "space-y-1.5")}>
        {rows.map((r) => {
          const name = one(r.leads)?.name ?? one(r.conversations)?.contact_name ?? formatPhone(one(r.conversations)?.wa_id ?? "");
          const st = STATUS[r.status];
          const author = r.created_by ? ws.memberById.get(r.created_by) : null;
          return (
            <li key={r.id} className={cn("rounded-lg border border-line bg-ink-850", compact ? "px-3 py-2" : "p-4")}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!compact && <span className="font-medium text-slate-100">{name}</span>}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
                    <span className="text-xs text-slate-400">
                      {r.status === "sent" && r.sent_at ? `enviada ${when(r.sent_at, r.time_zone)}` : when(r.send_at, r.time_zone)}
                    </span>
                    {!compact && author && <span className="text-xs text-slate-600">· por {author.full_name ?? author.email}</span>}
                  </div>
                  <p className={cn("mt-1 whitespace-pre-wrap break-words text-sm text-slate-300", compact && "line-clamp-2")}>
                    {r.body ?? <span className="italic text-slate-400">Modelo: {r.template_name}</span>}
                  </p>
                  {r.last_error && r.status !== "sent" && (
                    <p className="mt-1 flex gap-1.5 text-xs text-amber-300"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.last_error}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.status === "pending" && r.body !== null && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Editar" aria-label="Editar"
                      onClick={() => setEditing({ id: r.id, body: r.body, send_at: r.send_at, name })}><Pencil className="h-3.5 w-3.5" /></Button>
                  )}
                  {r.status === "failed" && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-brand-200" title="Enviar agora" aria-label="Enviar agora" onClick={() => retry(r)}><RotateCcw className="h-3.5 w-3.5" /></Button>
                  )}
                  {(r.status === "pending" || r.status === "failed") && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-300" title="Cancelar" aria-label="Cancelar" onClick={() => cancel(r)}><X className="h-3.5 w-3.5" /></Button>
                  )}
                  {r.status === "sent" && <Check className="h-4 w-4 text-emerald-300" aria-hidden />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <ScheduleMessageModal open={!!editing} onClose={() => setEditing(null)} contactName={editing?.name ?? ""}
        editing={editing} onDone={() => setTick((x) => x + 1)} />
    </>
  );
}

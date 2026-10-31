"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, MessageCircle, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { cn, formatPhone } from "@/lib/utils";

/** Há quanto tempo o cliente espera: "12 min", "3 h", "2 dias". */
function waited(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m || 1} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 1440);
  return `${d} dia${d > 1 ? "s" : ""}`;
}

interface Row { id: string; name: string; phone: string | null; assigned_to: string | null; last_message_at: string; last_message_preview: string | null; conversation_id: string | null }

/** Finaliza o atendimento do lead: sai de "aguardando resposta" até o cliente mandar mensagem de novo. */
export async function closeAttendance(leadId: string) {
  const { error } = await supabaseBrowser().from("leads").update({ attendance_closed_at: new Date().toISOString() }).eq("id", leadId);
  if (error) throw new Error(error.message);
}

export function CloseAttendanceButton({ leadId, onDone, compact }: { leadId: string; onDone?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" loading={busy} title="Tira o cliente da lista de “aguardando resposta” até ele mandar mensagem de novo"
      onClick={async () => {
        setBusy(true);
        try { await closeAttendance(leadId); toast.success("Atendimento finalizado"); onDone?.(); } catch (e) { toast.error((e as Error).message); }
        setBusy(false);
      }}>
      {!busy && <CheckCheck className="h-3.5 w-3.5" />} {compact ? <span className="hidden sm:inline">Finalizar</span> : "Finalizar atendimento"}
    </Button>
  );
}

/** Quadro vermelho piscando com os clientes que mandaram mensagem e ainda não foram respondidos. */
export function UnansweredTile({ seller }: { seller: string }) {
  const ws = useWorkspace();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("unanswered_leads", { org: ws.orgId, p_seller: seller || null });
    if (!error) setRows((data ?? []) as Row[]);
  }, [ws.orgId, seller]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const i = setInterval(() => void load(), 30_000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [load]);

  const n = rows?.length ?? 0;
  const oldest = rows?.[0]?.last_message_at;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!rows}
        className={cn("card p-4 text-left transition hover:brightness-110", n > 0 ? "border-red-500/50 bg-gradient-to-br from-red-500/15 to-transparent" : "")}>
        <p className={cn("flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide", n > 0 ? "text-red-300" : "text-slate-400")}>
          <MessageSquareWarning className="h-3.5 w-3.5" /> Sem resposta
        </p>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", n > 0 ? "animate-pulse text-red-400" : "text-white")}>{rows ? n.toLocaleString("pt-BR") : "…"}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{n > 0 ? `o mais antigo espera há ${waited(oldest!)} · clique para ver` : "todos respondidos ✓"}</p>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Clientes esperando resposta (${n})`} wide>
        {!rows ? <div className="flex justify-center py-8"><Spinner /></div> : !rows.length ? (
          <p className="py-8 text-center text-sm text-slate-400">Ninguém esperando. 🎉</p>
        ) : (
          <ul className="divide-y divide-line" data-modal-body>
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{r.name}{r.phone ? <span className="ml-2 text-xs font-normal text-slate-500">{formatPhone(r.phone)}</span> : null}</p>
                  <p className="truncate text-xs text-slate-400">“{r.last_message_preview || "mensagem"}”</p>
                  <p className="text-[11px] text-red-300">esperando há {waited(r.last_message_at)}{r.assigned_to ? ` · ${ws.memberById.get(r.assigned_to)?.full_name ?? "vendedor"}` : " · sem responsável"}</p>
                </div>
                {r.conversation_id && <Link href={`/inbox?c=${r.conversation_id}`}><Button size="sm"><MessageCircle className="h-3.5 w-3.5" /> Responder</Button></Link>}
                <CloseAttendanceButton leadId={r.id} onDone={() => setRows((x) => (x ?? []).filter((y) => y.id !== r.id))} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

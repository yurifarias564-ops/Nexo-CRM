"use client";
import { memo, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { LeadPhoto } from "@/components/lead/lead-photo";
import { Avatar, TagPill } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { cn, formatBRL } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time-ago";
import type { Lead } from "@/lib/types";

/** Desde quando o lead está sem movimento (última mensagem ou mudança de etapa). */
export function idleSince(l: Lead): number {
  const t = [l.stage_changed_at, l.last_message_at, l.created_at].filter(Boolean).map((x) => new Date(x!).getTime());
  return Math.max(...t);
}

function fmtIdle(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Tempo parado, aumentando sozinho a cada minuto. Verde até 3 dias, amarelo até 7, vermelho depois. */
function IdleBadge({ since }: { since: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, []);
  if (now === null) return null;
  const ms = now - since;
  const days = ms / 86_400_000;
  return (
    <span title="Tempo sem movimento (sem mensagem e sem mudar de etapa)"
      className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        days >= 7 ? "bg-red-500/15 text-red-300" : days >= 3 ? "bg-amber-500/15 text-amber-300" : "bg-ink-700 text-slate-400")}>
      <Clock className="h-3 w-3" /> parado {fmtIdle(ms)}
    </span>
  );
}

export const LeadCardView = memo(function LeadCardView({ lead, tagIds, dragging, onOpen }: { lead: Lead; tagIds: string[]; dragging?: boolean; onOpen?: () => void }) {
  const ws = useWorkspace();
  const owner = lead.assigned_to ? ws.memberById.get(lead.assigned_to) : null;
  return (
    <div
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-lg border border-line bg-ink-800/90 p-3 shadow-card transition hover:border-brand-400/40 hover:bg-ink-800",
        dragging && "rotate-[1.5deg] border-brand-400/60 shadow-glow",
      )}
    >
      <div className="flex items-start gap-2.5">
        <LeadPhoto lead={lead} />
        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-slate-100">{lead.name}</p>
        {owner && <Avatar name={owner.full_name ?? owner.email} className="h-6 w-6 text-[9px]" />}
      </div>
      {tagIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tagIds.slice(0, 4).map((id) => {
            const t = ws.tagById.get(id);
            return t ? <TagPill key={id} name={t.name} color={t.color} /> : null;
          })}
          {tagIds.length > 4 && <span className="text-[11px] text-slate-500">+{tagIds.length - 4}</span>}
        </div>
      )}
      {lead.last_message_at && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-ink-900/60 px-2 py-1 text-xs text-slate-400">
          {lead.last_message_dir === "out"
            ? <ArrowUpRight className="h-3 w-3 shrink-0 text-sky-300" aria-label="Última mensagem enviada por você" />
            : <ArrowDownLeft className="h-3 w-3 shrink-0 text-emerald-300" aria-label="Última mensagem do cliente" />}
          <span className="min-w-0 flex-1 truncate">{lead.last_message_preview ?? "Mensagem"}</span>
          <span className="shrink-0 text-[10px] text-slate-500"><TimeAgo iso={lead.last_message_at} /></span>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        <span className={cn("font-medium tabular-nums", Number(lead.value) > 0 ? "text-emerald-300" : "text-slate-600")}>
          {formatBRL(lead.value)}
        </span>
        <IdleBadge since={idleSince(lead)} />
      </div>
    </div>
  );
});

export function SortableLeadCard({ lead, tagIds, onOpen }: { lead: Lead; tagIds: string[]; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id, data: { stageId: lead.stage_id } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <LeadCardView lead={lead} tagIds={tagIds} onOpen={onOpen} />
    </div>
  );
}

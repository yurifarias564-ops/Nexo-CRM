"use client";
import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageCircle } from "lucide-react";
import { Avatar, TagPill } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { cn, formatBRL } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time-ago";
import type { Lead } from "@/lib/types";

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
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-100">{lead.name}</p>
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
      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className={cn("font-medium tabular-nums", Number(lead.value) > 0 ? "text-emerald-300" : "text-slate-600")}>
          {formatBRL(lead.value)}
        </span>
        {lead.last_message_at && (
          <span className="flex items-center gap-1 text-slate-500">
            <MessageCircle className="h-3 w-3" /> <TimeAgo iso={lead.last_message_at} />
          </span>
        )}
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

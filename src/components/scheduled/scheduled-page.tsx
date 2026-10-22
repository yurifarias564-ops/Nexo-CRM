"use client";
import { useState } from "react";
import { ScheduledList, type ScheduledStatus } from "./scheduled-list";
import { cn } from "@/lib/utils";

const TABS: { id: string; label: string; statuses: ScheduledStatus[]; empty: string }[] = [
  { id: "pending", label: "Próximas", statuses: ["pending", "sending"], empty: "Nenhuma mensagem programada" },
  { id: "sent", label: "Enviadas", statuses: ["sent"], empty: "Nenhuma mensagem enviada ainda" },
  { id: "failed", label: "Com falha", statuses: ["failed"], empty: "Nenhuma falha" },
  { id: "canceled", label: "Canceladas", statuses: ["canceled"], empty: "Nenhuma cancelada" },
];

export function ScheduledPage() {
  const [tab, setTab] = useState("pending");
  const t = TABS.find((x) => x.id === tab)!;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Mensagens agendadas</h2>
          <p className="mt-1 text-sm text-slate-400">Enviadas automaticamente no WhatsApp no dia e hora escolhidos.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
              className={cn("flex-1 rounded-md py-1.5 font-medium transition", tab === x.id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>{x.label}</button>
          ))}
        </div>
        <ScheduledList key={tab} statuses={t.statuses} emptyText={t.empty} />
      </div>
    </div>
  );
}

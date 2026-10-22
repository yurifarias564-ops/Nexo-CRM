"use client";
import { useState } from "react";
import { ClipboardCheck, LineChart, Settings2, UsersRound } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTeamBase } from "./data";
import { Checklist } from "./checklist";
import { TeamBoard } from "./board";
import { TeamSetup } from "./setup";

type Tab = "checklist" | "board" | "setup";

export function TeamPage() {
  const ws = useWorkspace();
  const base = useTeamBase(ws.orgId);
  const [tab, setTab] = useState<Tab>("checklist");
  const ready = base.sellers !== null && base.metrics !== null;
  const empty = ready && (!base.sellers!.some((s) => s.active) || !base.metrics!.some((m) => m.active));
  const tabs: { id: Tab; label: string; icon: typeof ClipboardCheck }[] = [
    { id: "checklist", label: "Checklist do dia", icon: ClipboardCheck },
    { id: "board", label: "Painel do time", icon: LineChart },
    ...(ws.canManage ? [{ id: "setup" as Tab, label: "Vendedores e metas", icon: Settings2 }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white"><UsersRound className="h-5 w-5 text-brand-300" /> Time comercial</h2>
          <p className="mt-1 text-sm text-slate-400">Cada vendedora preenche o próprio checklist do dia. Metas diárias e mensais, painel do time e comparação entre meses.</p>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
          {tabs.map(({ id, label, icon: I }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition", tab === id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {!ready ? <div className="card flex h-48 items-center justify-center"><Spinner /></div>
          : empty && tab !== "setup" ? (
            <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
              <UsersRound className="h-8 w-8 text-brand-300" />
              <p className="font-medium text-white">Cadastre as vendedoras e os indicadores</p>
              <p className="max-w-md text-sm text-slate-400">Defina quem faz parte do time e o que cada uma precisa bater por dia e por mês (contatos, vídeos, ligações, vendas…).</p>
              {ws.canManage ? <Button onClick={() => setTab("setup")}>Configurar agora</Button> : <p className="text-sm text-slate-500">Peça para um administrador configurar.</p>}
            </div>
          )
            : tab === "checklist" ? <Checklist sellers={base.sellers!} metrics={base.metrics!} />
              : tab === "board" ? <TeamBoard sellers={base.sellers!} metrics={base.metrics!} />
                : <TeamSetup sellers={base.sellers!} metrics={base.metrics!} reload={base.reload} />}
      </div>
    </div>
  );
}

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
  const { base, error, reload } = useTeamBase(ws.orgId);
  const [tab, setTab] = useState<Tab>("checklist");
  const empty = !!base && (!base.sellers.some((s) => s.active) || !base.metrics.some((m) => m.active));
  const tabs: { id: Tab; label: string; icon: typeof ClipboardCheck }[] = [
    { id: "checklist", label: "Checklist do dia", icon: ClipboardCheck },
    ...(ws.canManage ? [{ id: "board" as Tab, label: "Painel do gestor", icon: LineChart }, { id: "setup" as Tab, label: "Configurar", icon: Settings2 }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">{ws.orgName}</p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold uppercase tracking-tight text-white"><UsersRound className="h-6 w-6 text-brand-300" /> Time comercial</h2>
          </div>
          {tabs.length > 1 && (
            <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
              {tabs.map(({ id, label, icon: I }) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cn("flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition", tab === id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
                  <I className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {error ? <div className="card px-6 py-10 text-center text-sm text-red-300">Não foi possível carregar o time: {error}</div>
          : !base ? <div className="card flex h-48 items-center justify-center"><Spinner /></div>
            : empty && tab === "checklist" ? (
              <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
                <UsersRound className="h-8 w-8 text-brand-300" />
                {ws.canManage ? (
                  <>
                    <p className="font-medium text-white">Cadastre o time e as metas</p>
                    <p className="max-w-md text-sm text-slate-400">Pessoas (SDR ou Closer), lojas, e o que cada função precisa bater por dia, semana e mês. Tem modelos prontos para começar em 1 clique.</p>
                    <Button onClick={() => setTab("setup")}>Configurar agora</Button>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-white">Seu acompanhamento ainda não foi ligado</p>
                    <p className="max-w-md text-sm text-slate-400">Peça ao administrador para, em Time comercial → Configurar, escolher o seu login na sua linha. Aí suas metas e resultados aparecem aqui.</p>
                  </>
                )}
              </div>
            )
              : tab === "checklist" ? <Checklist base={base} reloadBase={reload} />
                : tab === "board" ? <TeamBoard base={base} />
                  : <TeamSetup base={base} reload={reload} />}
      </div>
    </div>
  );
}

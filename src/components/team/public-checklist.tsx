"use client";
/* eslint-disable @next/next/no-img-element -- logo da empresa (personalização) */
import { useCallback, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Spinner } from "@/components/ui/misc";
import { Checklist } from "./checklist";
import { normalizeBase, publicTeamApi, TeamApiContext, useTeamBase, type TeamBase } from "./data";

/** Página do link do cliente: só o checklist do time daquela empresa, sem login. */
export function PublicChecklist({ token }: { token: string }) {
  const api = useMemo(() => publicTeamApi(token), [token]);
  const [org, setOrg] = useState<{ name: string; logo: string | null; color: string | null }>({ name: "", logo: null, color: null });
  const load = useCallback(async (): Promise<TeamBase> => {
    const r = await fetch(`/api/checklist/${encodeURIComponent(token)}?scope=base`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Link inválido");
    setOrg({ name: j.orgName ?? "", logo: j.brand?.logo ?? null, color: j.brand?.color ?? null });
    return normalizeBase(j);
  }, [token]);
  const { base, error, reload } = useTeamBase(load);
  const empty = !!base && (!base.sellers.some((s) => s.active) || !base.metrics.some((m) => m.active));

  return (
    <div className="min-h-dvh bg-ink-950">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <div className="flex items-center gap-4 border-b border-line pb-5">
          {org.logo
            ? <img src={org.logo} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-contain p-1" />
            : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-white" style={{ background: org.color ?? "rgb(var(--brand-500))" }}>{org.name.trim()[0]?.toUpperCase() ?? <ClipboardCheck className="h-6 w-6" />}</span>}
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">Checklist do dia</p>
            <h1 className="truncate text-2xl font-bold uppercase tracking-tight text-white sm:text-3xl">{org.name || " "}</h1>
          </div>
        </div>
        {error ? <div className="card px-6 py-12 text-center text-sm text-red-300">{error}</div>
          : !base ? <div className="card flex h-48 items-center justify-center"><Spinner /></div>
            : empty ? <div className="card px-6 py-12 text-center text-sm text-slate-400">O checklist desta empresa ainda está sendo configurado.</div>
              : <TeamApiContext.Provider value={api}><Checklist base={base} reloadBase={reload} /></TeamApiContext.Provider>}
      </div>
    </div>
  );
}

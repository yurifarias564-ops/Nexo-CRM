"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DEFAULT_TZ } from "@/lib/time";
import type { TeamGoal, TeamMetric, TeamSeller, TeamValue } from "@/lib/team";

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

/** Vendedores e indicadores da empresa (com recarga). */
export function useTeamBase(orgId: string) {
  const [sellers, setSellers] = useState<TeamSeller[] | null>(null);
  const [metrics, setMetrics] = useState<TeamMetric[] | null>(null);
  const reload = useCallback(async () => {
    const sb = supabaseBrowser();
    const [s, m] = await Promise.all([
      sb.from("team_sellers").select("id, name, user_id, active, position").eq("organization_id", orgId).order("position").order("created_at"),
      sb.from("team_metrics").select("id, name, unit, source, daily_target, monthly_target, active, position").eq("organization_id", orgId).order("position").order("created_at"),
    ]);
    setSellers((s.data ?? []) as TeamSeller[]);
    setMetrics(((m.data ?? []) as TeamMetric[]).map((x) => ({ ...x, daily_target: x.daily_target === null ? null : Number(x.daily_target), monthly_target: x.monthly_target === null ? null : Number(x.monthly_target) })));
  }, [orgId]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { sellers, metrics, reload };
}

export async function fetchGoals(orgId: string, period: string): Promise<TeamGoal[]> {
  const { data } = await supabaseBrowser().from("team_goals").select("seller_id, metric_id, daily_target, monthly_target")
    .eq("organization_id", orgId).eq("period", `${period}-01`);
  return (data ?? []) as TeamGoal[];
}

export async function fetchValues(orgId: string, from: string, to: string, tz: string): Promise<TeamValue[]> {
  const { data, error } = await supabaseBrowser().rpc("team_values", { org: orgId, p_from: from, p_to: to, tz });
  if (error) throw error;
  return ((data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
}

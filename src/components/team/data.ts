"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DEFAULT_TZ } from "@/lib/time";
import type { TeamMetric, TeamNote, TeamSale, TeamSeller, TeamSellerGoal, TeamSettings, TeamStore, TeamValue } from "@/lib/team";

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

export interface TeamBase {
  stores: TeamStore[];
  sellers: TeamSeller[];
  metrics: TeamMetric[];
  goals: TeamSellerGoal[];
  settings: TeamSettings;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Configuração do time da empresa (lojas, pessoas, indicadores, metas, ciclo). */
export function useTeamBase(orgId: string) {
  const [base, setBase] = useState<TeamBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const sb = supabaseBrowser();
    const [st, s, m, g, cfg] = await Promise.all([
      sb.from("team_stores").select("id, name, revenue_goal, os_daily_goal, position").eq("organization_id", orgId).order("position").order("created_at"),
      sb.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", orgId).order("position").order("created_at"),
      sb.from("team_metrics").select("id, name, unit, source:origin, role, result_of, daily_target, weekly_target, monthly_target, active, position").eq("organization_id", orgId).order("position").order("created_at"),
      sb.from("team_seller_goals").select("seller_id, metric_id, daily_target, weekly_target, monthly_target").eq("organization_id", orgId),
      sb.from("team_settings").select("cycle_start, baseline, baseline_note").eq("organization_id", orgId).maybeSingle(),
    ]);
    const err = st.error ?? s.error ?? m.error ?? g.error ?? cfg.error;
    if (err) { setError(err.message); return; }
    setError(null);
    setBase({
      stores: ((st.data ?? []) as TeamStore[]).map((x) => ({ ...x, revenue_goal: n(x.revenue_goal), os_daily_goal: n(x.os_daily_goal) })),
      sellers: (s.data ?? []) as TeamSeller[],
      metrics: ((m.data ?? []) as TeamMetric[]).map((x) => ({ ...x, daily_target: n(x.daily_target), weekly_target: n(x.weekly_target), monthly_target: n(x.monthly_target) })),
      goals: ((g.data ?? []) as TeamSellerGoal[]).map((x) => ({ ...x, daily_target: n(x.daily_target), weekly_target: n(x.weekly_target), monthly_target: n(x.monthly_target) })),
      settings: {
        cycle_start: (cfg.data?.cycle_start as string | null) ?? null,
        baseline: ((cfg.data?.baseline ?? {}) as Record<string, number>),
        baseline_note: (cfg.data?.baseline_note as string | null) ?? null,
      },
    });
  }, [orgId]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { base, error, reload };
}

export async function fetchValues(orgId: string, from: string, to: string, tz: string): Promise<TeamValue[]> {
  const { data, error } = await supabaseBrowser().rpc("team_values", { org: orgId, p_from: from, p_to: to, tz });
  if (error) throw error;
  return ((data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
}

export async function fetchSales(orgId: string, from: string, to: string): Promise<TeamSale[]> {
  const { data, error } = await supabaseBrowser().from("team_sales")
    .select("id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at")
    .eq("organization_id", orgId).gte("day", from).lte("day", to).order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  return ((data ?? []) as TeamSale[]).map((x) => ({ ...x, value: Number(x.value) }));
}

export async function fetchNotes(orgId: string, from: string, to: string): Promise<TeamNote[]> {
  const { data, error } = await supabaseBrowser().from("team_notes")
    .select("seller_id, day, body, updated_at").eq("organization_id", orgId).gte("day", from).lte("day", to)
    .order("day", { ascending: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as TeamNote[];
}

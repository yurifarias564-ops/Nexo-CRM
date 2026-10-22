import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";
import { monthRange, periodLabel, previousPeriod } from "./period";
import { goalFor, metricApplies, monthDays, ROLE_LABEL, totals, type TeamMetric, type TeamSeller, type TeamSellerGoal, type TeamValue } from "@/lib/team";
export { monthRange, periodLabel, previousPeriod, currentPeriod, isLastDayOfMonth, hourIn, shiftPeriod } from "./period";

export type Metrics = {
  new_leads: number; won_count: number; won_value: number; lost_count: number; calls: number; calls_answered: number;
  scheduled_sent: number; appointments: number; appointments_held: number; messages_in: number; messages_out: number;
  open_count: number; open_value: number;
  by_source: { name: string; count: number }[];
  won_by_source: { name: string; count: number; value: number }[];
  by_stage: { name: string; count: number }[];
  won_by_owner: { name: string; count: number; value: number }[];
  // derivados
  followups: number;
  conversion: number | null;
};

export const GOAL_LABELS: Record<string, string> = {
  new_leads: "Leads recebidos",
  won_count: "Vendas (quantidade)",
  won_value: "Faturamento",
  calls: "Ligações",
  followups: "Follow-ups",
  appointments: "Agendamentos",
};

export interface GoalResult {
  metric: string;
  label: string;
  target: number;
  actual: number;
  pct: number;
  hit: boolean;
  money: boolean;
}

export interface TeamRow { metric: string; unit: "count" | "money"; actual: number; target: number | null; previous: number }
export interface TeamSellerReport { seller: string; rows: TeamRow[] }

export interface ReportData {
  orgName: string;
  period: string; // YYYY-MM
  periodLabel: string; // "Outubro de 2026"
  timeZone: string;
  current: Metrics;
  previous: Metrics;
  goals: GoalResult[];
  notes: string;
  team: TeamSellerReport[];
}

function normalize(raw: Record<string, unknown>): Metrics {
  const n = (k: string) => Number(raw[k] ?? 0);
  const won = n("won_count");
  const lost = n("lost_count");
  return {
    new_leads: n("new_leads"), won_count: won, won_value: n("won_value"), lost_count: lost, calls: n("calls"),
    calls_answered: n("calls_answered"), scheduled_sent: n("scheduled_sent"), appointments: n("appointments"),
    appointments_held: n("appointments_held"), messages_in: n("messages_in"), messages_out: n("messages_out"),
    open_count: n("open_count"), open_value: n("open_value"),
    by_source: (raw.by_source as Metrics["by_source"]) ?? [],
    won_by_source: ((raw.won_by_source as Metrics["won_by_source"]) ?? []).map((x) => ({ ...x, value: Number(x.value) })),
    by_stage: (raw.by_stage as Metrics["by_stage"]) ?? [],
    won_by_owner: ((raw.won_by_owner as Metrics["won_by_owner"]) ?? []).map((x) => ({ ...x, value: Number(x.value) })),
    followups: n("calls") + n("scheduled_sent"),
    conversion: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null,
  };
}

/** Avalia metas: a conta é feita aqui (determinística), não pela IA. */
export function evaluateGoals(goals: { metric: string; target: number }[], m: Metrics): GoalResult[] {
  return goals
    .filter((g) => GOAL_LABELS[g.metric] && g.target > 0)
    .map((g) => {
      const actual = Number((m as unknown as Record<string, number>)[g.metric] ?? 0);
      const pct = Math.round((actual / g.target) * 1000) / 10;
      return { metric: g.metric, label: GOAL_LABELS[g.metric]!, target: g.target, actual, pct, hit: actual >= g.target, money: g.metric === "won_value" };
    });
}

/** Junta tudo que o relatório precisa (o cliente `db` deve ter acesso à empresa). */
export async function buildReportData(db: SupabaseClient, orgId: string, period: string, tz: string): Promise<ReportData> {
  const cur = monthRange(period, tz);
  const prevP = previousPeriod(period);
  const prev = monthRange(prevP, tz);
  const [{ data: org }, a, b, { data: goals }, { data: note }] = await Promise.all([
    db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    db.rpc("report_metrics", { org: orgId, p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
    db.rpc("report_metrics", { org: orgId, p_from: prev.from.toISOString(), p_to: prev.to.toISOString() }),
    db.from("monthly_goals").select("metric, target").eq("organization_id", orgId).eq("period", `${period}-01`),
    db.from("report_notes").select("notes").eq("organization_id", orgId).eq("period", `${period}-01`).maybeSingle(),
  ]);
  const team = await buildTeam(db, orgId, period, prevP, tz);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  if (!org) throw new HttpError(404, "Empresa não encontrada");
  const current = normalize(a.data as Record<string, unknown>);
  return {
    orgName: org.name,
    period,
    periodLabel: periodLabel(period),
    timeZone: tz,
    current,
    previous: normalize(b.data as Record<string, unknown>),
    goals: evaluateGoals(((goals ?? []) as { metric: string; target: number }[]).map((g) => ({ metric: g.metric, target: Number(g.target) })), current),
    notes: note?.notes ?? "",
    team,
  };
}

/** Resultado de cada pessoa do time no mês (checklist do time comercial). */
async function buildTeam(db: SupabaseClient, orgId: string, period: string, prevP: string, tz: string): Promise<TeamSellerReport[]> {
  const a = monthDays(period);
  const b = monthDays(prevP);
  const [s, m, g, cur, prev] = await Promise.all([
    db.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", orgId).order("position"),
    db.from("team_metrics").select("id, name, unit, source, role, result_of, daily_target, weekly_target, monthly_target, active, position").eq("organization_id", orgId).eq("active", true).order("position"),
    db.from("team_seller_goals").select("seller_id, metric_id, daily_target, weekly_target, monthly_target").eq("organization_id", orgId),
    db.rpc("team_values", { org: orgId, p_from: a.first, p_to: a.last, tz }),
    db.rpc("team_values", { org: orgId, p_from: b.first, p_to: b.last, tz }),
  ]);
  const metrics = (m.data ?? []) as TeamMetric[];
  if (!metrics.length || s.error || cur.error || prev.error) return [];
  const goals = (g.data ?? []) as TeamSellerGoal[];
  const curT = totals(((cur.data ?? []) as TeamValue[]));
  const prevT = totals(((prev.data ?? []) as TeamValue[]));
  return ((s.data ?? []) as TeamSeller[])
    .filter((x) => x.active || metrics.some((mm) => (curT.get(`${x.id}:${mm.id}`) ?? 0) > 0))
    .map((x) => ({
      seller: x.role ? `${x.name} (${ROLE_LABEL[x.role]})` : x.name,
      rows: metrics.filter((mm) => metricApplies(mm, x)).map((mm) => ({
        metric: mm.result_of ? `${mm.name} (resultado)` : mm.name, unit: mm.unit, actual: Number(curT.get(`${x.id}:${mm.id}`) ?? 0),
        target: mm.result_of ? null : goalFor(goals, mm, x.id).monthly, previous: Number(prevT.get(`${x.id}:${mm.id}`) ?? 0),
      })),
    }));
}

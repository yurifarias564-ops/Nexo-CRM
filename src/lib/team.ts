// Acompanhamento do time comercial — tipos e contas (roda no servidor e na tela).

export type TeamSource = "manual" | "calls" | "calls_answered" | "won_count" | "won_value" | "appointments" | "followups_sent";

export interface TeamSeller { id: string; name: string; user_id: string | null; active: boolean; position: number }
export interface TeamMetric {
  id: string; name: string; unit: "count" | "money"; source: TeamSource;
  daily_target: number | null; monthly_target: number | null; active: boolean; position: number;
}
export interface TeamGoal { seller_id: string; metric_id: string; daily_target: number | null; monthly_target: number | null }
export interface TeamValue { seller_id: string; metric_id: string; day: string; value: number }

export const SOURCE_LABELS: Record<TeamSource, string> = {
  manual: "Preenchido pela vendedora",
  calls: "Automático: ligações registradas",
  calls_answered: "Automático: ligações atendidas",
  won_count: "Automático: vendas fechadas",
  won_value: "Automático: faturamento das vendas",
  appointments: "Automático: agendamentos marcados",
  followups_sent: "Automático: mensagens agendadas enviadas",
};

/** Rótulo curto para listas de escolha. */
export const SOURCE_SHORT: Record<TeamSource, string> = {
  manual: "Manual (vendedora)",
  calls: "Auto · Ligações",
  calls_answered: "Auto · Ligações atendidas",
  won_count: "Auto · Vendas",
  won_value: "Auto · Faturamento",
  appointments: "Auto · Agendamentos",
  followups_sent: "Auto · Msgs agendadas",
};

/** Indicadores sugeridos para começar (todos editáveis). */
export const SUGGESTED_METRICS: Omit<TeamMetric, "id" | "active" | "position">[] = [
  { name: "Contatos no WhatsApp", unit: "count", source: "manual", daily_target: 30, monthly_target: 660 },
  { name: "Contatos no Instagram", unit: "count", source: "manual", daily_target: 10, monthly_target: 220 },
  { name: "Vídeos no Instagram", unit: "count", source: "manual", daily_target: 5, monthly_target: 110 },
  { name: "Vídeos no TikTok", unit: "count", source: "manual", daily_target: 5, monthly_target: 110 },
  { name: "Ligações", unit: "count", source: "calls", daily_target: null, monthly_target: null },
  { name: "Vendas", unit: "count", source: "won_count", daily_target: null, monthly_target: null },
  { name: "Faturamento", unit: "money", source: "won_value", daily_target: null, monthly_target: null },
];

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Meta valendo para o vendedor no mês: a individual, senão a padrão do indicador. */
export function targetFor(goals: TeamGoal[], m: TeamMetric, sellerId: string): { daily: number | null; monthly: number | null } {
  const g = goals.find((x) => x.seller_id === sellerId && x.metric_id === m.id);
  return {
    daily: num(g?.daily_target) ?? num(m.daily_target),
    monthly: num(g?.monthly_target) ?? num(m.monthly_target),
  };
}

/** Soma por vendedor+indicador (e opcionalmente só um dia). */
export function totals(values: TeamValue[], day?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) {
    if (day && v.day !== day) continue;
    const k = `${v.seller_id}:${v.metric_id}`;
    out.set(k, (out.get(k) ?? 0) + Number(v.value));
  }
  return out;
}

/** Dias (distintos) em que a vendedora preencheu algo à mão. */
export function filledDays(values: TeamValue[], manualIds: Set<string>): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const v of values) {
    if (!manualIds.has(v.metric_id)) continue;
    const s = seen.get(v.seller_id) ?? new Set<string>();
    s.add(v.day);
    seen.set(v.seller_id, s);
  }
  return new Map([...seen].map(([k, s]) => [k, s.size]));
}

export const pct = (actual: number, target: number | null) => (target && target > 0 ? Math.round((actual / target) * 1000) / 10 : null);

/** Variação entre dois períodos (null quando não há base). */
export function delta(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export function fmtValue(v: number, unit: "count" | "money"): string {
  return unit === "money"
    ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** "2026-10" → primeiro e último dia (YYYY-MM-DD). */
export function monthDays(period: string): { first: string; last: string; days: number } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(days).padStart(2, "0")}`, days };
}

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

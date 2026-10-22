// Acompanhamento do time comercial — tipos e contas (roda no servidor e na tela).
// Mesmo modelo do playbook: função (SDR/Closer), loja, metas de atividade e de
// resultado (conversão), OS fechadas com valor, ciclo da consultoria.

export type TeamSource = "manual" | "calls" | "calls_answered" | "won_count" | "won_value" | "appointments" | "followups_sent" | "os_count" | "os_value";
export type TeamRole = "sdr" | "closer";
export type MetricRole = "todos" | TeamRole;

export interface TeamStore { id: string; name: string; revenue_goal: number | null; os_daily_goal: number | null; position: number }
export interface TeamSeller { id: string; name: string; user_id: string | null; active: boolean; position: number; role: TeamRole | null; store_id: string | null }
export interface TeamMetric {
  id: string; name: string; unit: "count" | "money"; source: TeamSource; role: MetricRole; result_of: string | null;
  daily_target: number | null; weekly_target: number | null; monthly_target: number | null; active: boolean; position: number;
}
export interface TeamSellerGoal { seller_id: string; metric_id: string; daily_target: number | null; weekly_target: number | null; monthly_target: number | null }
export interface TeamValue { seller_id: string; metric_id: string; day: string; value: number }
export interface TeamSale { id: string; seller_id: string; store_id: string | null; sdr_id: string | null; day: string; value: number; os_number: string | null; note: string | null; created_at: string }
export interface TeamNote { seller_id: string; day: string; body: string; updated_at: string }
export interface TeamSettings { cycle_start: string | null; baseline: Record<string, number>; baseline_note: string | null }

/** Mês comercial = 20 dias úteis; semana = 5 (igual ao playbook). */
export const WORKDAYS_MONTH = 20;
export const WORKDAYS_WEEK = 5;

export const ROLE_LABEL: Record<TeamRole, string> = { sdr: "SDR", closer: "Closer" };

export const SOURCE_LABELS: Record<TeamSource, string> = {
  manual: "Preenchido no checklist",
  calls: "Automático: ligações registradas no CRM",
  calls_answered: "Automático: ligações atendidas no CRM",
  won_count: "Automático: vendas fechadas no funil",
  won_value: "Automático: faturamento do funil",
  appointments: "Automático: agendamentos marcados",
  followups_sent: "Automático: mensagens agendadas enviadas",
  os_count: "Automático: OS fechadas registradas",
  os_value: "Automático: faturamento das OS",
};

export const SOURCE_SHORT: Record<TeamSource, string> = {
  manual: "Manual (checklist)",
  calls: "Auto · Ligações CRM",
  calls_answered: "Auto · Atendidas CRM",
  won_count: "Auto · Vendas funil",
  won_value: "Auto · Faturamento funil",
  appointments: "Auto · Agendamentos",
  followups_sent: "Auto · Msgs agendadas",
  os_count: "Auto · OS fechadas",
  os_value: "Auto · Faturamento OS",
};

type KitMetric = Omit<TeamMetric, "id" | "active" | "position" | "result_of" | "weekly_target"> & { results?: string[] };

/** Modelos prontos de indicadores (todos editáveis depois). */
export const METRIC_KITS: { id: string; title: string; text: string; metrics: KitMetric[] }[] = [
  {
    id: "sdr_closer",
    title: "SDR + Closer (serviços / assistência)",
    text: "Ligações, resgates e prospecções com conversão; closer com avaliações, indicações, OS e faturamento.",
    metrics: [
      { name: "Ligações", unit: "count", source: "manual", role: "sdr", daily_target: 20, monthly_target: null, results: ["Contatos efetivos"] },
      { name: "Resgates da base", unit: "count", source: "manual", role: "sdr", daily_target: 20, monthly_target: null, results: ["Clientes recuperados"] },
      { name: "Prospecções", unit: "count", source: "manual", role: "sdr", daily_target: 10, monthly_target: null, results: ["Oportunidades geradas"] },
      { name: "Pedidos de avaliação", unit: "count", source: "manual", role: "closer", daily_target: 3, monthly_target: null },
      { name: "Pedidos de indicação", unit: "count", source: "manual", role: "closer", daily_target: 3, monthly_target: null },
      { name: "OS fechadas", unit: "count", source: "os_count", role: "closer", daily_target: 4, monthly_target: null },
      { name: "Faturamento", unit: "money", source: "os_value", role: "closer", daily_target: null, monthly_target: null },
    ],
  },
  {
    id: "vendedoras",
    title: "Vendedoras (loja / redes sociais)",
    text: "Contatos no WhatsApp e Instagram, vídeos, vendas e faturamento.",
    metrics: [
      { name: "Contatos no WhatsApp", unit: "count", source: "manual", role: "todos", daily_target: 30, monthly_target: null },
      { name: "Contatos no Instagram", unit: "count", source: "manual", role: "todos", daily_target: 10, monthly_target: null },
      { name: "Vídeos no Instagram", unit: "count", source: "manual", role: "todos", daily_target: 5, monthly_target: null },
      { name: "Vídeos no TikTok", unit: "count", source: "manual", role: "todos", daily_target: 5, monthly_target: null },
      { name: "Vendas", unit: "count", source: "os_count", role: "todos", daily_target: 1, monthly_target: null },
      { name: "Faturamento", unit: "money", source: "os_value", role: "todos", daily_target: null, monthly_target: null },
    ],
  },
];

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** A meta vale para essa pessoa? (sem função = vale tudo). */
export function metricApplies(m: TeamMetric, s: TeamSeller | null | undefined): boolean {
  return m.role === "todos" || !s?.role || s.role === m.role;
}

/** Meta da pessoa: individual, senão a padrão. Semana/mês derivam da diária. */
export function goalFor(goals: TeamSellerGoal[], m: TeamMetric, sellerId: string): { daily: number | null; weekly: number | null; monthly: number | null } {
  const g = goals.find((x) => x.seller_id === sellerId && x.metric_id === m.id);
  const daily = num(g?.daily_target) ?? num(m.daily_target);
  const weekly = num(g?.weekly_target) ?? num(m.weekly_target) ?? (daily ? daily * WORKDAYS_WEEK : null);
  const monthly = num(g?.monthly_target) ?? num(m.monthly_target) ?? (daily ? daily * WORKDAYS_MONTH : null);
  return { daily, weekly, monthly };
}

/** Atividades que a pessoa preenche com + e − (sem os resultados, que ficam embaixo de cada uma). */
export function stepperMetrics(metrics: TeamMetric[], s: TeamSeller): TeamMetric[] {
  return metrics.filter((m) => m.active && m.source === "manual" && !m.result_of && metricApplies(m, s));
}
export function resultsOf(metrics: TeamMetric[], parentId: string): TeamMetric[] {
  return metrics.filter((m) => m.active && m.result_of === parentId);
}

/** O que precisa ser batido no dia (atividades + automáticos de quantidade com meta diária). */
export function dayGoalItems(metrics: TeamMetric[], goals: TeamSellerGoal[], s: TeamSeller): { m: TeamMetric; goal: number }[] {
  return metrics
    .filter((m) => m.active && !m.result_of && m.unit === "count" && metricApplies(m, s))
    .map((m) => ({ m, goal: goalFor(goals, m, s.id).daily ?? 0 }))
    .filter((x) => x.goal > 0);
}

/** % do dia (média de cada meta, limitada a 100%). */
export function dayProgress(items: { m: TeamMetric; goal: number }[], get: (metricId: string) => number): number {
  if (!items.length) return 0;
  const sum = items.reduce((a, it) => a + Math.min(1, get(it.m.id) / it.goal), 0);
  return Math.round((100 * sum) / items.length);
}

/** Nota do período (0–100): média do atingimento das metas mensais + faturamento da loja (closer). */
export function periodScore(
  metrics: TeamMetric[], goals: TeamSellerGoal[], s: TeamSeller, get: (metricId: string) => number, storeRevenueGoal: number | null,
): number {
  const parts: number[] = [];
  for (const m of metrics) {
    if (!m.active || m.result_of || m.unit === "money" || !metricApplies(m, s)) continue;
    const g = goalFor(goals, m, s.id).monthly;
    if (g) parts.push(Math.min(1, get(m.id) / g));
  }
  const fat = metrics.find((m) => m.active && m.source === "os_value" && metricApplies(m, s));
  if (s.role === "closer" && fat && storeRevenueGoal) parts.push(Math.min(1, get(fat.id) / storeRevenueGoal));
  return parts.length ? Math.round((100 * parts.reduce((a, b) => a + b, 0)) / parts.length) : 0;
}

/** Soma por vendedor+indicador (opcionalmente num intervalo de dias). */
export function totals(values: TeamValue[], from?: string, to?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) {
    if (from && v.day < from) continue;
    if (to && v.day > to) continue;
    const k = `${v.seller_id}:${v.metric_id}`;
    out.set(k, (out.get(k) ?? 0) + Number(v.value));
  }
  return out;
}

/** Dias (distintos) em que a pessoa preencheu algo à mão. */
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
export const conv = (result: number, done: number) => (done > 0 ? Math.round((result / done) * 1000) / 10 : null);

/** Variação entre dois períodos (null quando não há base). */
export function delta(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
export function fmtValue(v: number, unit: "count" | "money"): string {
  return unit === "money" ? fmtBRL(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}
/** "1.500,50" / "1500.5" / "R$ 1.500" → 1500.5 */
export function parseBRL(raw: string): number | null {
  let t = raw.replace(/R\$/g, "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // "110.000" = cento e dez mil
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

// ----------------------------------------------------------------------------- datas

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** Segunda-feira da semana do dia. */
export function weekStart(day: string): string {
  return addDays(day, -((dow(day) + 6) % 7));
}
/** Dias úteis (seg–sex) de `from` até `to`, inclusive. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const w = dow(d); if (w !== 0 && w !== 6) n++; }
  return n;
}
export const fmtDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const fmtDayFull = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** "2026-10" → primeiro e último dia. */
export function monthDays(period: string): { first: string; last: string; days: number } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(days).padStart(2, "0")}`, days };
}

// ----------------------------------------------------------------------------- períodos

/**
 * Período de acompanhamento: ciclos de 30 dias a partir do início da
 * consultoria (Ciclo 1, 2, 3…) ou, sem data de início, meses do calendário.
 */
export interface Period { key: string; label: string; short: string; from: string; to: string; cycle: number | null }

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function periodAt(day: string, cycleStart: string | null, shift = 0): Period {
  if (cycleStart) {
    const diff = Math.floor((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${cycleStart}T12:00:00Z`)) / 86_400_000);
    const idx = Math.max(0, Math.floor(diff / 30)) + shift;
    const from = addDays(cycleStart, 30 * idx);
    const to = addDays(from, 29);
    if (idx < 0) return { key: `c${idx}`, cycle: idx + 1, from, to, short: "Antes do início", label: `Antes do início · ${fmtDay(from)} a ${fmtDay(to)}` };
    return { key: `c${idx}`, cycle: idx + 1, from, to, short: `Ciclo ${idx + 1}`, label: `Ciclo ${idx + 1} · ${fmtDay(from)} a ${fmtDay(to)}` };
  }
  const [y, m] = day.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + shift;
  const key = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  const { first, last } = monthDays(key);
  const name = MONTHS[t % 12] ?? "";
  return { key, cycle: null, from: first, to: last, short: name.charAt(0).toUpperCase() + name.slice(1, 3), label: `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${Math.floor(t / 12)}` };
}

/** Lista de períodos para escolher (do atual para trás). */
export function periodList(today: string, cycleStart: string | null, count = 12): Period[] {
  const cur = periodAt(today, cycleStart);
  const out: Period[] = [];
  for (let i = 0; i < count; i++) {
    const p = periodAt(today, cycleStart, -i);
    if (cycleStart && (p.cycle ?? 1) < 1) break;
    if (cycleStart && i > 0 && p.key === out[out.length - 1]?.key) break;
    out.push(p);
    if (cycleStart && p.cycle === 1) break;
  }
  return out.length ? out : [cur];
}

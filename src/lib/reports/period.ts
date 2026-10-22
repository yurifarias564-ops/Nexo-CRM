import { zonedToUtc } from "@/lib/time";

// Utilitários de período (YYYY-MM) — usados no servidor e na tela.

/** "2026-10" → limites do mês no fuso da empresa. */
export function monthRange(period: string, tz: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error("Período inválido");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  const from = zonedToUtc(`${period}-01T00:00`, tz);
  const to = zonedToUtc(`${next}-01T00:00`, tz);
  if (!from || !to) throw new Error("Período inválido");
  return { from, to };
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${y}`;
}

/** Período corrente (YYYY-MM) no fuso informado. */
export function currentPeriod(tz: string, at = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(at);
  return `${p.find((x) => x.type === "year")?.value}-${p.find((x) => x.type === "month")?.value}`;
}

/** Último dia do mês no fuso? (o relatório automático sai nesse dia) */
export function isLastDayOfMonth(tz: string, at = new Date()): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, day: "2-digit" }).format(at);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: tz, day: "2-digit" }).format(new Date(at.getTime() + 24 * 3600 * 1000));
  return Number(tomorrow) < Number(today);
}

export function hourIn(tz: string, at = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(at));
}

/** Soma n meses a um período (n pode ser negativo). */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

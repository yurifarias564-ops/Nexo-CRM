import { z } from "zod";

// Horário comercial da empresa (função pura: navegador e servidor).

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Horário inválido");
export const DayHours = z.object({ on: z.boolean(), start: hhmm, end: hhmm }).refine((d) => !d.on || d.start !== d.end, "Abre e fecha no mesmo horário");
export const BusinessHours = z.object({ time_zone: z.string().min(3).max(60), days: z.array(DayHours).length(7) });
export type BusinessHours = z.infer<typeof BusinessHours>;

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const DEFAULT_HOURS: BusinessHours = {
  time_zone: "America/Sao_Paulo",
  days: [
    { on: false, start: "08:00", end: "12:00" },
    ...Array.from({ length: 5 }, () => ({ on: true, start: "08:00", end: "18:00" })),
    { on: true, start: "08:00", end: "12:00" },
  ],
};

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Está dentro do horário? Aceita expediente que passa da meia-noite (ex.: 18:00 → 02:00). */
export function inHours(h: BusinessHours, d = new Date()): boolean {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: h.time_zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")?.value ?? "");
  const now = Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
  const today = h.days[wd], yest = h.days[(wd + 6) % 7];
  if (today?.on) {
    const s = mins(today.start), e = mins(today.end);
    if (s < e ? now >= s && now < e : now >= s) return true;
  }
  // Expediente de ontem que vira a noite
  if (yest?.on && mins(yest.end) <= mins(yest.start) && now < mins(yest.end)) return true;
  return false;
}

/** Quanto falta para abrir (0 = já está aberto). */
export function msUntilOpen(h: BusinessHours, from = new Date()): number {
  if (inHours(h, from)) return 0;
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 5) * 5);
  for (let i = 0; i < 12 * 24 * 8; i++) {
    if (inHours(h, t)) return t.getTime() - from.getTime();
    t.setTime(t.getTime() + 5 * 60_000);
  }
  return 0;
}

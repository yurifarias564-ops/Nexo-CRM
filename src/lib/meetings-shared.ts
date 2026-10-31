import { z } from "zod";
import { zonedToUtc } from "@/lib/time";

// Reunião agendada: mensagem com o link e lembretes (funções puras, usadas no navegador e no servidor).

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");
const text = z.string().trim().min(1, "Escreva a mensagem").max(1000);
export const Reminder = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("day_before_at"), time: hhmm, text }),
  z.object({ kind: z.literal("day_at"), time: hhmm, text }),
  z.object({ kind: z.literal("before"), minutes: z.number().int().min(5).max(24 * 60), text }),
]);
export type Reminder = z.infer<typeof Reminder>;

export const MeetingSettings = z.object({
  send_link: z.boolean(),
  link_message: z.string().trim().min(1).max(2000),
  reminders_enabled: z.boolean(),
  reminders: z.array(Reminder).max(8),
});
export type MeetingSettings = z.infer<typeof MeetingSettings>;

export const DEFAULT_MEETING: MeetingSettings = {
  send_link: true,
  link_message: "Oi, {{primeiro_nome}}! Nossa reunião ficou marcada para {{data}} às {{hora}}. ✅\nPara entrar é só tocar no link (não precisa instalar nada):\n{{link}}",
  reminders_enabled: true,
  reminders: [
    { kind: "day_at", time: "06:00", text: "Bom dia, {{primeiro_nome}}! Passando para lembrar da nossa reunião hoje às {{hora}}. 😊" },
    { kind: "day_at", time: "12:00", text: "{{primeiro_nome}}, tudo certo para hoje às {{hora}}? Te espero lá!" },
    { kind: "before", minutes: 30, text: "{{primeiro_nome}}, daqui a 30 minutos {{vendedor}} estará online te esperando. É só tocar no link: {{link}}" },
  ],
};

const localDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Quando cada lembrete sai. Lembrete que já passou (ou cairia depois da reunião) não é enviado. */
export function reminderTimes(rules: Reminder[], start: Date, tz: string, now = new Date()): { at: Date; rule: Reminder }[] {
  const day = localDay(start, tz);
  const out: { at: Date; rule: Reminder }[] = [];
  for (const r of rules) {
    const at = r.kind === "before" ? new Date(start.getTime() - r.minutes * 60_000)
      : zonedToUtc(`${r.kind === "day_at" ? day : addDay(day, -1)}T${r.time}`, tz);
    if (!at || at.getTime() <= now.getTime() + 60_000 || at.getTime() >= start.getTime()) continue;
    out.push({ at, rule: r });
  }
  // Dois lembretes quase juntos (ex.: marcou às 11h50 para 12h30): manda só o mais perto da reunião
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).filter((x, i, arr) => !arr[i + 1] || arr[i + 1]!.at.getTime() - x.at.getTime() >= 10 * 60_000);
}

export interface MeetingVars { name: string; start: Date; tz: string; link: string | null; seller: string | null; org: string }

export function renderMeeting(t: string, v: MeetingVars): string {
  const first = v.name.trim().split(/\s+/)[0] ?? "";
  const map: Record<string, string> = {
    primeiro_nome: /^\+?\d+$/.test(first) ? "" : first, nome: v.name,
    data: new Intl.DateTimeFormat("pt-BR", { timeZone: v.tz, weekday: "long", day: "2-digit", month: "2-digit" }).format(v.start),
    hora: new Intl.DateTimeFormat("pt-BR", { timeZone: v.tz, hour: "2-digit", minute: "2-digit" }).format(v.start).replace(":00", "h").replace(":", "h"),
    link: v.link ?? "", vendedor: v.seller || "nosso consultor", empresa: v.org,
  };
  return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in map ? map[k]! : m))
    .replace(/ {2,}/g, " ").replace(/ ([,.!?])/g, "$1").replace(/,([!?.])/g, "$1").replace(/:\s*$/gm, (s) => s).trim();
}

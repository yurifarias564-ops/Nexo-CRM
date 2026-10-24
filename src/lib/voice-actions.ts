import { z } from "zod";
import { formatWhen } from "@/lib/time";
import { callOutcomeLabel } from "@/lib/constants";

const Lead = { leadId: z.string().uuid().nullable(), leadName: z.string(), leadCandidates: z.array(z.object({ id: z.string().uuid(), name: z.string(), phone: z.string().nullable() })) };

/** Ações já resolvidas (ids reais) que o usuário confirma antes de executar. */
export const ResolvedAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move_lead"), ...Lead, stageId: z.string().uuid(), stageName: z.string() }),
  z.object({ kind: z.literal("add_tags"), ...Lead, tags: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string().min(1).max(40) })).min(1) }),
  z.object({ kind: z.literal("remove_tags"), ...Lead, tags: z.array(z.object({ id: z.string().uuid(), name: z.string() })).min(1) }),
  z.object({ kind: z.literal("create_lead"), name: z.string().min(1).max(160), phone: z.string().nullable(), stageId: z.string().uuid(), stageName: z.string(), value: z.number().nonnegative().nullable(), tags: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string().min(1).max(40) })) }),
  z.object({ kind: z.literal("set_value"), ...Lead, value: z.number().nonnegative().max(1e12) }),
  z.object({ kind: z.literal("assign_lead"), ...Lead, userId: z.string().uuid(), userName: z.string() }),
  z.object({ kind: z.literal("add_note"), ...Lead, note: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal("log_call"), ...Lead,
    outcome: z.enum(["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_errado"]),
    durationMin: z.number().min(0).max(600).nullable(), notes: z.string().max(2000).nullable(),
  }),
  z.object({
    kind: z.literal("update_lead"), ...Lead,
    patch: z.object({ name: z.string().min(1).max(160).optional(), phone: z.string().regex(/^[0-9]{8,15}$/).optional(), email: z.string().email().max(254).optional() })
      .refine((p) => Object.keys(p).length > 0, "Nada para alterar"),
  }),
  z.object({ kind: z.literal("send_message"), ...Lead, text: z.string().trim().min(1).max(4096) }),
  z.object({
    kind: z.literal("schedule_message"), ...Lead,
    sendAt: z.string().datetime(), timeZone: z.string().min(1).max(64), text: z.string().trim().min(1).max(4096),
    provider: z.enum(["meta", "evolution", "zapi"]).nullable(),
  }),
  z.object({
    kind: z.literal("schedule_meeting"), ...Lead,
    start: z.string().datetime(), end: z.string().datetime(), timeZone: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(200), moveToStage: z.string().nullable(), google: z.boolean(),
  }),
]);
export type ResolvedAction = z.infer<typeof ResolvedAction>;

export function describe(a: ResolvedAction): string {
  switch (a.kind) {
    case "move_lead": return `Mover ${a.leadName} para "${a.stageName}"`;
    case "add_tags": return `Adicionar ${a.tags.map((t) => `#${t.name}`).join(", ")} em ${a.leadName}${a.tags.some((t) => !t.id) ? " (tag nova será criada)" : ""}`;
    case "remove_tags": return `Remover ${a.tags.map((t) => `#${t.name}`).join(", ")} de ${a.leadName}`;
    case "create_lead": return `Criar lead "${a.name}" em "${a.stageName}"${a.phone ? ` · ${a.phone}` : ""}${a.value ? ` · ${a.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}${a.tags.length ? ` · tag${a.tags.length > 1 ? "s" : ""} ${a.tags.map((t) => t.name).join(", ")}` : ""}`;
    case "set_value": return `Valor de ${a.leadName}: ${a.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
    case "assign_lead": return `Responsável por ${a.leadName}: ${a.userName}`;
    case "add_note": return `Anotação em ${a.leadName}: "${a.note}"`;
    case "log_call": return `Registrar ligação para ${a.leadName}: ${callOutcomeLabel(a.outcome)}${a.durationMin ? ` · ${a.durationMin} min` : ""}${a.notes ? ` — "${a.notes}"` : ""}`;
    case "update_lead": {
      const parts = [
        a.patch.name && `nome → ${a.patch.name}`,
        a.patch.phone && `telefone → +${a.patch.phone}`,
        a.patch.email && `e-mail → ${a.patch.email}`,
      ].filter(Boolean);
      return `Atualizar ${a.leadName}: ${parts.join(", ")}`;
    }
    case "send_message": return `Enviar WhatsApp para ${a.leadName}: "${a.text}"`;
    case "schedule_message":
      return `Enviar WhatsApp para ${a.leadName} em ${formatWhen(a.sendAt, a.timeZone)}: "${a.text}"`;
    case "schedule_meeting": {
      const mins = Math.round((new Date(a.end).getTime() - new Date(a.start).getTime()) / 60000);
      return `Agendar "${a.title}" — ${formatWhen(a.start, a.timeZone)} (${mins} min)${a.moveToStage ? ` e mover ${a.leadName} para "${a.moveToStage}"` : ""}${a.google ? " · Google Agenda" : " · só no CRM (Google Agenda não conectado)"}`;
    }
  }
}

import { z } from "zod";

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
]);
export type ResolvedAction = z.infer<typeof ResolvedAction>;

export function describe(a: ResolvedAction): string {
  switch (a.kind) {
    case "move_lead": return `Mover ${a.leadName} para "${a.stageName}"`;
    case "add_tags": return `Adicionar ${a.tags.map((t) => `#${t.name}`).join(", ")} em ${a.leadName}${a.tags.some((t) => !t.id) ? " (tag nova será criada)" : ""}`;
    case "remove_tags": return `Remover ${a.tags.map((t) => `#${t.name}`).join(", ")} de ${a.leadName}`;
    case "create_lead": return `Criar lead "${a.name}" em "${a.stageName}"${a.phone ? ` · ${a.phone}` : ""}`;
    case "set_value": return `Valor de ${a.leadName}: ${a.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
    case "assign_lead": return `Responsável por ${a.leadName}: ${a.userName}`;
    case "add_note": return `Anotação em ${a.leadName}: "${a.note}"`;
  }
}

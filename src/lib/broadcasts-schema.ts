import { z } from "zod";
import { IDLE_MAX } from "./broadcasts";

export const AudienceSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(50).default([]),
  stageIds: z.array(z.string().uuid()).max(50).default([]),
  idle: z.object({ amount: z.number().int().min(1), unit: z.enum(["day", "week", "month"]) })
    .refine((i) => i.amount <= IDLE_MAX[i.unit], "Tempo sem interação longo demais").nullable().default(null),
  leadIds: z.array(z.string().uuid()).max(5000).default([]),
  excludeLeadIds: z.array(z.string().uuid()).max(5000).default([]),
});

export const TemplateParamSchema = z.union([
  z.object({ kind: z.enum(["name", "first_name"]) }),
  z.object({ kind: z.literal("text"), value: z.string().trim().min(1, "Preencha os campos do modelo").max(1024) }),
]);

export const TemplateChoiceSchema = z.object({
  name: z.string().min(1).max(512),
  language: z.string().min(2).max(15),
  params: z.array(TemplateParamSchema).max(20).default([]),
});

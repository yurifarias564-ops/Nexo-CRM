import { z } from "zod";

const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => (v ? v : null));

/** Dados de um link rastreado (criar/editar). */
export const LinkBody = z.object({
  name: z.string().trim().min(1, "Dê um nome ao link").max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "Use de 3 a 40 letras minúsculas, números ou hífen").optional(),
  kind: z.enum(["link", "site"]).default("link"),
  channel_id: z.string().uuid().nullable().optional(),
  phone: z.string().trim().transform((v) => v.replace(/\D/g, "")).refine((v) => !v || /^\d{10,15}$/.test(v), "Número inválido (DDI + DDD + número)").nullable().optional(),
  message: opt(1000),
  utm_source: opt(200), utm_medium: opt(200), utm_campaign: opt(200), utm_content: opt(200), utm_term: opt(200),
});


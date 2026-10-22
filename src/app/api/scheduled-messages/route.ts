import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createScheduled } from "@/lib/scheduled";
import { DEFAULT_TZ, isValidTimeZone, zonedToUtc } from "@/lib/time";

export const runtime = "nodejs";

const Body = z
  .object({
    leadId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    sendAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida"),
    timeZone: z.string().optional(),
    body: z.string().trim().max(4096, "Mensagem muito longa").optional(),
    template: z.object({ name: z.string().min(1).max(512), language: z.string().min(2).max(15), params: z.array(z.string().max(1024)).max(20).default([]) }).optional(),
  })
  .refine((b) => b.leadId || b.conversationId, "Informe o lead ou a conversa")
  .refine((b) => (b.body && b.body.length > 0) || b.template, "Escreva a mensagem ou escolha um modelo");

/** Agenda uma mensagem de WhatsApp para dia e hora escolhidos. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`sched:${ctx.userId}`, 60, 60);
    const b = Body.parse(await readJson(req, 32_000));
    const tz = isValidTimeZone(b.timeZone) ? b.timeZone : DEFAULT_TZ;
    const sendAt = zonedToUtc(b.sendAt, tz);
    if (!sendAt) throw new HttpError(422, "Data/hora inválida");
    const r = await createScheduled(await supabaseServer(), { orgId: ctx.org.id, userId: ctx.userId }, {
      target: { leadId: b.leadId, conversationId: b.conversationId }, sendAt, timeZone: tz,
      body: b.template ? null : b.body, template: b.template ?? null,
    });
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

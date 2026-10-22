import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { sendTemplateMessage } from "@/lib/send";

export const runtime = "nodejs";

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(15),
    params: z.array(z.string().max(1024)).max(20).default([]),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Envia um modelo aprovado pela Meta (reabre a janela de 24h). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`tpl:${ctx.userId}`, 30, 60);
    const { name, language, params, ...target } = Body.parse(await readJson(req, 64_000));
    const r = await sendTemplateMessage(await supabaseServer(), ctx.org.id, ctx.userId, target, name, language, params);
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

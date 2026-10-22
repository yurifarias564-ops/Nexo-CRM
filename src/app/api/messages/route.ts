import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { sendText } from "@/lib/send";

export const runtime = "nodejs";

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    text: z.string().trim().min(1, "Digite uma mensagem").max(4096, "Mensagem muito longa"),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Envia texto pelo WhatsApp e registra no histórico. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`send:${ctx.userId}`, 60, 60, "Muitas mensagens em sequência. Aguarde alguns segundos.");
    const { text, ...target } = Body.parse(await readJson(req, 64_000));
    const r = await sendText(await supabaseServer(), ctx.org.id, ctx.userId, target, text);
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

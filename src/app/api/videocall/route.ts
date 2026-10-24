import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createMeetNow } from "@/lib/google";
import { sendText } from "@/lib/send";

export const runtime = "nodejs";

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    name: z.string().trim().max(120).optional(),
    tz: z.string().max(60).optional(),
    send: z.boolean().default(true),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/**
 * Chamada de vídeo com o cliente. O WhatsApp não libera chamada de vídeo pela API,
 * então criamos uma sala (Google Meet da agenda do vendedor; sem Google, Jitsi)
 * e mandamos o link para o cliente no WhatsApp — ele toca e entra pelo celular.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`videocall:${ctx.userId}`, 20, 3600, "Muitas chamadas de vídeo nesta hora. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 4_000));
    const first = (b.name ?? "").split(" ")[0] || "";
    let link: string | null = null;
    let provider: "meet" | "jitsi" = "meet";
    try {
      link = await createMeetNow(ctx.userId, `Chamada de vídeo${b.name ? ` com ${b.name}` : ""}`, b.tz || "America/Sao_Paulo");
    } catch { link = null; }
    if (!link) {
      provider = "jitsi";
      link = `https://meet.jit.si/Nexo-${randomBytes(9).toString("base64url")}`;
    }
    let messageId: string | null = null;
    if (b.send) {
      const text = `${first ? `${first}, ` : ""}vamos fazer uma chamada de vídeo? 📹\nÉ só tocar no link para entrar pelo celular (não precisa instalar nada):\n${link}`;
      const r = await sendText(await supabaseServer(), ctx.org.id, ctx.userId, { conversationId: b.conversationId, leadId: b.leadId }, text);
      messageId = r.id;
    }
    return ok({ link, provider, messageId }, 201);
  } catch (e) {
    return fail(e);
  }
}

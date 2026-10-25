import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { askAssistant } from "@/lib/assistant";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40),
  tz: z.string().max(64).optional(),
});

/** Assistente do CRM (Claude): responde sobre os dados e prepara ações para confirmar. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`assistant:${ctx.userId}`, 15, 60, "Muitas perguntas seguidas. Aguarde um minuto.");
    await rateLimit(`assistant-org:${ctx.org.id}`, 400, 3600, "Limite de perguntas da empresa por hora atingido.");
    const b = Body.parse(await readJson(req, 200_000));
    const tz = isValidTimeZone(b.tz) ? b.tz : DEFAULT_TZ;
    const userName = ctx.fullName || ctx.email || "você";
    return ok(await askAssistant({ org: ctx.org, role: ctx.role, userId: ctx.userId, userName }, b.messages, tz));
  } catch (e) {
    return fail(e);
  }
}

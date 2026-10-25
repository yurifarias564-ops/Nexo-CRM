import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { isValidTimeZone } from "@/lib/time";
import { testAgent } from "@/lib/ai/agent";
import { AiError } from "@/lib/ai/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  agent: z.object({
    name: z.string().trim().min(1).max(40),
    prompt: z.string().max(30000),
    provider: z.enum(["claude", "gemini", "groq"]),
    model: z.string().trim().max(80).nullable(),
    auto_tags: z.boolean(),
    tone: z.enum(["executivo", "consultivo", "proximo"]).default("executivo"),
    time_zone: z.string().max(64).refine(isValidTimeZone),
  }),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(60),
  lead: z.object({
    name: z.string().trim().min(1).max(80),
    tags: z.array(z.string().max(40)).max(50),
    memory: z.array(z.string().max(500)).max(150),
    summary: z.string().max(4000).nullable(),
    stage: z.string().max(80).nullable(),
    value: z.number().min(0).max(1e10),
  }),
});

/** Simulador: a mesma IA e o mesmo prompt, sem enviar nada nem mudar o CRM. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`ai-test:${ctx.userId}`, 30, 60, "Muitos testes seguidos. Aguarde um minuto.");
    const b = Body.parse(await readJson(req, 400_000));
    try {
      return ok(await testAgent(ctx.org.id, b));
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(502, e.message);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}

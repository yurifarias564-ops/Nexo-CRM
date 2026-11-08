import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { channelFor, costFor, findTemplate, resolveAudience } from "@/lib/broadcasts-server";
import { AudienceSchema, TemplateChoiceSchema } from "@/lib/broadcasts-schema";
import { MAX_RECIPIENTS, type TemplateCategory } from "@/lib/broadcasts";

export const runtime = "nodejs";

const Body = z.object({ channelId: z.string().uuid(), audience: AudienceSchema, template: TemplateChoiceSchema.nullable().default(null) });

/** Quantas pessoas recebem, quem são (amostra) e, na API oficial, quanto custa. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`bcast-prev:${ctx.userId}`, 120, 60);
    const b = Body.parse(await readJson(req, 200_000));
    const ch = await channelFor(ctx.org.id, b.channelId);
    const people = await resolveAudience(ctx.org.id, b.audience);
    let cost = null;
    let category: TemplateCategory | null = null;
    if (ch.provider === "meta" && b.template) {
      const tpl = await findTemplate(ch, b.template.name, b.template.language);
      category = tpl && ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(tpl.category) ? (tpl.category as TemplateCategory) : null;
      if (category) cost = await costFor(ch, people.slice(0, MAX_RECIPIENTS).map((p) => p.phone), category);
    }
    return ok({
      provider: ch.provider, count: Math.min(people.length, MAX_RECIPIENTS), overLimit: people.length > MAX_RECIPIENTS,
      sample: people.slice(0, 12).map((p) => ({ id: p.lead_id, name: p.name, phone: p.phone })), cost, category,
    });
  } catch (e) {
    return fail(e);
  }
}

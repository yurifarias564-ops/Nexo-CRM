import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { olxReply } from "@/lib/portals";

export const runtime = "nodejs";

const Body = z.object({ leadId: z.string().uuid(), text: z.string().trim().min(1).max(2000) });

/** Responde o chat da OLX do lead pelo CRM. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`olx-reply:${ctx.userId}`, 120, 3600);
    const b = Body.parse(await readJson(req, 6_000));
    const sb = await supabaseServer();
    const { data: lead } = await sb.from("leads").select("id").eq("id", b.leadId).maybeSingle(); // RLS: só lead que a pessoa vê
    if (!lead) throw new HttpError(404, "Lead não encontrado");
    await olxReply(ctx.org.id, b.leadId, b.text);
    await sb.from("activities").insert({ organization_id: ctx.org.id, lead_id: b.leadId, actor_id: ctx.userId, type: "note", payload: { text: `↪️ Respondido pela OLX: “${b.text}”`, via: "olx" } });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

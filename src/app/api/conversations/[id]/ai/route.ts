import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({ state: z.enum(["auto", "paused", "off"]) });

/** Liga, pausa ou desliga a IA numa conversa (quem vê a conversa pode). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext();
    const b = Body.parse(await readJson(req, 1000));
    const sb = await supabaseServer();
    const { data: conv } = await sb.from("conversations").select("id, organization_id").eq("id", id).maybeSingle();
    if (!conv || conv.organization_id !== ctx.org.id) throw new HttpError(404, "Conversa não encontrada");
    await supabaseAdmin().from("conversations").update({ ai_state: b.state, ai_paused_until: null }).eq("id", id);
    return ok({ state: b.state });
  } catch (e) {
    return fail(e);
  }
}

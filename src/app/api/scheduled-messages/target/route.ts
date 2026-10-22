import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/http";
import { previewTarget } from "@/lib/send";

export const runtime = "nodejs";

/** Por qual canal sairá a mensagem (para avisar sobre a janela de 24h da Meta). */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    const u = new URL(req.url);
    const leadId = u.searchParams.get("leadId") ?? undefined;
    const conversationId = u.searchParams.get("conversationId") ?? undefined;
    const r = await previewTarget(await supabaseServer(), ctx.org.id, { leadId, conversationId });
    return ok({ target: r });
  } catch (e) {
    return fail(e);
  }
}

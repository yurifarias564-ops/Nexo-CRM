import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({
  provider: z.enum(["claude", "gemini", "groq"]),
  // null = apagar a chave própria (volta a usar a da plataforma, se houver)
  apiKey: z.string().trim().min(20, "Chave muito curta").max(300).regex(/^[\w.\-:]+$/, "A chave tem caracteres inválidos").nullable(),
});

/** Chave própria da empresa para a IA. Fica só no servidor; nunca volta para o navegador. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 4000));
    const db = supabaseAdmin();
    if (b.apiKey === null) {
      await db.from("ai_agent_secrets").delete().eq("organization_id", ctx.org.id).eq("provider", b.provider);
    } else {
      const { error } = await db.from("ai_agent_secrets").upsert({ organization_id: ctx.org.id, provider: b.provider, api_key: b.apiKey, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

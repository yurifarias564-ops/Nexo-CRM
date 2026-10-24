import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as a4 from "@/lib/voip/api4com";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().trim().min(8, "Cole o token da Api4Com").max(500),
  domain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.api4com\.com$/, "Domínio inválido (ex.: suaempresa.api4com.com)").nullable().optional(),
});

/** Conecta a empresa à central Api4Com: valida o token e cadastra o webhook com a gravação. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`voip-setup:${ctx.org.id}`, 10, 3600, "Muitas tentativas. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 4_000));
    const db = supabaseAdmin();
    const { data: cur } = await db.from("voip_settings").select("gateway, domain").eq("organization_id", ctx.org.id).maybeSingle();
    const { data: curSec } = await db.from("voip_secrets").select("webhook_key").eq("organization_id", ctx.org.id).maybeSingle();
    const gateway = cur?.gateway ?? `nexo-${ctx.org.id.replace(/-/g, "").slice(0, 16)}`;
    const hookKey = curSec?.webhook_key ?? randomBytes(32).toString("hex");
    const hook = `${appUrl()}/api/webhooks/api4com?g=${gateway}&k=${hookKey}`;
    await a4.registerWebhook(b.token, gateway, hook);

    const domain = b.domain ?? cur?.domain ?? null;
    const s = await db.from("voip_settings").upsert({ organization_id: ctx.org.id, provider: "api4com", gateway, domain, updated_at: new Date().toISOString() });
    if (s.error) throw s.error;
    const sec = await db.from("voip_secrets").upsert({ organization_id: ctx.org.id, api_token: b.token, webhook_key: hookKey });
    if (sec.error) throw sec.error;
    return ok({ connected: true, domain });
  } catch (e) {
    return fail(e);
  }
}

/** Desconecta a central (ramais e histórico de ligações continuam guardados no CRM). */
export async function DELETE() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const db = supabaseAdmin();
    await db.from("voip_secrets").delete().eq("organization_id", ctx.org.id);
    const { error } = await db.from("voip_settings").delete().eq("organization_id", ctx.org.id);
    if (error) throw error;
    return ok({ connected: false });
  } catch (e) {
    return fail(e);
  }
}

import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

/** Credenciais SIP do próprio ramal, para o telefone embutido no navegador. */
export async function GET() {
  try {
    const ctx = await requireApiContext();
    const db = supabaseAdmin();
    const { data: s } = await db.from("voip_settings").select("domain").eq("organization_id", ctx.org.id).maybeSingle();
    if (!s) return ok({ enabled: false });
    const { data: ext } = await db.from("voip_extensions").select("id, ramal, domain").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).maybeSingle();
    if (!ext) return ok({ enabled: true, ramal: null });
    const domain = ext.domain ?? s.domain;
    if (!domain) return ok({ enabled: true, ramal: ext.ramal, ready: false, reason: "Falta o domínio SIP da empresa (ex.: suaempresa.api4com.com) em Configurações → Integrações." });
    const { data: sec } = await db.from("voip_extension_secrets").select("sip_password").eq("extension_id", ext.id).maybeSingle();
    const res = ok({ enabled: true, ready: Boolean(sec), ramal: ext.ramal, domain, sip: sec?.sip_password ?? null });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return fail(e);
  }
}

import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { creditCallbackUrl, creditCredential, loadCreditSettings } from "@/lib/credit";
import { CreditSettings } from "@/lib/credit/shared";

export const runtime = "nodejs";

/** Configuração da análise de crédito da empresa (a chave nunca volta inteira para o navegador). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const [settings, cred, callbackUrl] = await Promise.all([loadCreditSettings(ctx.org.id), creditCredential(ctx.org.id), creditCallbackUrl(ctx.org.id)]);
    return ok({ settings, hasCred: Boolean(cred), credHint: cred ? `…${cred.slice(-4)}` : null, callbackUrl });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({
  settings: CreditSettings,
  // undefined = mantém; null = apaga; texto = troca
  credential: z.string().trim().min(8, "Chave muito curta").max(500).regex(/^[\w.\-:=+/]+$/, "A chave tem caracteres inválidos").nullable().optional(),
});

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 10_000));
    const db = supabaseAdmin();
    if (b.credential === null) await db.from("credit_secrets").delete().eq("organization_id", ctx.org.id);
    else if (b.credential) {
      const { error } = await db.from("credit_secrets").upsert({ organization_id: ctx.org.id, credential: b.credential, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    const cred = await creditCredential(ctx.org.id);
    if (b.settings.enabled && b.settings.provider === "directd" && !cred) {
      throw new HttpError(422, "Cole o token da Direct Data para ligar a consulta");
    }
    const { error } = await db.from("credit_settings").upsert({ organization_id: ctx.org.id, ...b.settings, updated_by: ctx.userId, updated_at: new Date().toISOString() });
    if (error) throw error;
    return ok({ settings: await loadCreditSettings(ctx.org.id), hasCred: Boolean(cred), credHint: cred ? `…${cred.slice(-4)}` : null, callbackUrl: await creditCallbackUrl(ctx.org.id) });
  } catch (e) {
    return fail(e);
  }
}

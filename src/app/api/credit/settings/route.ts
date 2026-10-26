import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { creditCallbackUrl, creditCredentialInfo, ensureCreditSettings, loadCreditSettings, rotateCallback } from "@/lib/credit";
import { CreditSettings } from "@/lib/credit/shared";

export const runtime = "nodejs";

async function view(orgId: string) {
  const [settings, cred, callbackUrl] = await Promise.all([loadCreditSettings(orgId), creditCredentialInfo(orgId), creditCallbackUrl(orgId)]);
  // A chave só aparece como "salva" para a ferramenta em que foi cadastrada
  const has = Boolean(cred && cred.provider === settings.provider);
  return { settings, hasCred: has, credHint: has ? cred!.hint : null, callbackUrl };
}

/** Configuração da análise de crédito da empresa (a chave nunca volta inteira para o navegador). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    await ensureCreditSettings(ctx.org.id);
    return ok(await view(ctx.org.id));
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({
  settings: CreditSettings,
  // undefined = mantém; null = apaga; texto = troca (vale para a ferramenta escolhida)
  credential: z.string().trim().min(8, "Chave muito curta").max(500).regex(/^[\w.\-:=+/]+$/, "A chave tem caracteres inválidos").nullable().optional(),
  rotateCallback: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 10_000));
    const db = supabaseAdmin();
    const s = b.settings;
    if (b.credential === null) await db.from("credit_secrets").delete().eq("organization_id", ctx.org.id);
    else if (b.credential) {
      if (s.provider === "manual") throw new HttpError(422, "Escolha a ferramenta de crédito");
      const { error } = await db.from("credit_secrets").upsert({ organization_id: ctx.org.id, credential: b.credential, provider: s.provider, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    const { error } = await db.from("credit_settings").upsert({ organization_id: ctx.org.id, ...s, updated_by: ctx.userId, updated_at: new Date().toISOString() });
    if (error) throw error;
    if (b.rotateCallback) await rotateCallback(ctx.org.id);
    const v = await view(ctx.org.id);
    if (s.enabled && s.provider === "directd" && !v.hasCred) {
      await db.from("credit_settings").update({ enabled: false }).eq("organization_id", ctx.org.id);
      throw new HttpError(422, "Salvo, mas desligado: cole o token da Direct Data para ligar a consulta");
    }
    return ok(v);
  } catch (e) {
    return fail(e);
  }
}

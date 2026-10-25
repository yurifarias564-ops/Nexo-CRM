import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { loadCreditSettings, runCreditCheck } from "@/lib/credit";
import { CreditInput, CreditSettings } from "@/lib/credit/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  input: CreditInput,
  consent: z.literal(true, { message: "Confirme que o dono do CPF autorizou a consulta" }),
  // Testar com a configuração da tela (antes de salvar); a chave é sempre a salva
  settings: CreditSettings.optional(),
});

/** Teste real da consulta (ex.: com o seu próprio CPF). Conta no limite diário e pode ter custo na ferramenta. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`credit-test:${ctx.userId}`, 10, 300, "Muitos testes seguidos. Aguarde alguns minutos.");
    const b = Body.parse(await readJson(req, 10_000));
    const saved = await loadCreditSettings(ctx.org.id);
    const settings = { ...(b.settings ?? saved), enabled: true };
    if (!settings) throw new HttpError(409, "Configure a análise de crédito");
    const r = await runCreditCheck(ctx.org.id, b.input, { source: "teste", userId: ctx.userId, settings });
    return ok({ result: r });
  } catch (e) {
    return fail(e);
  }
}

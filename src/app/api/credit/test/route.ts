import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { loadCreditSettings, runCreditCheck, runPreAnalysis } from "@/lib/credit";
import { CreditInput } from "@/lib/credit/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  input: CreditInput,
  consent: z.literal(true, { message: "Confirme que o dono do CPF autorizou a consulta" }),
  negative: z.enum(["sim", "nao", "nao_sabe"]).default("nao"),
});

/**
 * Teste real da consulta (ex.: com o seu próprio CPF), sempre com a configuração SALVA
 * (endereço, chave e limites não vêm do navegador). Conta no limite diário e pode ter custo.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`credit-test:${ctx.userId}`, 10, 300, "Muitos testes seguidos. Aguarde alguns minutos.");
    const b = Body.parse(await readJson(req, 10_000));
    const settings = { ...(await loadCreditSettings(ctx.org.id)), enabled: true };
    if (settings.provider === "ia") {
      // Modo grátis: só a regra da loja (nenhuma consulta paga)
      const r = await runPreAnalysis(ctx.org.id, b.input, { negative: b.negative }, { source: "teste", userId: ctx.userId, settings });
      return ok({ result: { ...r, score: null, band: null, reused: false, banks: [], pending: false } });
    }
    const r = await runCreditCheck(ctx.org.id, b.input, { source: "teste", userId: ctx.userId, settings });
    return ok({ result: r });
  } catch (e) {
    return fail(e);
  }
}

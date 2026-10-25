import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { receiveBankCallback } from "@/lib/credit";

export const runtime = "nodejs";

/**
 * Retorno da plataforma de bancos (Zinix, Credere, n8n…): resultado de cada banco da ficha.
 * Corpo: { consulta_id, bancos: [{ banco, status, parcela, taxa, prazo, valor_liberado, mensagem }] }
 * ou um banco por chamada: { consulta_id, banco, status, ... }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`credit-cb:${token.slice(0, 12)}`, 120, 60);
    const body = (await readJson(req, 100_000)) as Record<string, unknown>;
    return ok(await receiveBankCallback(token, body));
  } catch (e) {
    return fail(e);
  }
}

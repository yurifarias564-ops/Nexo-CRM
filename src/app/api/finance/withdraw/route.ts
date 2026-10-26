import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { withdraw } from "@/lib/payments/asaas-store";
import { audit } from "@/lib/platform/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ value: z.number().positive().max(10_000_000).nullable() });

/** Saque do saldo para a chave Pix do banco da loja (só o dono). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    if (ctx.role !== "owner") throw new HttpError(403, "Só o dono da conta pode sacar");
    await rateLimit(`payout:${ctx.org.id}`, 6, 3600, "Muitos saques nesta hora. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 500));
    const r = await withdraw(ctx.org.id, ctx.userId, b.value);
    await audit(ctx.userId, ctx.org.id, "saque solicitado", { value: r.value });
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

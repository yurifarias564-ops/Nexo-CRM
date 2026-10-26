import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { refreshAccountStatus } from "@/lib/payments/asaas-store";

export const runtime = "nodejs";

/** Confere a situação do cadastro (documentos/aprovação). */
export async function POST() {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`pix-status:${ctx.org.id}`, 20, 3600);
    return ok(await refreshAccountStatus(ctx.org.id));
  } catch (e) {
    return fail(e);
  }
}

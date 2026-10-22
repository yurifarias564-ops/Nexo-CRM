import { requireApiContext } from "@/lib/auth";
import { disconnect } from "@/lib/google";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

/** Desconecta o Google Agenda do usuário e revoga o acesso no Google. */
export async function DELETE() {
  try {
    const ctx = await requireApiContext({ allowInactive: true });
    await disconnect(ctx.userId);
    return ok({ disconnected: true });
  } catch (e) {
    return fail(e);
  }
}

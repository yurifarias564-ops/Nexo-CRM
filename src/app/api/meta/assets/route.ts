import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { listAssets, loadConn } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Contas de anúncios, pixels e páginas que a conexão enxerga (para trocar a escolha). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { cred } = await loadConn(ctx.org.id);
    if (!cred) throw new HttpError(409, "Conecte o Facebook primeiro.");
    return ok(await listAssets(cred));
  } catch (e) {
    return fail(e);
  }
}

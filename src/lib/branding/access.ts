import "server-only";
import { requireApiContext } from "@/lib/auth";
import { HttpError } from "@/lib/http";

/**
 * Quem pode personalizar: dono/administrador da própria empresa, ou o dono da plataforma
 * (para qualquer cliente, pelo painel de Parceiros, com ?org=ID).
 */
export async function brandingTarget(req: Request, opts: { houseOnly?: boolean } = {}) {
  const ctx = await requireApiContext({ allowInactive: true });
  const param = new URL(req.url).searchParams.get("org");
  const orgId = param && /^[0-9a-f-]{36}$/i.test(param) ? param : ctx.org.id;
  if ((orgId !== ctx.org.id || opts.houseOnly) && !ctx.isHouse) throw new HttpError(403, "Apenas o dono da plataforma pode fazer isso");
  if (orgId === ctx.org.id && !ctx.isHouse && ctx.role === "agent") throw new HttpError(403, "Apenas administradores podem personalizar");
  return { ctx, orgId };
}

import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { disableShare, getShare, rotateShare } from "@/lib/team-server/share";
import { requireHouse } from "@/lib/platform/partners";

export const runtime = "nodejs";

/** Empresa alvo: a atual (gestor) ou qualquer uma (dono da plataforma, pela aba Parceiros). */
async function target(orgParam: string | null) {
  if (orgParam) {
    if (!z.string().uuid().safeParse(orgParam).success) throw new HttpError(422, "Empresa inválida");
    const ctx = await requireHouse();
    return { orgId: orgParam, userId: ctx.userId };
  }
  const ctx = await requireApiContext({ manage: true });
  return { orgId: ctx.org.id, userId: ctx.userId };
}

export async function GET(req: Request) {
  try {
    const t = await target(new URL(req.url).searchParams.get("org"));
    return ok({ share: await getShare(t.orgId) });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ org: z.string().uuid().nullable().optional() });

/** Cria o link (ou gera um novo — o antigo para de funcionar). */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await readJson(req, 500).catch(() => ({})));
    const t = await target(b.org ?? null);
    return ok({ share: await rotateShare(t.orgId, t.userId) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const t = await target(new URL(req.url).searchParams.get("org"));
    await disableShare(t.orgId);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

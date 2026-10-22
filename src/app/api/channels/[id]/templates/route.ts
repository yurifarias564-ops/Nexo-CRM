import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import { listTemplates } from "@/lib/whatsapp/meta";

export const runtime = "nodejs";

/** Lista os modelos aprovados do número oficial. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext();
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    if (ch.provider !== "meta" || !ch.meta_waba_id || !ch.secrets.meta_access_token) return ok({ templates: [] });
    return ok({ templates: await listTemplates(ch.meta_waba_id, ch.secrets.meta_access_token) });
  } catch (e) {
    return fail(e);
  }
}

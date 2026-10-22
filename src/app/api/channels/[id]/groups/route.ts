import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import { fetchGroups } from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

/** Grupos do WhatsApp (somente números conectados por QR Code). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    if (ch.provider !== "evolution" || !ch.evolution_instance) return ok({ groups: [], unsupported: true });
    if (ch.status !== "connected") throw new HttpError(409, "Conecte o número para listar os grupos");
    return ok({ groups: await fetchGroups(ch.evolution_instance) });
  } catch (e) {
    return fail(e);
  }
}

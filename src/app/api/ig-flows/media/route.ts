import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import { listRecentMedia } from "@/lib/instagram";
import { igChannel } from "@/lib/ig-flows-save";

export const runtime = "nodejs";

/** Publicações recentes da conta, para escolher qual dispara o fluxo. */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const id = new URL(req.url).searchParams.get("channelId") ?? "";
    const c = await igChannel(ctx.org.id, id);
    if (c.status !== "connected") throw new HttpError(409, "A conta do Instagram está desconectada");
    const ch = await loadChannel(c.id);
    return ok({ media: await listRecentMedia(ch.secrets.meta_access_token ?? "", 12) });
  } catch (e) {
    return fail(e);
  }
}

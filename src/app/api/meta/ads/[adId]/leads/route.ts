import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { adLeads } from "@/lib/meta-ads/report";

export const runtime = "nodejs";

/** Leads que vieram deste anúncio. */
export async function GET(_req: Request, { params }: { params: Promise<{ adId: string }> }) {
  try {
    const { adId } = await params;
    if (!/^\d{3,30}$/.test(adId)) throw new HttpError(404, "Anúncio não encontrado");
    const ctx = await requireApiContext({ manage: true });
    return ok({ leads: await adLeads(ctx.org.id, adId) });
  } catch (e) {
    return fail(e);
  }
}

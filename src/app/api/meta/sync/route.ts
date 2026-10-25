import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { syncAds } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Atualiza agora os anúncios e números do Meta (?days=30). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`meta-sync:${ctx.org.id}`, 6, 300, "Aguarde alguns minutos para atualizar de novo.");
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 30, 1), 365);
    return ok(await syncAds(ctx.org.id, new Date(Date.now() - days * 86_400_000), new Date()));
  } catch (e) {
    return fail(e);
  }
}

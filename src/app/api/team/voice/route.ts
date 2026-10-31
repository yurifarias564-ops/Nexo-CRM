import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { voiceFill } from "@/lib/team-server/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Dentro do CRM: áudio do vendedor → preenche o checklist. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`team-voice:${ctx.userId}`, 60, 3600, "Muitos áudios nesta hora. Aguarde um pouco.");
    return ok(await voiceFill(ctx.org.id, req));
  } catch (e) {
    return fail(e);
  }
}

import { fail, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { orgByToken } from "@/lib/team-server/share";
import { voiceFill } from "@/lib/team-server/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Link do cliente: áudio do vendedor → preenche o checklist. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`chk-voice:${token}`, 120, 3600, "Muitos áudios nesta hora. Aguarde um pouco.");
    const { orgId } = await orgByToken(token);
    return ok(await voiceFill(orgId, req));
  } catch (e) {
    return fail(e);
  }
}

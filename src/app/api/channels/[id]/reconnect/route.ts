import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { tryReconnect } from "@/lib/whatsapp/watchdog";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Botão "Tentar agora" do aviso de desconexão. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext();
    await rateLimit(`reconnect:${id}`, 6, 60, "Aguarde alguns segundos antes de tentar de novo.");
    const { data: ch } = await (await supabaseServer()).from("whatsapp_channels").select("id, organization_id, provider").eq("id", id).maybeSingle();
    if (!ch || ch.organization_id !== ctx.org.id) throw new HttpError(404, "Número não encontrado");
    if (ch.provider !== "evolution") throw new HttpError(422, "Reconexão automática é para números por QR Code");
    return ok({ result: await tryReconnect(id, true) });
  } catch (e) {
    return fail(e);
  }
}

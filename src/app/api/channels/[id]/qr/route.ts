import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import * as evo from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

/** Retorna o QR Code atual ou confirma que o número já conectou. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id || ch.provider !== "evolution" || !ch.evolution_instance) {
      throw new HttpError(404, "Canal não encontrado");
    }
    const state = await evo.connectionState(ch.evolution_instance);
    if (state === "open") {
      const phone = await evo.ownerNumber(ch.evolution_instance);
      await supabaseAdmin().from("whatsapp_channels")
        .update({ status: "connected", last_error: null, ...(phone ? { phone_number: phone } : {}) })
        .eq("id", id);
      return ok({ status: "connected" as const });
    }
    const r = await evo.connect(ch.evolution_instance);
    return ok({ status: "connecting" as const, qr: r.base64 ?? null, pairingCode: r.pairingCode ?? null });
  } catch (e) {
    return fail(e);
  }
}

import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";
import { loadChannel, zapiCreds } from "@/lib/whatsapp";
import * as zapi from "@/lib/whatsapp/zapi";
import * as evo from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    if (ch.provider === "evolution" && ch.evolution_instance) await evo.deleteInstance(ch.evolution_instance);
    // Z-API: a instância é da conta do cliente; só paramos de receber os avisos
    if (ch.provider === "zapi") await zapi.setWebhooks(zapiCreds(ch), "").catch(() => undefined);
    const { error } = await supabaseAdmin().from("whatsapp_channels").delete().eq("id", id);
    if (error) throw error;
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}

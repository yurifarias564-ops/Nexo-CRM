import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import * as mc from "@/lib/whatsapp/meta-calls";

export const runtime = "nodejs";

const Body = z.object({
  enabled: z.boolean(),
  recording: z.enum(["meta", "browser", "off"]),
  purpose: z.string().trim().min(3, "Escreva o motivo da gravação").max(250),
});

/** Ativa ligações no número oficial e define como gravar. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 4_000));
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    if (ch.provider !== "meta") throw new HttpError(409, "Ligações só existem no número da API oficial");
    const token = ch.secrets.meta_access_token;
    if (!token || !ch.meta_phone_number_id) throw new HttpError(409, "Canal oficial sem credenciais");
    if (b.enabled !== !!ch.calling_enabled) await mc.setCallingEnabled(ch.meta_phone_number_id, token, b.enabled);
    const { error } = await supabaseAdmin().from("whatsapp_channels")
      .update({ calling_enabled: b.enabled, call_recording: b.recording, call_recording_purpose: b.purpose }).eq("id", id);
    if (error) throw error;
    return ok({ saved: true });
  } catch (e) {
    return fail(e);
  }
}

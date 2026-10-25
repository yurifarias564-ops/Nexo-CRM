import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { LinkBody } from "@/lib/tracking/schema";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const b = LinkBody.omit({ kind: true, slug: true }).parse(await readJson(req, 20_000));
    const db = supabaseAdmin();
    if (b.channel_id) {
      const { data: ch } = await db.from("whatsapp_channels").select("id").eq("id", b.channel_id).eq("organization_id", ctx.org.id).maybeSingle();
      if (!ch) throw new HttpError(422, "Número de WhatsApp inválido");
    }
    const { data, error } = await db.from("tracking_links").update(b).eq("id", id).eq("organization_id", ctx.org.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Link não encontrado");
    return ok({ link: data });
  } catch (e) {
    return fail(e);
  }
}

/** Desativa o link (os cliques e a origem dos leads continuam no relatório). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    const { data } = await supabaseAdmin().from("tracking_links").update({ archived: true }).eq("id", id).eq("organization_id", ctx.org.id).select("id").maybeSingle();
    if (!data) throw new HttpError(404, "Link não encontrado");
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

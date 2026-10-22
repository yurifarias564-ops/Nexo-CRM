import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { DEFAULT_TZ, isValidTimeZone, zonedToUtc } from "@/lib/time";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Patch = z.object({
  body: z.string().trim().min(1).max(4096).optional(),
  sendAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  timeZone: z.string().optional(),
  retryNow: z.boolean().optional(),
});

/** Edita texto/horário ou reenvia uma que falhou (volta para a fila). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Mensagem não encontrada");
    await requireApiContext();
    const b = Patch.parse(await readJson(req, 16_000));
    const sb = await supabaseServer();
    const { data: cur } = await sb.from("scheduled_messages").select("id, status, time_zone, body").eq("id", id).maybeSingle();
    if (!cur) throw new HttpError(404, "Mensagem não encontrada");
    if (!["pending", "failed"].includes(cur.status)) throw new HttpError(409, "Essa mensagem não pode mais ser alterada");

    const patch: Record<string, unknown> = { status: "pending", last_error: null };
    if (b.body !== undefined) {
      if (cur.body === null) throw new HttpError(422, "Mensagens com modelo não têm texto editável");
      patch.body = b.body;
    }
    if (b.sendAt) {
      const tz = isValidTimeZone(b.timeZone) ? b.timeZone : cur.time_zone || DEFAULT_TZ;
      const at = zonedToUtc(b.sendAt, tz);
      if (!at || at.getTime() < Date.now() - 60_000) throw new HttpError(422, "Escolha um horário no futuro");
      patch.send_at = at.toISOString();
    } else if (b.retryNow) {
      patch.send_at = new Date().toISOString();
    }
    const { data, error } = await sb.from("scheduled_messages").update(patch).eq("id", id).select("id, send_at, status").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(409, "Não foi possível alterar (talvez já tenha sido enviada)");
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** Cancela (a mensagem não será enviada). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Mensagem não encontrada");
    await requireApiContext();
    const { data, error } = await (await supabaseServer()).from("scheduled_messages")
      .update({ status: "canceled" }).eq("id", id).in("status", ["pending", "failed"]).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(409, "Essa mensagem já foi enviada ou não existe");
    return ok({ canceled: true });
  } catch (e) {
    return fail(e);
  }
}

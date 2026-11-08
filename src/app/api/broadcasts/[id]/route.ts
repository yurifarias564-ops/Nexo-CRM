import { after } from "next/server";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { dispatchBroadcasts } from "@/lib/broadcasts-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Disparo + andamento + quem falhou (para conferir). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { id } = await params;
    const sb = await supabaseServer();
    const { data: b } = await sb.from("broadcasts").select("*").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
    if (!b) throw new HttpError(404, "Disparo não encontrado");
    const status = new URL(req.url).searchParams.get("status");
    let q = sb.from("broadcast_recipients").select("id, lead_id, name, phone, status, error, sent_at").eq("broadcast_id", id).order("id").limit(200);
    if (status && ["pending", "sent", "failed", "canceled", "skipped", "sending"].includes(status)) q = q.eq("status", status as "sent");
    const { data: rows } = await q;
    return ok({ broadcast: b, recipients: rows ?? [] });
  } catch (e) {
    return fail(e);
  }
}

const Act = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

/** Pausar, continuar ou cancelar (cancelar para na hora e não envia para quem faltou). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { id } = await params;
    const { action } = Act.parse(await readJson(req, 1000));
    const db = supabaseAdmin();
    const { data: b } = await db.from("broadcasts").select("id, status, send_at").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
    if (!b) throw new HttpError(404, "Disparo não encontrado");
    if (action === "cancel") {
      if (!["scheduled", "sending", "paused"].includes(b.status)) throw new HttpError(409, "Esse disparo já terminou");
      await db.rpc("cancel_broadcast", { p_broadcast: id, p_user: ctx.userId });
    } else if (action === "pause") {
      if (!["scheduled", "sending"].includes(b.status)) throw new HttpError(409, "Só dá para pausar disparo agendado ou enviando");
      await db.from("broadcasts").update({ status: "paused" }).eq("id", id);
    } else {
      if (b.status !== "paused") throw new HttpError(409, "Esse disparo não está pausado");
      const due = new Date(b.send_at).getTime() <= Date.now();
      await db.from("broadcasts").update({ status: due ? "sending" : "scheduled", next_send_at: null }).eq("id", id);
      if (due) after(() => dispatchBroadcasts(45_000).catch((e) => console.error("[broadcast resume]", e)));
    }
    const { data } = await db.from("broadcasts").select("*").eq("id", id).maybeSingle();
    return ok({ broadcast: data });
  } catch (e) {
    return fail(e);
  }
}

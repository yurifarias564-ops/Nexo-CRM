import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import { recordingOf } from "@/lib/calls";
import * as mc from "@/lib/whatsapp/meta-calls";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "Ligação não encontrada");
  // RLS: só encontra ligações da empresa de quem pediu
  const { data } = await (await supabaseServer()).from("wa_calls")
    .select("id, organization_id, channel_id, wa_call_id, direction, status, sdp_answer, sdp_offer, duration_s, error, recording_path, started_by, answered_by, started_at")
    .eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Ligação não encontrada");
  return data;
}

/** Situação da ligação (o navegador também recebe em tempo real). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiContext();
    const c = await load((await params).id);
    return ok({ status: c.status, sdpAnswer: c.sdp_answer, duration: c.duration_s, error: c.error, hasRecording: !!c.recording_path });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hangup") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("accept"), sdp: z.string().min(50).max(20_000).refine((s) => s.startsWith("v=0"), "Resposta de áudio inválida") }),
]);

/** Desligar, recusar ou atender (ligação recebida). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiContext();
    const c = await load((await params).id);
    const b = Body.parse(await readJson(req, 40_000));
    const ch = await loadChannel(c.channel_id);
    const token = ch.secrets.meta_access_token;
    if (!token || !ch.meta_phone_number_id) throw new HttpError(409, "Canal oficial sem credenciais");
    const db = supabaseAdmin();
    const now = new Date().toISOString();

    if (b.action === "accept") {
      if (c.direction !== "in" || !c.wa_call_id) throw new HttpError(409, "Esta ligação não pode ser atendida");
      // Só um atendente pega a ligação
      const { data: mine } = await db.from("wa_calls").update({ status: "accepting", answered_by: ctx.userId, updated_at: now })
        .eq("id", c.id).eq("status", "ringing").select("id");
      if (!mine?.length) throw new HttpError(409, "Outra pessoa já atendeu ou a ligação terminou");
      try {
        await mc.callAction(ch.meta_phone_number_id, token, c.wa_call_id, "pre_accept", b.sdp);
        await mc.callAction(ch.meta_phone_number_id, token, c.wa_call_id, "accept", b.sdp, recordingOf(ch), c.id);
      } catch (e) {
        await db.from("wa_calls").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "erro", updated_at: now }).eq("id", c.id);
        throw e;
      }
      await db.from("wa_calls").update({ status: "connected", started_at: now, updated_at: now }).eq("id", c.id);
      return ok({ accepted: true });
    }

    if (b.action === "reject") {
      if (c.direction !== "in" || !c.wa_call_id || c.status !== "ringing") throw new HttpError(409, "Esta ligação não pode ser recusada");
      await mc.callAction(ch.meta_phone_number_id, token, c.wa_call_id, "reject");
      await db.from("wa_calls").update({ status: "rejected", answered_by: ctx.userId, ended_at: now, updated_at: now }).eq("id", c.id);
      return ok({ rejected: true });
    }

    // hangup
    if (["completed", "failed", "rejected", "missed", "canceled"].includes(c.status)) return ok({ ended: true });
    if (c.wa_call_id) {
      try { await mc.callAction(ch.meta_phone_number_id, token, c.wa_call_id, "terminate"); } catch { /* já terminou do outro lado */ }
    }
    // O status final (duração) chega pelo webhook; aqui só marca quem não conectou
    if (c.status !== "connected") await db.from("wa_calls").update({ status: "canceled", ended_at: now, updated_at: now }).eq("id", c.id).in("status", ["starting", "ringing", "accepting"]);
    return ok({ ended: true });
  } catch (e) {
    return fail(e);
  }
}

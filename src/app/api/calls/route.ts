import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { callTarget, expireStale, recordingOf } from "@/lib/calls";
import * as mc from "@/lib/whatsapp/meta-calls";

export const runtime = "nodejs";

const Body = z.object({
  conversationId: z.string().uuid(),
  sdp: z.string().min(50, "Oferta de áudio inválida").max(20_000).refine((s) => s.startsWith("v=0"), "Oferta de áudio inválida"),
});

/** Liga para o cliente pelo WhatsApp (o navegador já mandou a oferta WebRTC). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    const b = Body.parse(await readJson(req, 40_000));
    await rateLimit(`call-start:${ctx.userId}`, 30, 3600, "Muitas ligações nesta hora. Aguarde um pouco.");
    const t = await callTarget(ctx.org.id, b.conversationId);
    const db = supabaseAdmin();
    await expireStale(ctx.org.id);
    const { data: busy } = await db.from("wa_calls").select("id").eq("conversation_id", t.conv.id).in("status", ["starting", "ringing", "accepting", "connected"]).limit(1);
    if (busy?.length) throw new HttpError(409, "Já existe uma ligação em andamento com este cliente");

    const id = randomUUID();
    const mode = t.ch.call_recording === "browser" ? "browser" : "meta";
    let contactName = t.conv.contact_name;
    if (t.conv.lead_id) {
      const { data: lead } = await db.from("leads").select("name").eq("id", t.conv.lead_id).maybeSingle();
      contactName = lead?.name ?? contactName;
    }
    const { error } = await db.from("wa_calls").insert({
      id, organization_id: ctx.org.id, channel_id: t.ch.id, conversation_id: t.conv.id, lead_id: t.conv.lead_id, wa_id: t.conv.wa_id, contact_name: contactName,
      direction: "out", status: "starting", started_by: ctx.userId, recording_mode: mode,
    });
    if (error) throw error;
    try {
      const waCallId = await mc.startCall(t.pnid, t.token, t.conv.wa_id, b.sdp, id, recordingOf(t.ch));
      await db.from("wa_calls").update({ wa_call_id: waCallId, status: "ringing", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "starting");
    } catch (e) {
      await db.from("wa_calls").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "erro", updated_at: new Date().toISOString() }).eq("id", id);
      throw e;
    }
    return ok({ id, recording: mode }, 201);
  } catch (e) {
    return fail(e);
  }
}

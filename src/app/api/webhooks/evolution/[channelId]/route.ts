import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseWebhook, ownerNumber } from "@/lib/whatsapp/evolution";
import { applyStatuses, ingestBatch } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await ctx.params;
  if (!UUID.test(channelId)) return new Response("not found", { status: 404 });

  const db = supabaseAdmin();
  const { data: sec } = await db
    .from("whatsapp_channel_secrets")
    .select("webhook_secret, whatsapp_channels!inner(id, evolution_instance, status)")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!sec) return new Response("not found", { status: 404 });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const expected = sec.webhook_secret as string;
  if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    const evt = parseWebhook(payload);
    if (evt.connection) {
      const status = evt.connection === "open" ? "connected" : evt.connection === "connecting" ? "connecting" : "disconnected";
      const ch = (Array.isArray(sec.whatsapp_channels) ? sec.whatsapp_channels[0] : sec.whatsapp_channels) as { evolution_instance: string | null } | undefined;
      const phone = status === "connected" && ch?.evolution_instance ? await ownerNumber(ch.evolution_instance) : null;
      await db.from("whatsapp_channels")
        .update({ status, last_error: null, ...(phone ? { phone_number: phone } : {}) })
        .eq("id", channelId);
    }
    if (evt.messages.length) {
      await ingestBatch(channelId, evt.messages, evt.historical);
      if (evt.historical) {
        await db.from("whatsapp_channels").update({ history_imported_at: new Date().toISOString() }).eq("id", channelId);
      }
    }
    if (evt.statuses.length) await applyStatuses(channelId, evt.statuses);
  } catch (e) {
    console.error("[evolution webhook]", e);
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}

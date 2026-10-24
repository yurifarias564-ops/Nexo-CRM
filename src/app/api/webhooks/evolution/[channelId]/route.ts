import { after } from "next/server";
import { LOGGED_OUT_CODES, markDown, markUp, tryReconnect } from "@/lib/whatsapp/watchdog";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseWebhook, ownerNumber } from "@/lib/whatsapp/evolution";
import { applyChanges, applyStatuses, ingestBatch } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await ctx.params;
  if (!UUID.test(channelId)) return new Response("not found", { status: 404 });

  const db = supabaseAdmin();
  const { data: sec } = await db
    .from("whatsapp_channel_secrets")
    .select("webhook_secret, whatsapp_channels!inner(id, evolution_instance, status, phone_number)")
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
      const ch = (Array.isArray(sec.whatsapp_channels) ? sec.whatsapp_channels[0] : sec.whatsapp_channels) as { evolution_instance: string | null; phone_number: string | null } | undefined;
      const everConnected = Boolean(ch?.phone_number);
      if (evt.connection === "open") {
        await markUp(channelId, ch?.evolution_instance ? await ownerNumber(ch.evolution_instance).catch(() => null) : null);
      } else if (evt.connection === "close" && !everConnected) {
        // Ainda no primeiro QR Code (nunca conectou): não é queda
        await db.from("whatsapp_channels").update({ status: "disconnected" }).eq("id", channelId);
      } else if (evt.connection === "close") {
        const loggedOut = evt.reason !== undefined && LOGGED_OUT_CODES.has(evt.reason);
        await markDown(channelId, { needsQr: loggedOut });
        // Caiu sem encerrar a sessão: tenta voltar já, sem esperar o vigia
        if (!loggedOut) after(() => tryReconnect(channelId).then(() => undefined));
      } else {
        await db.from("whatsapp_channels").update({ status: "connecting" }).eq("id", channelId).neq("status", "connected");
      }
    }
    if (evt.messages.length) {
      await ingestBatch(channelId, evt.messages, evt.historical);
      if (evt.historical) {
        await db.from("whatsapp_channels").update({ history_imported_at: new Date().toISOString() }).eq("id", channelId);
      }
    }
    if (evt.statuses.length) await applyStatuses(channelId, evt.statuses);
    if (evt.changes.length) await applyChanges(channelId, evt.changes);
  } catch (e) {
    console.error("[evolution webhook]", e);
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}

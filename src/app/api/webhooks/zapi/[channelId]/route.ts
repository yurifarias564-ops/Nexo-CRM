import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lidOf, parseWebhook } from "@/lib/whatsapp/zapi";
import { applyChanges, applyStatuses, ingestBatch, loadChannel, saveSample, zapiCreds } from "@/lib/whatsapp";
import { markDown, markUp, tryReconnect } from "@/lib/whatsapp/watchdog";
import { linkLidsAfter, mapLidsBefore } from "@/lib/whatsapp/zapi-lid";
import { refreshAvatars } from "@/lib/whatsapp/avatars";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Avisos da Z-API: mensagens recebidas/enviadas, status de entrega e conexão. */
export async function POST(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await ctx.params;
  if (!UUID.test(channelId)) return new Response("not found", { status: 404 });

  const db = supabaseAdmin();
  const { data: sec } = await db
    .from("whatsapp_channel_secrets")
    .select("webhook_secret, whatsapp_channels!inner(id, zapi_instance_id, phone_number, provider)")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!sec) return new Response("not found", { status: 404 });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const expected = sec.webhook_secret as string;
  if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return new Response("unauthorized", { status: 401 });
  }
  const ch = (Array.isArray(sec.whatsapp_channels) ? sec.whatsapp_channels[0] : sec.whatsapp_channels) as { zapi_instance_id: string | null; phone_number: string | null; provider: string } | undefined;
  if (ch?.provider !== "zapi") return new Response("not found", { status: 404 });

  let payload: unknown;
  try { payload = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  const inst = (payload as { instanceId?: unknown })?.instanceId;
  if (typeof inst === "string" && ch.zapi_instance_id && inst !== ch.zapi_instance_id) return new Response("ok");

  try {
    const evt = parseWebhook(payload);
    if (evt.connection === "open") {
      const phone = (payload as { phone?: unknown })?.phone;
      await markUp(channelId, typeof phone === "string" ? phone.replace(/\D/g, "") : null);
    } else if (evt.connection === "close" && ch.phone_number) {
      await markDown(channelId);
      after(() => tryReconnect(channelId).then(() => undefined));
    }
    if (evt.messages.length) {
      await mapLidsBefore(channelId, evt.messages);
      await ingestBatch(channelId, evt.messages, false);
      const creds = await loadChannel(channelId).then(zapiCreds).catch(() => null);
      await linkLidsAfter(channelId, evt.messages, creds ? (phone) => lidOf(creds, phone) : undefined);
      // Lead novo: busca a foto de perfil logo
      after(() => refreshAvatars(3).then(() => undefined));
    }
    if (evt.statuses.length) await applyStatuses(channelId, evt.statuses);
    if (evt.changes.length) await applyChanges(channelId, evt.changes);
    if (evt.sample) await saveSample("zapi", evt.sample, payload);
    return new Response("ok");
  } catch (e) {
    console.error("[webhook zapi]", e);
    return new Response("error", { status: 500 });
  }
}

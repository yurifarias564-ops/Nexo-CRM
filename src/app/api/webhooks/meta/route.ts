import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { aiAfterIngest } from "@/lib/ai/trigger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { webhookVerifyToken } from "@/lib/meta-config";
import { parseWebhook, verifySignature } from "@/lib/whatsapp/meta";
import { applyStatuses, ingestBatch } from "@/lib/whatsapp";
import { parseCallWebhook } from "@/lib/whatsapp/meta-calls";
import { handleCallBatch } from "@/lib/calls";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Verificação do webhook pela Meta (hub.challenge). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("hub.verify_token") ?? "";
  let expected = "";
  try { expected = webhookVerifyToken(); } catch { return new Response("forbidden", { status: 403 }); }
  const okToken = token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (u.searchParams.get("hub.mode") === "subscribe" && okToken) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const db = supabaseAdmin();
  try {
    for (const batch of parseWebhook(payload)) {
      const { data: ch } = await db
        .from("whatsapp_channels")
        .select("id")
        .eq("meta_phone_number_id", batch.phoneNumberId)
        .maybeSingle();
      if (!ch) continue; // número não cadastrado neste sistema
      const historical = batch.historical;
      if (batch.messages.length) await ingestBatch(ch.id, batch.messages, historical);
      if (batch.messages.length && !historical) { const id = ch.id, msgs = batch.messages; after(() => aiAfterIngest(id, msgs)); }
      if (batch.statuses.length) await applyStatuses(ch.id, batch.statuses);
      if (historical) {
        await db.from("whatsapp_channels").update({ history_imported_at: new Date().toISOString() }).eq("id", ch.id);
      }
    }
    // Ligações (Calling API) e respostas de permissão para ligar
    for (const cb of parseCallWebhook(payload)) {
      const { data: ch } = await db.from("whatsapp_channels").select("id").eq("meta_phone_number_id", cb.phoneNumberId).maybeSingle();
      if (ch) await handleCallBatch(ch.id, cb);
    }
  } catch (e) {
    console.error("[meta webhook]", e);
    return new Response("error", { status: 500 }); // a Meta reenvia; a ingestão é idempotente
  }
  return new Response("ok");
}

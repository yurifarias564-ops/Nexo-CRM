import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { aiAfterIngest } from "@/lib/ai/trigger";
import { igVerifyToken, validSignature } from "@/lib/instagram";
import { ingestInstagram } from "@/lib/instagram-ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Verificação do webhook pela Meta (hub.challenge). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const want = igVerifyToken();
  const okToken = token.length === want.length && timingSafeEqual(Buffer.from(token), Buffer.from(want));
  if (u.searchParams.get("hub.mode") === "subscribe" && okToken) return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("forbidden", { status: 403 });
}

/** Mensagens do Direct das contas conectadas. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("invalid signature", { status: 401 });
  let payload: { object?: string; entry?: { id?: string; messaging?: unknown[] }[] };
  try { payload = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  if (payload.object !== "instagram") return new Response("ok");
  try {
    for (const entry of payload.entry ?? []) {
      if (!entry.id || !Array.isArray(entry.messaging)) continue;
      const r = await ingestInstagram(String(entry.id), entry.messaging as Parameters<typeof ingestInstagram>[1]);
      const incoming = r.messages.filter((m) => m.direction === "in");
      if (r.channelId && incoming.length) { const id = r.channelId; after(() => aiAfterIngest(id, incoming)); }
    }
  } catch (e) {
    console.error("[instagram webhook]", e);
    return new Response("error", { status: 500 }); // a Meta reenvia; a gravação é idempotente
  }
  return new Response("ok");
}

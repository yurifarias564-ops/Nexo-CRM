import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { aiAfterIngest } from "@/lib/ai/trigger";
import { igVerifyToken, validSignature } from "@/lib/instagram";
import { ingestInstagram } from "@/lib/instagram-ingest";
import { handleIgComment, handleIgFlowText, handleIgPostback, type IgCommentEvent } from "@/lib/ig-flows-server";

type Ev = Parameters<typeof ingestInstagram>[1][number] & { postback?: { mid?: string; title?: string; payload?: string } };

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
  let payload: { object?: string; entry?: { id?: string; messaging?: unknown[]; changes?: { field?: string; value?: unknown }[] }[] };
  try { payload = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  if (payload.object !== "instagram") return new Response("ok");
  try {
    for (const entry of payload.entry ?? []) {
      if (!entry.id) continue;
      const igId = String(entry.id);
      // Comentários: gatilho das automações do Instagram
      for (const c of entry.changes ?? []) {
        if (c.field === "comments" || c.field === "live_comments") await handleIgComment(igId, (c.value ?? {}) as IgCommentEvent);
      }
      if (!Array.isArray(entry.messaging)) continue;
      const events = entry.messaging as Ev[];
      const flowMids = new Set<string>();
      const normal: Ev[] = [];
      for (const e of events) {
        const sender = e.sender?.id;
        if (e.postback && sender) {
          // Clique em botão: anda o fluxo e fica registrado na conversa como mensagem da pessoa
          await handleIgPostback(igId, sender, e.postback.payload);
          const mid = e.postback.mid ?? `pb-${sender}-${e.timestamp ?? Date.now()}`;
          flowMids.add(mid);
          normal.push({ sender: e.sender, recipient: e.recipient, timestamp: e.timestamp, message: { mid, text: `🔘 ${e.postback.title ?? "Botão"}` } });
          continue;
        }
        if (sender && sender !== igId && e.message?.mid && !e.message.is_echo && e.message.text && (await handleIgFlowText(igId, sender))) flowMids.add(e.message.mid);
        normal.push(e);
      }
      const r = await ingestInstagram(igId, normal);
      // A IA não responde a clique de botão nem a resposta que só fez o fluxo andar
      const incoming = r.messages.filter((m) => m.direction === "in" && !flowMids.has(m.external_id ?? ""));
      if (r.channelId && incoming.length) { const id = r.channelId; after(() => aiAfterIngest(id, incoming)); }
    }
  } catch (e) {
    console.error("[instagram webhook]", e);
    return new Response("error", { status: 500 }); // a Meta reenvia; a gravação é idempotente
  }
  return new Response("ok");
}

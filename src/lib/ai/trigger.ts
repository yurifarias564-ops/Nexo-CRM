import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pauseAiForHuman } from "@/lib/send";
import type { NormalizedMessage } from "@/lib/whatsapp/types";
import { respondToConversation } from "./agent";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Depois de gravar mensagens novas do WhatsApp: cliente escreveu → a IA responde;
 * alguém da equipe respondeu pelo celular → a IA dá uma pausa nessa conversa.
 */
export async function aiAfterIngest(channelId: string, messages: NormalizedMessage[]) {
  if (!messages.length) return;
  const db = supabaseAdmin();
  const { data: ch } = await db.from("whatsapp_channels").select("organization_id").eq("id", channelId).maybeSingle();
  if (!ch) return;
  const { data: agent } = await db.from("ai_agents").select("enabled").eq("organization_id", ch.organization_id).maybeSingle();
  if (!agent?.enabled) return;

  const { data: rows } = await db.from("messages").select("id, conversation_id, direction, sent_at")
    .eq("channel_id", channelId).in("external_id", messages.map((m) => m.external_id).slice(0, 100));
  const recent = (rows ?? []).filter((r) => Date.now() - new Date(r.sent_at).getTime() < 15 * 60_000);

  // Última mensagem do cliente em cada conversa
  const lastIn = new Map<string, { id: string; at: string }>();
  for (const r of recent) {
    if (r.direction !== "in") continue;
    const cur = lastIn.get(r.conversation_id);
    if (!cur || r.sent_at > cur.at) lastIn.set(r.conversation_id, { id: r.id, at: r.sent_at });
  }
  const outs = recent.filter((r) => r.direction === "out");

  await Promise.all([
    ...[...lastIn.entries()].map(([conv, m]) => respondToConversation(conv, m.id).catch((e) => console.error("[ia]", e))),
    (async () => {
      if (!outs.length) return;
      await sleep(5000); // dá tempo de a própria IA marcar as mensagens dela
      const { data: check } = await db.from("messages").select("id, conversation_id, by_ai, by_automation, sent_by").in("id", outs.map((o) => o.id));
      const human = new Set((check ?? []).filter((m) => !m.by_ai && !m.by_automation).map((m) => m.conversation_id));
      for (const c of human) await pauseAiForHuman(c).catch(() => undefined);
    })(),
  ]);
}

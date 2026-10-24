import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedMessage } from "./types";

/**
 * Antes de gravar: mensagem que veio só com o @lid vai para a conversa já conhecida
 * desse @lid (com o número de verdade), em vez de criar um lead duplicado.
 */
export async function mapLidsBefore(channelId: string, msgs: NormalizedMessage[]) {
  const lids = [...new Set(msgs.filter((m) => m.lid && m.wa_id === m.lid).map((m) => m.lid!))];
  if (!lids.length) return;
  const { data } = await supabaseAdmin().from("conversations").select("wa_id, wa_lid").eq("channel_id", channelId).in("wa_lid", lids);
  const real = new Map((data ?? []).filter((c) => c.wa_id !== c.wa_lid).map((c) => [c.wa_lid as string, c.wa_id as string]));
  for (const m of msgs) if (m.lid && m.wa_id === m.lid && real.has(m.lid)) m.wa_id = real.get(m.lid)!;
}

/**
 * Depois de gravar: registra o @lid na conversa e, se existir uma conversa duplicada
 * criada só pelo @lid, junta tudo na conversa do número de verdade (e apaga o lead duplicado).
 */
export async function linkLidsAfter(channelId: string, msgs: NormalizedMessage[], lookup?: (phone: string) => Promise<string | null>) {
  const db = supabaseAdmin();
  const seen = new Set<string>();
  // Contato com número mas sem @lid conhecido: pergunta o @lid à Z-API (uma vez por conversa)
  if (lookup) {
    for (const m of msgs) {
      if (m.lid || m.wa_id.length > 13) continue;
      const { data: c } = await db.from("conversations").select("wa_lid").eq("channel_id", channelId).eq("wa_id", m.wa_id).maybeSingle();
      if (c && !c.wa_lid) m.lid = await lookup(m.wa_id).catch(() => null);
      else if (c?.wa_lid) m.lid = c.wa_lid;
    }
  }
  for (const m of msgs) {
    if (!m.lid || seen.has(m.lid)) continue;
    seen.add(m.lid);
    const { data: msg } = await db.from("messages").select("conversation_id").eq("channel_id", channelId).eq("external_id", m.external_id).maybeSingle();
    if (!msg) continue;
    const { data: conv } = await db.from("conversations").select("id, wa_id, wa_lid, lead_id").eq("id", msg.conversation_id).maybeSingle();
    if (!conv) continue;
    if (conv.wa_id === m.lid) {
      // Ainda não sabemos o número: só marca o @lid
      if (!conv.wa_lid) await db.from("conversations").update({ wa_lid: m.lid }).eq("id", conv.id);
      continue;
    }
    // Conversa do número de verdade: junta a duplicada (se houver) e guarda o @lid
    const { data: dups } = await db.from("conversations").select("id, lead_id").eq("channel_id", channelId).neq("id", conv.id)
      .or(`wa_id.eq.${m.lid},wa_lid.eq.${m.lid}`);
    for (const d of dups ?? []) {
      await db.from("messages").update({ conversation_id: conv.id }).eq("conversation_id", d.id);
      await db.from("scheduled_messages").update({ conversation_id: conv.id, lead_id: conv.lead_id }).eq("conversation_id", d.id);
      await db.from("wa_calls").update({ conversation_id: conv.id, lead_id: conv.lead_id }).eq("conversation_id", d.id);
      await db.from("conversations").delete().eq("id", d.id);
      if (d.lead_id && d.lead_id !== conv.lead_id) {
        const { data: lead } = await db.from("leads").select("id, phone").eq("id", d.lead_id).maybeSingle();
        // Só apaga o lead que nasceu do @lid (telefone = @lid); lead com telefone de verdade fica
        if (lead && lead.phone === m.lid) {
          if (conv.lead_id) await db.from("activities").update({ lead_id: conv.lead_id }).eq("lead_id", lead.id);
          await db.from("leads").delete().eq("id", lead.id);
        }
      }
    }
    if (conv.wa_lid !== m.lid) await db.from("conversations").update({ wa_lid: m.lid }).eq("id", conv.id);
    // Atualiza a prévia da conversa com a mensagem mais recente
    const { data: last } = await db.from("messages").select("body, type, sent_at").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (last) await db.from("conversations").update({ last_message_at: last.sent_at, last_message_preview: (last.body ?? `[${last.type}]`).slice(0, 120) }).eq("id", conv.id);
  }
}

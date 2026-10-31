import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ingestBatch, loadChannel } from "@/lib/whatsapp";
import type { NormalizedMessage } from "@/lib/whatsapp/types";
import type { MsgType } from "@/lib/types";
import { IG_PREFIX, isIgMediaUrl, profile } from "@/lib/instagram";

type Att = { type?: string; payload?: { url?: string } };
type Ev = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_unsupported?: boolean; attachments?: Att[]; reply_to?: { story?: { url?: string } } };
};

const MAX = 16 * 1024 * 1024;

/** Guarda a mídia (o link do Instagram expira) e devolve a referência para o CRM. */
async function keepMedia(orgId: string, url: string, mid: string): Promise<{ ref: string | null; mime: string | null }> {
  if (!isIgMediaUrl(url)) return { ref: null, mime: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000), redirect: "error" });
    if (!res.ok) return { ref: null, mime: null };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX) return { ref: null, mime: null };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX) return { ref: null, mime: null };
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!;
    const path = `${orgId}/ig-in/${mid.replace(/[^\w-]/g, "").slice(-60)}`;
    const up = await supabaseAdmin().storage.from("automation-media").upload(path, buf, { contentType: mime, upsert: true });
    return up.error ? { ref: null, mime } : { ref: `storage:${path}`, mime };
  } catch { return { ref: null, mime: null }; }
}

const TYPE: Record<string, MsgType> = { image: "image", video: "video", audio: "audio", file: "document", sticker: "sticker" };

/** Eventos de mensagem de uma conta do Instagram → conversas e leads do CRM. Devolve o que entrou (para a IA). */
export async function ingestInstagram(igUserId: string, events: Ev[]) {
  const db = supabaseAdmin();
  const { data: row } = await db.from("whatsapp_channels").select("id, organization_id, status").eq("provider", "instagram").eq("ig_user_id", igUserId).maybeSingle();
  if (!row) return { channelId: null, messages: [] as NormalizedMessage[] };
  const ch = await loadChannel(row.id);
  const token = ch.secrets.meta_access_token ?? "";
  const out: NormalizedMessage[] = [];
  for (const e of events) {
    const m = e.message;
    if (!m?.mid || m.is_deleted) continue;
    const echo = Boolean(m.is_echo);
    const other = echo ? e.recipient?.id : e.sender?.id;
    if (!other || other === igUserId) continue;
    const waId = `${IG_PREFIX}${other}`;
    // Primeira mensagem dessa pessoa: cria o lead (origem Instagram) com o nome e o @
    const { data: conv } = await db.from("conversations").select("id, lead_id").eq("channel_id", row.id).eq("wa_id", waId).maybeSingle();
    let contactName: string | null = null;
    if (!conv) {
      const p = token ? await profile(token, other) : { name: null, username: null, pic: null };
      contactName = p.name || (p.username ? `@${p.username}` : null) || "Cliente do Instagram";
      const { data: st } = await db.from("stages").select("id, pipeline_id, pipelines!inner(position)").eq("organization_id", row.organization_id).order("position").limit(50);
      const first = (st ?? []).sort((a, b) => {
        const pa = (a.pipelines as unknown as { position: number }).position, pb = (b.pipelines as unknown as { position: number }).position;
        return pa - pb;
      })[0];
      let leadId: string | null = null;
      if (first && !echo) {
        const { data: lead } = await db.from("leads").insert({
          organization_id: row.organization_id, pipeline_id: first.pipeline_id, stage_id: first.id, name: contactName.slice(0, 120),
          source: "Instagram", ...(p.pic ? { avatar_url: p.pic } : {}),
        }).select("id").single();
        leadId = lead?.id ?? null;
        if (leadId && p.username) await db.from("activities").insert({ organization_id: row.organization_id, lead_id: leadId, actor_id: null, type: "note", payload: { text: `Instagram: @${p.username} — https://instagram.com/${p.username}`, via: "instagram" } });
      }
      await db.from("conversations").upsert({ organization_id: row.organization_id, channel_id: row.id, wa_id: waId, contact_name: contactName, lead_id: leadId }, { onConflict: "channel_id,wa_id", ignoreDuplicates: true });
    }
    const att = m.attachments?.[0];
    let type: MsgType = "text";
    let media: { ref: string | null; mime: string | null } = { ref: null, mime: null };
    if (att?.payload?.url && !echo) {
      type = TYPE[att.type ?? ""] ?? "document";
      media = await keepMedia(row.organization_id, att.payload.url, m.mid);
    } else if (att) type = TYPE[att.type ?? ""] ?? "other";
    let body = m.text ?? null;
    if (!body && m.reply_to?.story) body = "↩️ Respondeu ao seu story";
    if (!body && att?.type === "share") body = "🔗 Compartilhou uma publicação";
    if (!body && m.is_unsupported) body = "Mensagem que o Instagram não mostra fora do app";
    out.push({
      wa_id: waId, contact_name: contactName, external_id: m.mid, direction: echo ? "out" : "in", type, body,
      media_ref: media.ref, media_mime: media.mime, status: echo ? "sent" : "received",
      sent_at: new Date(e.timestamp ?? Date.now()).toISOString(),
    });
  }
  if (out.length) await ingestBatch(row.id, out, false);
  return { channelId: row.id as string, messages: out };
}

/** Renova os tokens do Instagram que vencem em até 15 dias (vale 60 dias; renovar mantém a conta conectada). */
export async function refreshInstagramTokens() {
  const db = supabaseAdmin();
  const soon = new Date(Date.now() + 15 * 86_400_000).toISOString();
  const { data } = await db.from("whatsapp_channels").select("id").eq("provider", "instagram").eq("status", "connected").lt("ig_token_expires_at", soon).limit(20);
  const { refreshToken } = await import("@/lib/instagram");
  for (const c of data ?? []) {
    try {
      const ch = await loadChannel(c.id);
      const r = await refreshToken(ch.secrets.meta_access_token ?? "");
      await db.from("whatsapp_channel_secrets").update({ meta_access_token: r.token, updated_at: new Date().toISOString() }).eq("channel_id", c.id);
      await db.from("whatsapp_channels").update({ ig_token_expires_at: r.expiresAt.toISOString(), last_error: null }).eq("id", c.id);
    } catch (e) {
      await db.from("whatsapp_channels").update({ last_error: `Renovação do acesso: ${(e as Error).message}`.slice(0, 300) }).eq("id", c.id);
    }
  }
}

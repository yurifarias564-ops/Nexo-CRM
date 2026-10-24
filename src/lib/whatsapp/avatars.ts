import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadChannel, zapiCreds } from "./index";
import * as zapi from "./zapi";
import * as evo from "./evolution";

const REFRESH_AFTER_MS = 3 * 24 * 3600_000; // foto de perfil muda pouco: confere a cada 3 dias

/**
 * Busca a foto de perfil do WhatsApp dos leads (números por QR Code) e guarda uma cópia
 * própria — o link do WhatsApp expira em poucos dias. A API oficial não fornece a foto.
 */
export async function refreshAvatars(limit = 8) {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - REFRESH_AFTER_MS).toISOString();
  const { data: rows } = await db.from("conversations")
    .select("lead_id, wa_id, channel_id, leads!inner(id, organization_id, avatar_url, avatar_checked_at), whatsapp_channels!inner(provider, status)")
    .not("lead_id", "is", null)
    .in("whatsapp_channels.provider", ["zapi", "evolution"])
    .eq("whatsapp_channels.status", "connected")
    .or(`avatar_checked_at.is.null,avatar_checked_at.lt.${cutoff}`, { referencedTable: "leads" })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  let done = 0;
  for (const r of rows ?? []) {
    const lead = (Array.isArray(r.leads) ? r.leads[0] : r.leads) as { id: string; organization_id: string; avatar_url: string | null } | undefined;
    if (!lead || r.wa_id.length > 13) continue; // contato só com @lid: sem número para buscar a foto
    try {
      const ch = await loadChannel(r.channel_id);
      const link = ch.provider === "zapi" ? await zapi.profilePicture(zapiCreds(ch), r.wa_id)
        : ch.evolution_instance ? await evo.profilePicture(ch.evolution_instance, r.wa_id) : null;
      let url: string | null = null;
      if (link) {
        const res = await fetch(link, { signal: AbortSignal.timeout(15_000) });
        const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!;
        if (res.ok && /^image\/(jpeg|png|webp)$/.test(mime)) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.byteLength > 0 && buf.byteLength < 2_000_000) {
            const path = `${lead.organization_id}/${lead.id}-${randomBytes(6).toString("hex")}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
            const up = await db.storage.from("avatars").upload(path, buf, { contentType: mime, upsert: true });
            if (!up.error) url = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
            // Remove a foto antiga
            const old = lead.avatar_url?.split("/avatars/")[1];
            if (url && old) await db.storage.from("avatars").remove([decodeURIComponent(old)]).catch(() => undefined);
          }
        }
      }
      await db.from("leads").update({ avatar_checked_at: new Date().toISOString(), ...(url ? { avatar_url: url } : {}) }).eq("id", lead.id);
      done++;
    } catch {
      await db.from("leads").update({ avatar_checked_at: new Date().toISOString() }).eq("id", lead.id);
    }
  }
  return done;
}

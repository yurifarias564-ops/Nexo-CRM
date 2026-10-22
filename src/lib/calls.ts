import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { loadChannel, type ChannelWithSecrets } from "@/lib/whatsapp";
import * as mc from "@/lib/whatsapp/meta-calls";

export const CALLS_BUCKET = "calls";
const LIVE = ["starting", "ringing", "accepting", "connected"];

export interface CallRow {
  id: string; organization_id: string; channel_id: string; conversation_id: string | null; lead_id: string | null; wa_id: string;
  wa_call_id: string | null; direction: "out" | "in"; status: string; started_by: string | null; answered_by: string | null;
  recording_mode: "meta" | "browser"; contact_name: string | null; started_at: string | null; ended_at: string | null; duration_s: number | null;
}

/** Variações do número com/sem o 9º dígito (celulares do Brasil). */
export function brVariants(wa: string): string[] {
  const d = wa.replace(/\D/g, "");
  const out = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) out.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) out.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...out];
}

/** Conversa + número oficial prontos para ligar (só canais da API oficial). */
export async function callTarget(orgId: string, conversationId: string): Promise<{ conv: { id: string; wa_id: string; lead_id: string | null; contact_name: string | null }; ch: ChannelWithSecrets; pnid: string; token: string }> {
  const { data: conv } = await supabaseAdmin().from("conversations").select("id, organization_id, channel_id, wa_id, lead_id, contact_name").eq("id", conversationId).maybeSingle();
  if (!conv || conv.organization_id !== orgId) throw new HttpError(404, "Conversa não encontrada");
  const ch = await loadChannel(conv.channel_id);
  if (ch.provider !== "meta") throw new HttpError(409, "Ligação pelo WhatsApp só funciona no número conectado pela API oficial (Meta). Pelo QR Code o WhatsApp não permite ligar.");
  if (ch.status !== "connected") throw new HttpError(409, `O WhatsApp "${ch.name}" está desconectado`);
  if (!ch.calling_enabled) throw new HttpError(409, "Ligações estão desativadas neste número. Ative em Configurações → WhatsApp.");
  const token = ch.secrets.meta_access_token;
  if (!token || !ch.meta_phone_number_id) throw new HttpError(409, "Canal oficial sem credenciais");
  return { conv, ch, pnid: ch.meta_phone_number_id, token };
}

// Toda ligação é gravada: pelo WhatsApp (com aviso ao cliente) ou só no navegador.
const recOpts = (ch: ChannelWithSecrets) => (ch.call_recording === "browser" ? null : { purpose: ch.call_recording_purpose || "qualidade do atendimento" });
export const recordingOf = recOpts;

/** Registra a mensagem de sistema na conversa (aparece no chat). */
export async function chatNote(ch: ChannelWithSecrets, waId: string, externalId: string, body: string, userId: string | null, direction: "out" | "in" = "out") {
  await supabaseAdmin().rpc("ingest_message", {
    p_channel: ch.id, p_wa_id: waId, p_contact_name: null, p_external_id: externalId, p_direction: direction, p_type: "other",
    p_body: body, p_media_ref: null, p_media_mime: null, p_status: direction === "out" ? "sent" : "received",
    p_sent_at: new Date().toISOString(), p_sent_by: userId, p_is_history: false,
  });
}

/** Ao terminar: grava a ligação no histórico do lead (conta em Ligações do time e do relatório). */
async function logActivity(call: CallRow, connected: boolean, duration: number | null) {
  if (!call.lead_id) return;
  const actor = call.direction === "out" ? call.started_by : call.answered_by;
  await supabaseAdmin().from("activities").insert({
    organization_id: call.organization_id, lead_id: call.lead_id, actor_id: actor, type: "call",
    payload: {
      outcome: connected ? "atendeu" : "nao_atendeu", duration_min: duration ? Math.round((duration / 60) * 10) / 10 : null,
      via: "whatsapp", direction: call.direction, call_id: call.id, notes: null,
    },
  });
}

async function findCall(channelId: string, waCallId: string, opaque: string | null): Promise<CallRow | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("wa_calls").select("*").eq("channel_id", channelId).eq("wa_call_id", waCallId).maybeSingle();
  if (data) return data as CallRow;
  if (opaque && /^[0-9a-f-]{36}$/i.test(opaque)) {
    const { data: byId } = await db.from("wa_calls").select("*").eq("id", opaque).eq("channel_id", channelId).maybeSingle();
    if (byId) return byId as CallRow;
  }
  return null;
}

/** Processa os eventos de ligação vindos do webhook da Meta. */
export async function handleCallBatch(channelId: string, batch: mc.CallBatch) {
  const db = supabaseAdmin();
  const ch = await loadChannel(channelId);
  const now = new Date().toISOString();

  for (const p of batch.permissions) {
    const { data: conv } = await db.from("conversations").select("id, wa_id").eq("channel_id", channelId).in("wa_id", brVariants(p.waId)).maybeSingle();
    if (!conv) continue;
    await db.from("conversations").update(p.response === "accept"
      ? { call_permission_until: p.permanent ? null : p.expiresAt, call_permission_permanent: p.permanent }
      : { call_permission_until: null, call_permission_permanent: false }).eq("id", conv.id);
  }

  for (const s of batch.statuses) {
    const call = await findCall(channelId, s.id, null);
    if (!call || !LIVE.includes(call.status)) continue;
    const next = s.status === "RINGING" ? "ringing" : s.status === "REJECTED" ? "rejected" : null;
    if (next) await db.from("wa_calls").update({ status: next, updated_at: now }).eq("id", call.id);
  }

  for (const e of batch.calls) {
    if (e.event === "connect" && e.direction === "USER_INITIATED") {
      // Cliente ligando: cria a chamada e avisa a equipe (tela de atender)
      const wa = (e.from ?? "").replace(/\D/g, "");
      if (!wa || !e.sdp) continue;
      const { data: conv } = await db.from("conversations").select("id, lead_id").eq("channel_id", channelId).in("wa_id", brVariants(wa)).maybeSingle();
      await db.from("wa_calls").upsert({
        organization_id: ch.organization_id, channel_id: channelId, conversation_id: conv?.id ?? null, lead_id: conv?.lead_id ?? null,
        wa_id: wa, contact_name: batch.contactName, wa_call_id: e.id, direction: "in", status: "ringing", sdp_offer: e.sdp, recording_mode: ch.call_recording === "browser" ? "browser" : "meta",
      }, { onConflict: "channel_id,wa_call_id", ignoreDuplicates: true });
      continue;
    }

    const call = await findCall(channelId, e.id, e.opaque);
    if (!call) continue;

    if (e.event === "connect" && e.sdp && e.sdpType === "answer") {
      await db.from("wa_calls").update({ sdp_answer: e.sdp, status: "connected", started_at: call.started_at ?? now, wa_call_id: call.wa_call_id ?? e.id, updated_at: now }).eq("id", call.id);
    } else if (e.event === "terminate") {
      const connected = !!e.duration || !!e.startTime || call.status === "connected";
      const status = e.status === "FAILED" ? "failed"
        : connected ? "completed"
          : call.status === "rejected" ? "rejected"
            : call.status === "canceled" ? "canceled" : "missed";
      const { data: upd } = await db.from("wa_calls").update({
        status, duration_s: e.duration ?? null, error: e.error,
        started_at: e.startTime ? new Date(e.startTime * 1000).toISOString() : call.started_at,
        ended_at: e.endTime ? new Date(e.endTime * 1000).toISOString() : now, updated_at: now,
      }).eq("id", call.id).in("status", LIVE.concat(["rejected", "canceled"])).select("id");
      // Registra no histórico do lead uma única vez
      if (upd?.length) await logActivity(call, connected, e.duration);
    } else if (e.event === "call_recording_available" && e.recording) {
      const token = ch.secrets.meta_access_token;
      if (!token) continue;
      const file = await mc.downloadRecording(token, e.recording.url, e.recording.id);
      const ext = file.mime.includes("mpeg") ? "mp3" : file.mime.includes("mp4") ? "m4a" : file.mime.includes("webm") ? "webm" : "ogg";
      const path = `${call.organization_id}/${call.id}.${ext}`;
      const up = await db.storage.from(CALLS_BUCKET).upload(path, Buffer.from(file.data), { contentType: file.mime, upsert: true });
      if (up.error) throw up.error;
      await db.from("wa_calls").update({ recording_path: path, recording_mime: file.mime, updated_at: now }).eq("id", call.id);
    }
  }
}

/** Ligações que ficaram "tocando" sem resposta do webhook viram falha (evita botão travado). */
export async function expireStale(orgId: string) {
  await supabaseAdmin().from("wa_calls").update({ status: "failed", error: "Sem resposta do WhatsApp", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId).in("status", ["starting", "ringing", "accepting"]).lt("created_at", new Date(Date.now() - 3 * 60_000).toISOString());
}

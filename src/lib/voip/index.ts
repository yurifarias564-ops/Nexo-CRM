import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { CALLS_BUCKET } from "@/lib/calls";
import * as a4 from "./api4com";

export interface VoipOrg { organization_id: string; domain: string | null; gateway: string; api_token: string; webhook_key: string }

/** Configuração + segredos da central da empresa (só no servidor). */
export async function loadVoip(orgId: string): Promise<VoipOrg> {
  const db = supabaseAdmin();
  const [{ data: s }, { data: sec }] = await Promise.all([
    db.from("voip_settings").select("organization_id, domain, gateway").eq("organization_id", orgId).maybeSingle(),
    db.from("voip_secrets").select("api_token, webhook_key").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!s || !sec) throw new HttpError(409, "A telefonia ainda não foi conectada. Um administrador conecta em Configurações → Integrações → Telefonia.");
  return { ...s, ...sec };
}

export async function myExtension(orgId: string, userId: string) {
  const { data } = await supabaseAdmin().from("voip_extensions").select("id, ramal, domain").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  return data;
}

const MAX_REC = 100 * 1024 * 1024;

/** Baixa a gravação da central e guarda para sempre no armazenamento do CRM. */
export async function storeRecording(orgId: string, callId: string, url: string): Promise<string | null> {
  if (!a4.trustedRecordingUrl(url)) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
      if (res.status === 404 && attempt < 2) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      if (!res.ok) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_REC) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_REC) return null;
      const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      const mime = ct.startsWith("audio/") ? ct : "audio/mpeg";
      const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
      const path = `${orgId}/voip/${callId}.${ext}`;
      const up = await supabaseAdmin().storage.from(CALLS_BUCKET).upload(path, buf, { contentType: mime, upsert: true });
      if (up.error) return null;
      return `${path}|${mime}`;
    } catch {
      if (attempt === 2) return null;
    }
  }
  return null;
}

/** Fim da ligação (webhook): situação, duração, gravação e histórico do lead. */
export async function handleHangup(v: VoipOrg, ev: a4.HangupEvent): Promise<{ id: string } | null> {
  const db = supabaseAdmin();
  const rowId = ev.metadata.callRowId;
  let q = db.from("wa_calls").select("id, organization_id, lead_id, started_by, status, recording_path").eq("organization_id", v.organization_id).eq("kind", "voip");
  q = rowId && /^[0-9a-f-]{36}$/i.test(rowId) ? q.eq("id", rowId) : q.eq("voip_call_id", ev.id);
  const { data: call } = await q.maybeSingle();
  if (!call) return null;

  const answered = Boolean(ev.answeredAt) && (ev.duration ?? 0) > 0;
  const cause = (ev.hangupCause ?? "").toUpperCase();
  const status = answered ? "completed" : /BUSY|REJECT|DECLINE/.test(cause) ? "rejected" : /NO_ANSWER|NO_USER|TIMEOUT|CANCEL|ORIGINATOR/.test(cause) ? "missed" : "failed";
  const toIso = (s: string | null) => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
  const startedAt = toIso(ev.answeredAt) ?? toIso(ev.startedAt);
  const endedAt = toIso(ev.endedAt) ?? new Date().toISOString();
  const duration = answered ? ev.duration : 0;

  const wasLive = ["starting", "ringing", "accepting", "connected"].includes(call.status);
  await db.from("wa_calls").update({
    status, voip_call_id: ev.id, started_at: startedAt, ended_at: endedAt, duration_s: duration,
    hangup_cause: ev.hangupCause?.slice(0, 80) ?? null, updated_at: new Date().toISOString(),
  }).eq("id", call.id);

  if (answered && ev.recordUrl && !call.recording_path) {
    const stored = await storeRecording(v.organization_id, call.id, ev.recordUrl);
    if (stored) {
      const [path, mime] = stored.split("|");
      await db.from("wa_calls").update({ recording_path: path, recording_mime: mime, updated_at: new Date().toISOString() }).eq("id", call.id);
    } else {
      await db.from("wa_calls").update({ error: "Gravação ainda não disponível na central", updated_at: new Date().toISOString() }).eq("id", call.id);
    }
  }

  // Histórico do lead (conta nas Ligações do time e nos relatórios) — uma vez só
  if (wasLive && call.lead_id) {
    await db.from("activities").insert({
      organization_id: v.organization_id, lead_id: call.lead_id, actor_id: call.started_by, type: "call",
      payload: {
        outcome: answered ? "atendeu" : "nao_atendeu", duration_min: duration ? Math.round((duration / 60) * 10) / 10 : null,
        via: "telefone", direction: "out", call_id: call.id, notes: null,
      },
    });
  }
  return { id: call.id };
}

/** Ligações VoIP que nunca receberam o fim da central (ex.: webhook perdido). */
export async function expireStaleVoip(orgId: string) {
  await supabaseAdmin().from("wa_calls").update({ status: "failed", error: "A central não informou o fim da ligação", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId).eq("kind", "voip").in("status", ["starting", "ringing", "accepting", "connected"])
    .lt("created_at", new Date(Date.now() - 4 * 3600_000).toISOString());
}

import "server-only";
import { envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";

// Calling API da Meta (WhatsApp Cloud API). A Meta só faz a sinalização (SDP);
// o áudio flui por WebRTC direto entre o navegador do atendente e o WhatsApp.

const graph = () => `https://graph.facebook.com/${envOptional("META_GRAPH_VERSION", "v23.0")}`;

interface GraphError { error?: { message?: string; code?: number; error_data?: { details?: string } } }

async function graphCall<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${graph()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as GraphError & T;
  if (!res.ok) {
    const code = body.error?.code;
    const err = new HttpError(res.status >= 500 ? 502 : 422, friendly(code, body.error?.error_data?.details ?? body.error?.message));
    if (code === 138006) Object.assign(err, { code: "no_permission" });
    throw err;
  }
  return body;
}

function friendly(code: number | undefined, msg?: string): string {
  // 138006 é o único código documentado que tratamos à parte; o resto mostra a mensagem da Meta.
  if (code === 138006) return "O cliente ainda não deu permissão para receber ligações. Peça a permissão primeiro.";
  return `WhatsApp: ${msg ?? "erro na ligação"}`;
}

export interface RecordingOpts { purpose: string }
const recording = (r?: RecordingOpts | null) =>
  r ? { recording: { status: "ENABLED", purpose: r.purpose.slice(0, 250), announcement_language: "pt" } } : {};

/** Liga para o cliente (oferta SDP do navegador). Devolve o id da chamada na Meta. */
export async function startCall(phoneNumberId: string, token: string, to: string, sdp: string, opaque: string, rec?: RecordingOpts | null): Promise<string> {
  const r = await graphCall<{ calls?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/calls`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp", to, action: "connect",
      session: { sdp_type: "offer", sdp }, biz_opaque_callback_data: opaque, ...recording(rec),
    }),
  });
  const id = r.calls?.[0]?.id;
  if (!id) throw new HttpError(502, "WhatsApp não retornou o id da ligação");
  return id;
}

/** Atender (pre_accept + accept), recusar ou encerrar. */
export async function callAction(
  phoneNumberId: string, token: string, callId: string, action: "pre_accept" | "accept" | "reject" | "terminate",
  sdp?: string, rec?: RecordingOpts | null, opaque?: string,
): Promise<void> {
  await graphCall(`/${encodeURIComponent(phoneNumberId)}/calls`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp", call_id: callId, action,
      ...(sdp ? { session: { sdp_type: "answer", sdp } } : {}),
      ...(action === "accept" ? { ...recording(rec), ...(opaque ? { biz_opaque_callback_data: opaque } : {}) } : {}),
    }),
  });
}

export interface CallPermission {
  status: "no_permission" | "temporary" | "permanent";
  expiresAt: string | null;
  canCall: boolean;
  canRequest: boolean;
  callLimitUntil: string | null;
}

/** Situação da permissão do cliente para receber ligações. */
export async function getPermission(phoneNumberId: string, token: string, waId: string): Promise<CallPermission> {
  type Limit = { limit_expiration_time?: number };
  const r = await graphCall<{
    permission?: { status?: string; expiration_time?: number; expiration?: number };
    actions?: { action_name?: string; can_perform_action?: boolean; limits?: Limit[] }[];
  }>(`/${encodeURIComponent(phoneNumberId)}/call_permissions?user_wa_id=${encodeURIComponent(waId)}`, token);
  const action = (n: string) => r.actions?.find((a) => a.action_name === n);
  const exp = r.permission?.expiration_time ?? r.permission?.expiration;
  const st = r.permission?.status;
  const limitTs = action("start_call")?.limits?.find((l) => l.limit_expiration_time)?.limit_expiration_time;
  return {
    status: st === "temporary" || st === "permanent" ? st : "no_permission",
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    canCall: action("start_call")?.can_perform_action ?? (st === "temporary" || st === "permanent"),
    canRequest: action("send_call_permission_request")?.can_perform_action ?? true,
    callLimitUntil: limitTs ? new Date(limitTs * 1000).toISOString() : null,
  };
}

/** Envia o pedido de permissão (botão nativo do WhatsApp). Precisa da janela de 24h aberta. */
export async function requestPermission(phoneNumberId: string, token: string, to: string, text: string): Promise<string> {
  const r = await graphCall<{ messages?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
      interactive: { type: "call_permission_request", action: { name: "call_permission_request" }, body: { text: text.slice(0, 1024) } },
    }),
  });
  const id = r.messages?.[0]?.id;
  if (!id) throw new HttpError(502, "WhatsApp não retornou o id da mensagem");
  return id;
}

/** Ativa/desativa ligações no número (ícone de ligação e permissão após o cliente ligar). */
export async function setCallingEnabled(phoneNumberId: string, token: string, enabled: boolean): Promise<void> {
  await graphCall(`/${encodeURIComponent(phoneNumberId)}/settings`, token, {
    method: "POST",
    body: JSON.stringify({
      calling: enabled
        ? { status: "ENABLED", call_icon_visibility: "DEFAULT", callback_permission_status: "ENABLED" }
        : { status: "DISABLED" },
    }),
  });
}

/** Baixa um áudio (gravação) pelo link do webhook ou pelo id de mídia. */
export async function downloadRecording(token: string, url: string | null, mediaId: string | null): Promise<{ data: ArrayBuffer; mime: string }> {
  let link = url;
  let mime = "audio/ogg";
  if (!link && mediaId) {
    const meta = await graphCall<{ url: string; mime_type: string }>(`/${encodeURIComponent(mediaId)}`, token);
    link = meta.url;
    mime = meta.mime_type || mime;
  }
  if (!link) throw new HttpError(502, "Gravação sem link");
  const res = await fetch(link, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new HttpError(502, "Falha ao baixar a gravação");
  return { data: await res.arrayBuffer(), mime: res.headers.get("content-type")?.split(";")[0] || mime };
}

// ----------------------------------------------------------------------------- webhook

export interface CallEvent {
  id: string; event: string; direction: "BUSINESS_INITIATED" | "USER_INITIATED" | string; from: string | null; to: string | null;
  sdp: string | null; sdpType: string | null; status: string | null; duration: number | null; startTime: number | null; endTime: number | null;
  opaque: string | null; error: string | null; recording: { id: string | null; url: string | null; mime: string | null } | null;
}
export interface CallStatus { id: string; status: string }
export interface PermissionReply { waId: string; response: "accept" | "reject"; expiresAt: string | null; permanent: boolean }
export interface CallBatch { phoneNumberId: string; contactName: string | null; calls: CallEvent[]; statuses: CallStatus[]; permissions: PermissionReply[] }

export function parseCallWebhook(payload: unknown): CallBatch[] {
  const out: CallBatch[] = [];
  const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as { changes?: { field?: string; value?: Record<string, unknown> }[] }[];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberId = (v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
      if (!phoneNumberId) continue;
      const contact = ((v.contacts ?? []) as { profile?: { name?: string } }[])[0];
      const batch: CallBatch = { phoneNumberId, contactName: contact?.profile?.name ?? null, calls: [], statuses: [], permissions: [] };
      const errs = (v.errors ?? []) as { message?: string; error_data?: { details?: string } }[];

      if (change.field === "calls") {
        for (const c of (v.calls ?? []) as Record<string, unknown>[]) {
          if (typeof c.id !== "string") continue;
          const session = (c.session ?? null) as { sdp_type?: string; sdp?: string } | null;
          const rec = (c.call_recording ?? null) as { audio?: { id?: string; url?: string; mime_type?: string } } | null;
          const n = (x: unknown) => (x === undefined || x === null || x === "" ? null : Number(x));
          batch.calls.push({
            id: c.id, event: String(c.event ?? ""), direction: String(c.direction ?? ""),
            from: (c.from as string) ?? null, to: (c.to as string) ?? null,
            sdp: session?.sdp ?? null, sdpType: session?.sdp_type ?? null,
            status: (c.status as string) ?? null, duration: n(c.duration), startTime: n(c.start_time), endTime: n(c.end_time),
            opaque: (c.biz_opaque_callback_data as string) ?? null,
            error: errs[0] ? (errs[0].error_data?.details ?? errs[0].message ?? null) : null,
            recording: rec ? { id: rec.audio?.id ?? null, url: rec.audio?.url ?? null, mime: rec.audio?.mime_type ?? null } : null,
          });
        }
        for (const s of (v.statuses ?? []) as { id?: string; type?: string; status?: string }[]) {
          if (s.id && s.type === "call" && s.status) batch.statuses.push({ id: s.id, status: s.status.toUpperCase() });
        }
      } else if (change.field === "messages") {
        for (const m of (v.messages ?? []) as { from?: string; type?: string; interactive?: Record<string, unknown> }[]) {
          if (m.type !== "interactive" || !m.from) continue;
          const i = m.interactive ?? {};
          if (i.type !== "call_permission_reply") continue;
          const r = (i.call_permission_reply ?? {}) as { response?: string; expiration_timestamp?: number | string; is_permanent?: boolean };
          if (r.response !== "accept" && r.response !== "reject") continue;
          batch.permissions.push({
            waId: m.from, response: r.response, permanent: !!r.is_permanent,
            expiresAt: r.expiration_timestamp ? new Date(Number(r.expiration_timestamp) * 1000).toISOString() : null,
          });
        }
      }
      if (batch.calls.length || batch.statuses.length || batch.permissions.length) out.push(batch);
    }
  }
  return out;
}

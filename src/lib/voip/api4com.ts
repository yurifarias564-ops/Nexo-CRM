import "server-only";
import { HttpError } from "@/lib/http";

// Central de telefonia Api4Com (https://developers.api4com.com)
export const API4COM_BASE = "https://api.api4com.com/api/v1";

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API4COM_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, "A central de telefonia (Api4Com) não respondeu. Tente de novo.");
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 401 || res.status === 403) throw new HttpError(422, "Token da Api4Com inválido ou sem permissão.");
  if (res.status === 429) throw new HttpError(429, "Muitas ligações seguidas na Api4Com. Aguarde alguns segundos.");
  if (!res.ok) {
    const msg = (data as { error?: { message?: string }; message?: string } | null)?.error?.message ?? (data as { message?: string } | null)?.message;
    throw new HttpError(502, `Api4Com: ${msg ?? `erro ${res.status}`}`);
  }
  return data as T;
}

/** Número no formato que a central aceita: +55DDDNÚMERO. */
export function e164(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^\d{12,15}$/.test(d)) throw new HttpError(422, "Telefone do lead inválido para ligação.");
  return `+${d}`;
}

/** Cadastra o webhook da empresa (fim de ligação, com a gravação). Também valida o token. */
export async function registerWebhook(token: string, gateway: string, webhookUrl: string) {
  await call(token, "/integrations", {
    method: "PATCH",
    body: {
      gateway,
      webhook: true,
      webhookConstraint: { metadata: { gateway } },
      metadata: { webhookUrl, webhookVersion: "v1.4", webhookTypes: ["channel-hangup"] },
    },
  });
}

export interface Api4ComExtension { id?: number | string; ramal: string | number; senha?: string; domain?: string; bina?: string }

/** Cria o próximo ramal livre já com gravação ligada. */
export async function createExtension(token: string, u: { firstName: string; lastName: string; email: string; sipPass: string }): Promise<Api4ComExtension> {
  const r = await call<Api4ComExtension>(token, "/extensions/next-available", {
    method: "POST",
    body: { first_name: u.firstName.slice(0, 40), last_name: (u.lastName || "-").slice(0, 40), email_address: u.email, senha: u.sipPass, gravar_audio: 1 },
  });
  if (!r || r.ramal === undefined || r.ramal === null) throw new HttpError(502, "A Api4Com não devolveu o ramal criado.");
  return r;
}

/** Click-to-call: a central chama o ramal do vendedor e, ao atender, disca para o lead. */
export async function startCall(token: string, p: { extension: string; called: string; metadata: Record<string, string> }): Promise<{ id: string }> {
  const r = await call<{ id?: string | number; status?: string; message?: string }>(token, "/calls", {
    method: "POST",
    body: { extension: p.extension, caller: p.extension, called: p.called, metadata: p.metadata },
  });
  if (r?.id === undefined || r.id === null) throw new HttpError(502, r?.message ? `Api4Com: ${r.message}` : "A Api4Com não iniciou a ligação.");
  return { id: String(r.id) };
}

/** Encerra uma ligação em andamento. */
export async function hangup(token: string, id: string) {
  await call(token, `/calls/${encodeURIComponent(id)}/hangup`, { method: "POST", body: {} });
}

// ---------------------------------------------------------------------------
// Webhook "channel-hangup" (v1.4)

export interface HangupEvent {
  id: string;
  direction: string | null;
  recordUrl: string | null;
  duration: number | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  hangupCause: string | null;
  metadata: Record<string, string>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function parseHangup(body: unknown): HangupEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.eventType !== "channel-hangup") return null;
  const id = str(b.id);
  if (!id) return null;
  const meta: Record<string, string> = {};
  if (b.metadata && typeof b.metadata === "object") {
    for (const [k, v] of Object.entries(b.metadata as Record<string, unknown>)) {
      const s = str(v);
      if (s) meta[k] = s.slice(0, 200);
    }
  }
  const dur = Number(b.duration);
  const rec = str(b.recordUrl);
  return {
    id,
    direction: str(b.direction),
    recordUrl: rec && /^https:\/\//.test(rec) ? rec : null,
    duration: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null,
    startedAt: str(b.startedAt),
    answeredAt: str(b.answeredAt),
    endedAt: str(b.endedAt),
    hangupCause: str(b.hangupCause),
    metadata: meta,
  };
}

/**
 * A gravação pode vir de um armazenamento da central (CDN/S3). O webhook já exige
 * a chave secreta da empresa; aqui só barramos endereços internos/sem HTTPS.
 */
export function trustedRecordingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return false; // IP literal
    return h.includes(".");
  } catch {
    return false;
  }
}

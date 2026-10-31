import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/http";
import { appUrl, envOptional } from "@/lib/env";
import { cronSecret } from "@/lib/cron";

// Instagram Direct pela "API do Instagram com login do Instagram" (Meta).
// Cada loja conecta a própria conta profissional; as mensagens entram nas Conversas como um canal.

const GRAPH = "https://graph.instagram.com/v24.0";
export const IG_PREFIX = "ig:";

export function igConfig() {
  const appId = envOptional("INSTAGRAM_APP_ID");
  const secret = envOptional("INSTAGRAM_APP_SECRET");
  return appId && secret ? { appId, secret } : null;
}
export const igRedirectUri = () => `${appUrl()}/api/instagram/callback`;
/** Código que a Meta manda de volta na verificação do webhook (derivado do segredo do servidor). */
export const igVerifyToken = () => envOptional("INSTAGRAM_VERIFY_TOKEN") || createHmac("sha256", `${cronSecret()}:ig-verify`).update("v1").digest("hex").slice(0, 32);

/** "state" assinado do login: diz para qual empresa a conta vai (e expira em 15 min). */
export function signState(orgId: string, userId: string) {
  const payload = Buffer.from(JSON.stringify({ o: orgId, u: userId, t: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", `${cronSecret()}:ig-state`).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function readState(state: string): { orgId: string; userId: string } {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) throw new HttpError(400, "Login inválido");
  const want = createHmac("sha256", `${cronSecret()}:ig-state`).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, "Login inválido");
  const j = JSON.parse(Buffer.from(payload, "base64url").toString()) as { o: string; u: string; t: number };
  if (Date.now() - j.t > 15 * 60_000) throw new HttpError(400, "O login expirou. Tente de novo.");
  return { orgId: j.o, userId: j.u };
}

export function authorizeUrl(state: string) {
  const c = igConfig();
  if (!c) throw new HttpError(409, "A integração com o Instagram ainda não foi ativada na plataforma");
  const q = new URLSearchParams({
    client_id: c.appId, redirect_uri: igRedirectUri(), response_type: "code", state,
    scope: "instagram_business_basic,instagram_business_manage_messages", enable_fb_login: "0",
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

async function j<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; type?: string; code?: number } | string; error_message?: string; error_type?: string };
  if (!res.ok) {
    const e = body.error;
    const msg = body.error_message ?? (typeof e === "string" ? e : e?.message) ?? `erro ${res.status}`;
    console.error("[instagram api]", res.status, JSON.stringify(body).slice(0, 400));
    throw new HttpError(res.status >= 500 ? 502 : 422, `Instagram: ${msg}`);
  }
  return body;
}

/** Código do login → token de longa duração (60 dias) + dados da conta. */
export async function exchangeCode(code: string) {
  const c = igConfig()!;
  const form = new URLSearchParams({ client_id: c.appId, client_secret: c.secret, grant_type: "authorization_code", redirect_uri: igRedirectUri(), code });
  const short = await j<{ access_token: string; user_id: number | string }>(await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form, signal: AbortSignal.timeout(20_000) }));
  const long = await j<{ access_token: string; expires_in: number }>(await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(c.secret)}&access_token=${encodeURIComponent(short.access_token)}`, { signal: AbortSignal.timeout(20_000) }));
  const me = await j<{ user_id: string; username: string; name?: string }>(await fetch(`${GRAPH}/me?fields=user_id,username,name&access_token=${encodeURIComponent(long.access_token)}`, { signal: AbortSignal.timeout(20_000) }));
  return { token: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000), userId: String(me.user_id), username: me.username, name: me.name ?? null };
}

/** Renova o token (vale mais 60 dias). */
export async function refreshToken(token: string) {
  const r = await j<{ access_token: string; expires_in: number }>(await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) }));
  return { token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
}

/** Liga o aviso de mensagens novas desta conta para o nosso webhook. */
export async function subscribe(token: string) {
  await j(await fetch(`${GRAPH}/me/subscribed_apps?subscribed_fields=messages,messaging_seen&access_token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(20_000) }));
}

/** Nome e @ de quem mandou a mensagem. */
export async function profile(token: string, igsid: string): Promise<{ name: string | null; username: string | null; pic: string | null }> {
  try {
    const p = await j<{ name?: string; username?: string; profile_pic?: string }>(await fetch(`${GRAPH}/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) }));
    return { name: p.name ?? null, username: p.username ?? null, pic: p.profile_pic ?? null };
  } catch { return { name: null, username: null, pic: null }; }
}

export const igsidOf = (waId: string) => (waId.startsWith(IG_PREFIX) ? waId.slice(IG_PREFIX.length) : waId);

/** Envia texto no Direct. Devolve o id da mensagem. */
export async function sendText(token: string, waId: string, text: string): Promise<string> {
  const r = await j<{ message_id: string }>(await fetch(`${GRAPH}/me/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: igsidOf(waId) }, message: { text: text.slice(0, 1000) } }), signal: AbortSignal.timeout(20_000),
  }));
  return r.message_id;
}

/** Envia foto, vídeo ou áudio (o Instagram baixa pelo link). */
export async function sendMedia(token: string, waId: string, kind: "image" | "video" | "audio" | "file", url: string): Promise<string> {
  const r = await j<{ message_id: string }>(await fetch(`${GRAPH}/me/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: igsidOf(waId) }, message: { attachment: { type: kind, payload: { url } } } }), signal: AbortSignal.timeout(30_000),
  }));
  return r.message_id;
}

/** Confere a assinatura do aviso (X-Hub-Signature-256) com o segredo do app. */
export function validSignature(raw: string, header: string | null) {
  const c = igConfig();
  if (!c || !header?.startsWith("sha256=")) return false;
  const want = `sha256=${createHmac("sha256", c.secret).update(raw).digest("hex")}`;
  const a = Buffer.from(header), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Link de mídia do Instagram/Meta que o CRM pode baixar (evita usar o servidor para buscar qualquer endereço). */
export function isIgMediaUrl(u: string) {
  try {
    const h = new URL(u);
    return h.protocol === "https:" && /(^|\.)(cdninstagram\.com|fbcdn\.net|fbsbx\.com)$/.test(h.hostname);
  } catch { return false; }
}

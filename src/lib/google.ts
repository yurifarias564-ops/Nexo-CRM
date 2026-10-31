import "server-only";
import { randomBytes } from "node:crypto";
import { appUrl, env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Google Agenda via OAuth 2.0 (escopo mínimo: criar/editar eventos).
 * As credenciais ficam em public.google_credentials, tabela sem políticas
 * de acesso: só o servidor lê.
 */

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
export const OAUTH_STATE_COOKIE = "g_oauth_state";

const redirectUri = () => `${appUrl()}/api/google/callback`;

export function newState() {
  return randomBytes(24).toString("hex");
}

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type GrantResponse = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string };

async function grantRequest(params: Record<string, string>): Promise<GrantResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), ...params }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as GrantResponse;
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new HttpError(409, "A conexão com o Google expirou. Reconecte em Configurações → Integrações.");
    throw new HttpError(502, `Google: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body;
}

function emailFromIdToken(idToken: string | undefined): string | null {
  // O id_token veio direto do Google por TLS na troca do código; só lemos o e-mail.
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/** Troca o código do OAuth e salva a conexão do usuário. */
export async function completeConnection(userId: string, code: string) {
  const r = await grantRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!r.scope?.includes("calendar.events")) throw new HttpError(422, "É preciso permitir o acesso à agenda para conectar.");
  if (!r.refresh_token) throw new HttpError(422, "O Google não devolveu acesso permanente. Tente conectar de novo.");
  const db = supabaseAdmin();
  const conn = await db.from("google_connections").upsert(
    { user_id: userId, google_email: emailFromIdToken(r.id_token), connected_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (conn.error) throw conn.error;
  const cred = await db.from("google_credentials").upsert({
    user_id: userId,
    refresh_grant: r.refresh_token,
    access_grant: r.access_token ?? null,
    access_expires_at: r.expires_in ? new Date(Date.now() + (r.expires_in - 60) * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (cred.error) throw cred.error;
}

export async function disconnect(userId: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("google_credentials").select("refresh_grant").eq("user_id", userId).maybeSingle();
  if (data?.refresh_grant) {
    await fetch(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token: data.refresh_grant })}`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  const del = await db.from("google_connections").delete().eq("user_id", userId);
  if (del.error) throw del.error;
}

/** Acesso válido do usuário (renova automaticamente). null = não conectado. */
async function accessFor(userId: string): Promise<{ bearer: string; calendarId: string } | null> {
  const db = supabaseAdmin();
  const [{ data: conn }, { data: cred }] = await Promise.all([
    db.from("google_connections").select("calendar_id").eq("user_id", userId).maybeSingle(),
    db.from("google_credentials").select("refresh_grant, access_grant, access_expires_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (!conn || !cred) return null;
  if (cred.access_grant && cred.access_expires_at && new Date(cred.access_expires_at).getTime() > Date.now()) {
    return { bearer: cred.access_grant, calendarId: conn.calendar_id };
  }
  const r = await grantRequest({ grant_type: "refresh_token", refresh_token: cred.refresh_grant });
  if (!r.access_token) throw new HttpError(502, "Google não renovou o acesso");
  await db.from("google_credentials").update({
    access_grant: r.access_token,
    access_expires_at: new Date(Date.now() + ((r.expires_in ?? 3600) - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return { bearer: r.access_token, calendarId: conn.calendar_id };
}

export async function isConnected(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("google_connections").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

async function calendarCall<T>(bearer: string, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204 || res.status === 410) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? 409 : 502, `Google Agenda: ${body.error?.message ?? res.status}`);
  return body;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  start: string; // ISO UTC
  end: string;
  timeZone: string;
}

/** Cria o evento na agenda do usuário. null = usuário sem Google conectado. */
export async function createEvent(userId: string, ev: CalendarEventInput & { meet?: boolean }): Promise<{ id: string; link: string | null; calendarId: string; meetLink: string | null } | null> {
  const acc = await accessFor(userId);
  if (!acc) return null;
  const r = await calendarCall<{ id: string; htmlLink?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }>(
    acc.bearer, `/calendars/${encodeURIComponent(acc.calendarId)}/events${ev.meet ? "?conferenceDataVersion=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({
        summary: ev.title,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: ev.timeZone },
        end: { dateTime: ev.end, timeZone: ev.timeZone },
        reminders: { useDefault: true },
        source: { title: "Nexo CRM", url: appUrl() },
        ...(ev.meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
      }),
    });
  const meetLink = r.hangoutLink ?? r.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
  return { id: r.id, link: r.htmlLink ?? null, calendarId: acc.calendarId, meetLink };
}

/** Cria uma reunião do Google Meet começando agora. null = usuário sem Google conectado. */
export async function createMeetNow(userId: string, title: string, timeZone: string): Promise<string | null> {
  const acc = await accessFor(userId);
  if (!acc) return null;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 60_000);
  const r = await calendarCall<{ hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }>(
    acc.bearer, `/calendars/${encodeURIComponent(acc.calendarId)}/events?conferenceDataVersion=1`, {
      method: "POST",
      body: JSON.stringify({
        summary: title,
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        source: { title: "Nexo CRM", url: appUrl() },
      }),
    });
  return r.hangoutLink ?? r.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
}

export async function cancelEvent(userId: string, calendarId: string, eventId: string) {
  const acc = await accessFor(userId);
  if (!acc) return;
  await calendarCall(acc.bearer, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

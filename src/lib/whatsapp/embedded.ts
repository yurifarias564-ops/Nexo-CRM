import "server-only";
import { META_APP_ID } from "@/lib/meta-public";
import { env, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";

// Cadastro Incorporado (Embedded Signup v4): o cliente conecta o WhatsApp dele
// numa janela da Meta; aqui o servidor troca o código pelo token da empresa e
// deixa o número pronto (webhooks, registro, ligações).

const graph = () => `https://graph.facebook.com/${envOptional("META_GRAPH_VERSION", "v23.0")}`;

async function g<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${graph()}${path}`, {
    ...rest,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...(rest.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } } & T;
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 422, `Meta: ${body.error?.error_user_msg ?? body.error?.message ?? res.status}`);
  return body;
}

/** Troca o código (vale ~30s) pelo token da empresa do cliente. */
export async function exchangeCode(code: string): Promise<string> {
  const q = new URLSearchParams({ client_id: META_APP_ID, client_secret: env("META_APP_SECRET"), code });
  const r = await g<{ access_token?: string }>(`/oauth/access_token?${q.toString()}`);
  if (!r.access_token) throw new HttpError(502, "A Meta não devolveu o acesso. Tente conectar de novo.");
  return r.access_token;
}

export interface WabaPhone { id: string; display_phone_number?: string; verified_name?: string; platform_type?: string; is_on_biz_app?: boolean }

export async function listPhones(wabaId: string, token: string): Promise<WabaPhone[]> {
  const r = await g<{ data?: WabaPhone[] }>(`/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,is_on_biz_app`, { token });
  return r.data ?? [];
}

export async function subscribe(wabaId: string, token: string) {
  await g(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", token });
}

/** Registra o número na Cloud API (não usar em coexistência). */
export async function register(phoneNumberId: string, token: string, pin: string) {
  await g(`/${encodeURIComponent(phoneNumberId)}/register`, { method: "POST", token, body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
}

/** Coexistência: pede contatos e histórico do app (só uma vez, até 24h após conectar). */
export async function syncBusinessApp(phoneNumberId: string, token: string) {
  for (const sync_type of ["smb_app_state_sync", "history"]) {
    await g(`/${encodeURIComponent(phoneNumberId)}/smb_app_data`, { method: "POST", token, body: JSON.stringify({ messaging_product: "whatsapp", sync_type }) }).catch(() => undefined);
  }
}

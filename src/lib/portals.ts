import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";

// Leads de portais (OLX, Webmotors e qualquer site/Make/Zapier) por um endereço secreto de cada empresa.

const db = () => supabaseAdmin();
const TOKEN = /^[a-f0-9]{40}$/;
export const inboundUrl = (token: string, origem: string) => `${appUrl()}/api/inbound/${token}?origem=${encodeURIComponent(origem)}`;

export async function inboundToken(orgId: string, create = true): Promise<string | null> {
  const { data } = await db().from("inbound_links").select("token").eq("organization_id", orgId).maybeSingle();
  if (data?.token || !create) return data?.token ?? null;
  const token = randomBytes(20).toString("hex");
  const { error } = await db().from("inbound_links").insert({ organization_id: orgId, token });
  if (error && error.code !== "23505") throw error;
  return (await db().from("inbound_links").select("token").eq("organization_id", orgId).single()).data!.token;
}

export async function rotateInbound(orgId: string) {
  const token = randomBytes(20).toString("hex");
  await db().from("inbound_links").upsert({ organization_id: orgId, token, last_used_at: null, received: 0 });
  return token;
}

export async function orgByInbound(token: string) {
  if (!TOKEN.test(token)) throw new HttpError(404, "not found");
  const { data } = await db().from("inbound_links").select("organization_id, received").eq("token", token).maybeSingle();
  if (!data) throw new HttpError(404, "not found");
  return data as { organization_id: string; received: number };
}

// ---------------------------------------------------------------------------------------------
// Formato do lead (aceita OLX, Webmotors e formatos comuns)
// ---------------------------------------------------------------------------------------------

export interface InLead {
  name: string; phone: string | null; email: string | null; message: string | null;
  ad: string | null; adUrl: string | null; vehicle: string | null; price: number | null;
  chatId: string | null; messageId: string | null; listId: string | null; fromSeller: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
function pick(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const path = k.split(".");
    let cur: unknown = o;
    for (const p of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
    const s = str(cur);
    if (s) return s;
  }
  return "";
}

/** Telefone em formato internacional (55 + DDD + número); null se não parecer telefone. */
export function normPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^\d{12,13}$/.test(d) ? d : null;
}

export function parseInbound(body: unknown): InLead {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const lead = (o.lead && typeof o.lead === "object" ? o.lead : o) as Record<string, unknown>;
  const name = pick(lead, "name", "nome", "nomeCliente", "cliente.nome", "customer.name", "contact.name", "buyer.name", "full_name") || "Lead do portal";
  const phone = normPhone(pick(lead, "phone", "telefone", "celular", "phoneNumber", "fone", "whatsapp", "cliente.telefone", "customer.phone", "contact.phone", "buyer.phone"));
  const email = pick(lead, "email", "e-mail", "cliente.email", "customer.email", "contact.email", "buyer.email") || null;
  const message = pick(lead, "message", "mensagem", "textMessage", "comentario", "comments", "observacao", "text") || null;
  const ad = pick(lead, "adTitle", "ad.title", "anuncio.titulo", "anuncio", "titulo", "listTitle", "subject", "veiculo.titulo") || null;
  const vehicle = [pick(lead, "veiculo.marca", "vehicle.make", "brand", "marca"), pick(lead, "veiculo.modelo", "vehicle.model", "model", "modelo"), pick(lead, "veiculo.versao", "vehicle.version", "versao"), pick(lead, "veiculo.ano", "vehicle.year", "ano", "year")].filter(Boolean).join(" ") || null;
  const priceRaw = pick(lead, "price", "preco", "valor", "ad.price", "veiculo.preco", "vehicle.price");
  const price = priceRaw ? Number(priceRaw.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || null : null;
  return {
    name: name.slice(0, 120), phone, email: email?.slice(0, 160) ?? null, message: message?.slice(0, 4000) ?? null,
    ad: ad?.slice(0, 200) ?? null, adUrl: pick(lead, "adUrl", "url", "link", "anuncio.url", "ad.url").slice(0, 500) || null,
    vehicle: vehicle?.slice(0, 200) ?? null, price,
    chatId: pick(o, "chatId") || null, messageId: pick(o, "messageId", "id", "leadId", "lead_id") || null, listId: pick(o, "listId", "adId", "ad.id") || null,
    fromSeller: ["seller", "account"].includes(pick(o, "origin")) && pick(o, "senderType") !== "buyer",
  };
}

/** Grava o lead (ou acha o que já existe pelo telefone/e-mail/chat) e a mensagem no histórico. */
export async function saveInbound(orgId: string, origem: string, l: InLead) {
  // Mesmo chat da OLX: mesmo lead
  let leadId: string | null = null;
  if (l.chatId) leadId = (await db().from("olx_chats").select("lead_id").eq("organization_id", orgId).eq("chat_id", l.chatId).maybeSingle()).data?.lead_id ?? null;
  if (!leadId && l.phone) {
    const alt = l.phone.length === 13 ? l.phone.slice(0, 4) + l.phone.slice(5) : l.phone.length === 12 ? `${l.phone.slice(0, 4)}9${l.phone.slice(4)}` : l.phone;
    leadId = (await db().from("leads").select("id").eq("organization_id", orgId).in("phone", [l.phone, alt]).limit(1).maybeSingle()).data?.id ?? null;
  }
  if (!leadId && l.email) leadId = (await db().from("leads").select("id").eq("organization_id", orgId).ilike("email", l.email).limit(1).maybeSingle()).data?.id ?? null;
  const isNew = !leadId;
  if (!leadId) {
    const { data: stages } = await db().from("stages").select("id, pipeline_id, position, pipelines!inner(position)").eq("organization_id", orgId);
    const first = (stages ?? []).sort((a, b) => (a.pipelines as unknown as { position: number }).position - (b.pipelines as unknown as { position: number }).position || a.position - b.position)[0];
    if (!first) throw new HttpError(409, "A empresa ainda não tem funil");
    const { data: lead, error } = await db().from("leads").insert({
      organization_id: orgId, pipeline_id: first.pipeline_id, stage_id: first.id, name: l.name, phone: l.phone, email: l.email,
      source: origem.slice(0, 60), value: l.price ?? 0,
    }).select("id").single();
    if (error?.code === "23505" && l.phone) leadId = (await db().from("leads").select("id").eq("organization_id", orgId).eq("phone", l.phone).maybeSingle()).data?.id ?? null;
    else if (error) throw error;
    else leadId = lead.id;
  }
  if (!leadId) throw new HttpError(500, "Não consegui criar o lead");
  const fem = ["olx", "webmotors"].includes(origem.toLowerCase());
  const lines = [
    isNew ? `📥 Lead ${fem ? "da" : "do"} ${origem}` : `💬 ${l.fromSeller ? "Resposta enviada" : "Nova mensagem"} ${fem ? "pela" : "pelo"} ${origem}`,
    l.ad || l.vehicle ? `Anúncio: ${[l.ad, l.vehicle].filter(Boolean).join(" — ")}${l.price ? ` · R$ ${l.price.toLocaleString("pt-BR")}` : ""}` : null,
    l.message ? `“${l.message}”` : null,
    l.adUrl ? l.adUrl : null,
    l.email && isNew ? `E-mail: ${l.email}` : null,
  ].filter(Boolean).join("\n");
  await db().from("activities").insert({ organization_id: orgId, lead_id: leadId, actor_id: null, type: "note", payload: { text: lines, via: origem.toLowerCase() } });
  if (l.chatId) {
    await db().from("olx_chats").upsert({ organization_id: orgId, lead_id: leadId, chat_id: l.chatId, last_message_id: l.messageId, list_id: l.listId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,chat_id" });
  }
  return { leadId, isNew };
}

// ---------------------------------------------------------------------------------------------
// OLX (chat): login da loja e resposta pelo CRM
// ---------------------------------------------------------------------------------------------

export function olxConfig() {
  const id = envOptional("OLX_CLIENT_ID"), secret = envOptional("OLX_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
}
export const olxRedirect = () => `${appUrl()}/api/olx/callback`;

export function olxAuthorizeUrl(state: string) {
  const c = olxConfig();
  if (!c) throw new HttpError(409, "A integração com a OLX ainda não foi ativada na plataforma");
  const q = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: olxRedirect(), scope: "basic_user_info chat", state });
  return `https://auth.olx.com.br/oauth?${q}`;
}

export async function olxExchange(code: string): Promise<string> {
  const c = olxConfig()!;
  const res = await fetch("https://auth.olx.com.br/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: olxRedirect(), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new HttpError(422, `OLX: ${j.error ?? `erro ${res.status}`}`);
  return j.access_token;
}

/** Cadastra na OLX o endereço que recebe os chats desta loja. */
export async function olxRegisterWebhook(token: string, url: string) {
  const res = await fetch("https://apps.olx.com.br/autoservice/v1/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ webhook: url }), signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 200 && res.status !== 201) throw new HttpError(422, `OLX recusou o cadastro do chat (${res.status})`);
}

export async function olxUnregister(token: string) {
  await fetch("https://apps.olx.com.br/autoservice/v1/chat", { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
}

export async function olxReply(orgId: string, leadId: string, text: string) {
  const [{ data: acc }, { data: chat }] = await Promise.all([
    db().from("olx_accounts").select("access_token").eq("organization_id", orgId).maybeSingle(),
    db().from("olx_chats").select("chat_id, last_message_id").eq("organization_id", orgId).eq("lead_id", leadId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!acc) throw new HttpError(409, "Conecte a OLX em Configurações → Integrações");
  if (!chat?.last_message_id) throw new HttpError(409, "Este lead não tem chat da OLX para responder");
  const res = await fetch("https://apps.olx.com.br/autoservice/v1/chat/send", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${acc.access_token}` },
    body: JSON.stringify({ textMessage: text.slice(0, 2000), messageId: chat.last_message_id, chatId: chat.chat_id }), signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new HttpError(409, "O acesso à OLX expirou. Conecte de novo em Integrações.");
  if (!res.ok) throw new HttpError(502, `A OLX não aceitou a resposta (${res.status})`);
}

import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { appUrl, env } from "@/lib/env";
import { isValidCpfCnpj } from "@/lib/asaas";
import { displayPixKey, normalizePixKey, type PixKeyType } from "@/lib/pix";
import { feeFor, maskDoc, type PixFeeSettings } from "./fees";

// Pix Nexo: a plataforma abre uma conta de recebimento para a loja (subconta Asaas da conta da plataforma).
// Venda Pix → cai na conta da loja já com a taxa da plataforma separada (split). A loja saca para o banco dela.

const db = () => supabaseAdmin();
const base = () => env("ASAAS_API_URL").replace(/\/+$/, "");
const rootCred = () => env("ASAAS_API_KEY");

async function call<T>(cred: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "User-Agent": "nexo-crm", ["access_token"]: cred, ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { errors?: { description?: string }[] } & T;
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 422, `Pagamentos: ${body.errors?.[0]?.description ?? `erro ${res.status}`}`);
  return body;
}

// ---------------------------------------------------------------------------------------------
// Configuração da plataforma
// ---------------------------------------------------------------------------------------------

export async function pixFeeSettings(): Promise<PixFeeSettings & { wallet: string | null; addonCents: number }> {
  const { data } = await db().from("platform_settings").select("pix_fee_first_cents, pix_fee_after_cents, pix_first_days, pix_addon_cents, platform_wallet_id").eq("id", true).maybeSingle();
  return {
    firstCents: data?.pix_fee_first_cents ?? 10, afterCents: data?.pix_fee_after_cents ?? 100, firstDays: data?.pix_first_days ?? 30,
    addonCents: data?.pix_addon_cents ?? 999, wallet: data?.platform_wallet_id ?? null,
  };
}

/** Carteira da plataforma (para onde vai a taxa). Busca uma vez e guarda. */
export async function platformWallet(): Promise<string> {
  const s = await pixFeeSettings();
  if (s.wallet) return s.wallet;
  const me = await call<{ walletId?: string }>(rootCred(), "/myAccount");
  if (!me.walletId) throw new HttpError(502, "Não consegui ler a carteira da plataforma");
  await db().from("platform_settings").upsert({ id: true, platform_wallet_id: me.walletId, updated_at: new Date().toISOString() });
  return me.walletId;
}

async function isHouseOrg(orgId: string) {
  const { data } = await db().rpc("org_is_house", { org: orgId });
  return data === true;
}

// ---------------------------------------------------------------------------------------------
// Conta da loja
// ---------------------------------------------------------------------------------------------

export type AccountStatus = "awaiting_docs" | "in_review" | "approved" | "rejected";

export async function storeAccount(orgId: string) {
  const [{ data: acc }, { data: sec }] = await Promise.all([
    db().from("org_payment_accounts").select("*").eq("organization_id", orgId).maybeSingle(),
    db().from("org_payment_secrets").select("*").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!acc || !sec) return null;
  return { ...acc, cred: sec["api_key"] as string, webhookToken: sec.webhook_token as string };
}

async function requireAccount(orgId: string) {
  const acc = await storeAccount(orgId);
  if (!acc) throw new HttpError(409, "Ative o Pix Nexo em Finanças primeiro");
  return acc;
}

export const webhookUrl = (orgId: string) => `${appUrl()}/api/webhooks/asaas-loja/${orgId}`;

export interface AccountInput {
  personType: "PF" | "PJ";
  name: string; email: string; doc: string; mobilePhone: string;
  birthDate?: string; companyType?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";
  postalCode: string; address: string; addressNumber: string; complement?: string; province: string;
  incomeValue: number;
}

/** Soma (ou tira) o adicional na mensalidade da loja. */
async function applyAddon(orgId: string, deltaCents: number) {
  if (!deltaCents) return;
  const { data: sub } = await db().from("subscriptions").select("value_cents, asaas_subscription_id").eq("organization_id", orgId).maybeSingle();
  if (!sub?.value_cents) return; // sem mensalidade (cortesia/casa): nada a somar
  const value = Math.max(0, sub.value_cents + deltaCents);
  if (sub.asaas_subscription_id) {
    const { updateSubscription } = await import("@/lib/asaas");
    await updateSubscription(sub.asaas_subscription_id, { value: value / 100 });
  }
  await db().from("subscriptions").update({ value_cents: value, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
}

/** Ativa o Pix Nexo: abre a conta de recebimento da loja e soma o adicional na mensalidade. */
export async function activateStore(orgId: string, userId: string, i: AccountInput) {
  if (await storeAccount(orgId)) return reactivateStore(orgId);
  const doc = i.doc.replace(/\D/g, "");
  if (!isValidCpfCnpj(doc)) throw new HttpError(422, i.personType === "PJ" ? "CNPJ inválido" : "CPF inválido");
  if ((i.personType === "PJ") !== (doc.length === 14)) throw new HttpError(422, i.personType === "PJ" ? "Informe o CNPJ da empresa" : "Informe o CPF");

  const sub = await call<{ id: string; apiKey?: string; walletId?: string }>(rootCred(), "/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: i.name, email: i.email, cpfCnpj: doc, mobilePhone: i.mobilePhone.replace(/\D/g, ""),
      ...(i.personType === "PF" ? { birthDate: i.birthDate } : { companyType: i.companyType }),
      postalCode: i.postalCode.replace(/\D/g, ""), address: i.address, addressNumber: i.addressNumber, complement: i.complement || undefined,
      province: i.province, incomeValue: i.incomeValue,
    }),
  });
  if (!sub.apiKey || !sub.walletId) throw new HttpError(502, "A conta foi criada sem os dados de acesso. Fale com o suporte.");

  const token = randomBytes(24).toString("hex");
  const { error: e1 } = await db().from("org_payment_secrets").insert({ organization_id: orgId, ["api_key"]: sub.apiKey, webhook_token: token });
  if (e1) throw e1;
  const { addonCents } = await pixFeeSettings();
  const fee = (await isHouseOrg(orgId)) ? 0 : addonCents;
  const { error: e2 } = await db().from("org_payment_accounts").insert({
    organization_id: orgId, asaas_account_id: sub.id, wallet_id: sub.walletId, person_type: i.personType, account_name: i.name,
    doc_masked: maskDoc(doc), status: "awaiting_docs", enabled: true, addon_cents: fee, created_by: userId,
  });
  if (e2) throw e2;

  let webhookOk = false;
  try {
    await call(sub.apiKey, "/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: "Nexo CRM", url: webhookUrl(orgId), email: i.email, enabled: true, interrupted: false, apiVersion: 3, authToken: token, sendType: "SEQUENTIALLY",
        events: [
          "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED",
          "TRANSFER_DONE", "TRANSFER_FAILED", "TRANSFER_CANCELLED",
          "ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED", "ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED", "ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING", "ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL",
        ],
      }),
    });
    webhookOk = true;
  } catch (e) {
    console.error("[pix nexo] webhook", (e as Error).message);
  }
  await db().from("org_payment_accounts").update({ webhook_ok: webhookOk }).eq("organization_id", orgId);
  await applyAddon(orgId, fee).catch((e) => console.error("[pix nexo] adicional", (e as Error).message));
  return storeAccount(orgId);
}

/** Liga de novo o recurso numa conta que já existe (volta o adicional). */
export async function reactivateStore(orgId: string) {
  const acc = await requireAccount(orgId);
  if (acc.enabled) return acc;
  const { addonCents } = await pixFeeSettings();
  const fee = (await isHouseOrg(orgId)) ? 0 : addonCents;
  await applyAddon(orgId, fee);
  await db().from("org_payment_accounts").update({ enabled: true, addon_cents: fee, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
  return storeAccount(orgId);
}

/** Desliga o recurso (tira o adicional). A conta continua aberta para a loja sacar o saldo. */
export async function deactivateStore(orgId: string) {
  const acc = await requireAccount(orgId);
  if (!acc.enabled) return;
  await applyAddon(orgId, -acc.addon_cents);
  await db().from("org_payment_accounts").update({ enabled: false, addon_cents: 0, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
}

const GENERAL: Record<string, AccountStatus> = { APPROVED: "approved", REJECTED: "rejected", AWAITING_APPROVAL: "in_review", PENDING: "awaiting_docs" };

/** Situação do cadastro da loja (documentos/aprovação). */
export async function refreshAccountStatus(orgId: string) {
  const acc = await requireAccount(orgId);
  const st = await call<{ general?: string }>(acc.cred, "/myAccount/status");
  const status = GENERAL[st.general ?? ""] ?? (acc.status as AccountStatus);
  let onboarding: string | null = null;
  if (status !== "approved") {
    const docs = await call<{ data?: { status?: string; onboardingUrl?: string | null }[] }>(acc.cred, "/myAccount/documents").catch(() => ({ data: [] }));
    onboarding = docs.data?.find((d) => d.onboardingUrl && d.status !== "APPROVED")?.onboardingUrl ?? null;
  }
  await db().from("org_payment_accounts").update({ status, onboarding_url: onboarding, status_checked_at: new Date().toISOString() }).eq("organization_id", orgId);
  return { status, onboardingUrl: onboarding };
}

export function checkWebhookToken(expected: string, got: string) {
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------------------------
// Saldo, extrato e saques
// ---------------------------------------------------------------------------------------------

export async function balance(orgId: string) {
  const acc = await requireAccount(orgId);
  const r = await call<{ balance?: number }>(acc.cred, "/finance/balance");
  return Number(r.balance ?? 0);
}

export async function statement(orgId: string, limit = 40) {
  const acc = await requireAccount(orgId);
  const r = await call<{ data?: { id: string; value: number; balance?: number; type?: string; date?: string; description?: string }[] }>(acc.cred, `/financialTransactions?limit=${Math.min(100, limit)}`);
  return (r.data ?? []).map((t) => ({ id: t.id, value: Number(t.value), balance: t.balance ?? null, type: t.type ?? "", date: t.date ?? null, description: t.description ?? "" }));
}

const ASAAS_KEY_TYPE: Record<PixKeyType, string> = { cpf: "CPF", cnpj: "CNPJ", phone: "PHONE", email: "EMAIL", random: "EVP" };
/** Depois de trocar a chave de saque, espera este tempo para sacar (proteção contra acesso indevido). */
export const PAYOUT_KEY_COOLDOWN_H = 24;

export async function setPayoutKey(orgId: string, type: PixKeyType, raw: string) {
  const acc = await requireAccount(orgId);
  let key: string;
  try { key = normalizePixKey(type, raw); } catch (e) { throw new HttpError(422, (e as Error).message); }
  if (acc.payout_key === key && acc.payout_key_type === type) return;
  await db().from("org_payment_accounts").update({
    payout_key_type: type, payout_key: key,
    // A 1ª chave vale na hora; trocar depois segura os saques por 24h
    payout_key_changed_at: acc.payout_key ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("organization_id", orgId);
}

export async function withdraw(orgId: string, userId: string | null, value: number | null, auto = false) {
  const acc = await requireAccount(orgId);
  if (acc.status !== "approved") throw new HttpError(409, "A conta ainda não foi aprovada");
  if (!acc.payout_key || !acc.payout_key_type) throw new HttpError(409, "Cadastre a chave Pix do seu banco para receber os saques");
  if (acc.payout_key_changed_at) {
    const until = new Date(acc.payout_key_changed_at).getTime() + PAYOUT_KEY_COOLDOWN_H * 3_600_000;
    if (Date.now() < until) throw new HttpError(409, `Por segurança, depois de trocar a chave Pix os saques ficam liberados em ${PAYOUT_KEY_COOLDOWN_H}h`);
  }
  const available = await balance(orgId);
  const amount = Math.round((value ?? available) * 100) / 100;
  if (amount < 1) throw new HttpError(422, value === null ? "Sem saldo para sacar" : "Valor mínimo de saque: R$ 1,00");
  if (amount > available) throw new HttpError(422, "Valor maior que o saldo disponível");
  const type = acc.payout_key_type as PixKeyType;
  const keyDisplay = displayPixKey(type, acc.payout_key);

  const { data: row, error } = await db().from("payouts").insert({ organization_id: orgId, value: amount, key_display: keyDisplay, auto, requested_by: userId }).select("id").single();
  if (error) throw error;
  try {
    const t = await call<{ id: string; status?: string; failReason?: string }>(acc.cred, "/transfers", {
      method: "POST",
      body: JSON.stringify({
        value: amount, operationType: "PIX", description: "Saque Nexo CRM",
        pixAddressKey: type === "phone" ? acc.payout_key.replace(/^\+55/, "") : acc.payout_key, pixAddressKeyType: ASAAS_KEY_TYPE[type],
      }),
    });
    const status = t.status === "DONE" ? "done" : t.status === "FAILED" ? "failed" : t.status === "CANCELLED" ? "canceled" : "pending";
    await db().from("payouts").update({ asaas_transfer_id: t.id, status, fail_reason: t.failReason ?? null, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { id: row.id as string, value: amount, status, keyDisplay };
  } catch (e) {
    await db().from("payouts").update({ status: "failed", fail_reason: (e as Error).message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", row.id);
    throw e;
  }
}

/** Atualiza a situação do cadastro das contas pendentes e faz o saque automático do fim do dia. */
export async function runPaymentAccountsTick(now = new Date()) {
  const { data: pending } = await db().from("org_payment_accounts").select("organization_id, status_checked_at").in("status", ["awaiting_docs", "in_review"]).limit(50);
  for (const a of pending ?? []) {
    await refreshAccountStatus(a.organization_id).catch((e) => console.error("[pix nexo] status", (e as Error).message));
  }
  // Saque automático: uma vez por dia, a partir das 18h (Brasília)
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(now));
  if (hour < 18) return;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const { data: autos } = await db().from("org_payment_accounts").select("organization_id, last_auto_payout_at").eq("auto_payout", true).eq("status", "approved").limit(200);
  for (const a of autos ?? []) {
    if (a.last_auto_payout_at && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(a.last_auto_payout_at)) === today) continue;
    await db().from("org_payment_accounts").update({ last_auto_payout_at: now.toISOString() }).eq("organization_id", a.organization_id);
    await withdraw(a.organization_id, null, null, true).catch((e) => {
      const msg = (e as Error).message;
      if (!/Sem saldo/.test(msg)) console.error("[pix nexo] saque automático", msg);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Cobrança Pix com split
// ---------------------------------------------------------------------------------------------

export interface PixChargeInput {
  value: number; description?: string | null; payerName: string; payerDoc: string;
  leadId: string | null; conversationId: string | null; userId: string | null; source?: "conversa" | "loja" | "link";
}

export async function createPixCharge(orgId: string, i: PixChargeInput) {
  const acc = await requireAccount(orgId);
  if (!acc.enabled) throw new HttpError(409, "O Pix Nexo está desligado. Ative em Finanças.");
  if (acc.status !== "approved") throw new HttpError(409, "A conta de recebimento ainda está em aprovação. Veja em Finanças.");
  const doc = i.payerDoc.replace(/\D/g, "");
  if (!isValidCpfCnpj(doc)) throw new HttpError(422, "CPF ou CNPJ do cliente inválido");

  // Taxa da plataforma: 1º mês de uso da loja / depois. A conta da própria plataforma não paga taxa.
  const [{ data: org }, fees, house] = await Promise.all([db().from("organizations").select("created_at").eq("id", orgId).single(), pixFeeSettings(), isHouseOrg(orgId)]);
  let wallet: string | null = null;
  if (!house) {
    try { wallet = await platformWallet(); } catch (e) { console.error("[pix nexo] carteira", (e as Error).message); }
  }
  const feeCents = wallet && wallet !== acc.wallet_id ? feeFor(fees, new Date(org!.created_at), new Date(), Math.round(i.value * 100)) : 0;

  // Cliente na conta da loja (reaproveita pelo CPF/CNPJ)
  const found = await call<{ data: { id: string }[] }>(acc.cred, `/customers?cpfCnpj=${doc}&limit=1`);
  const customer = found.data[0]?.id ?? (await call<{ id: string }>(acc.cred, "/customers", {
    method: "POST", body: JSON.stringify({ name: i.payerName.slice(0, 100), cpfCnpj: doc, notificationDisabled: true }),
  })).id;

  const { data: row, error } = await db().from("pix_charges").insert({
    organization_id: orgId, lead_id: i.leadId, conversation_id: i.conversationId, source: i.source ?? "conversa", value: i.value, description: i.description ?? null,
    payer_name: i.payerName, fee_cents: feeCents, fee_status: feeCents ? "pending" : "none", created_by: i.userId,
  }).select("id").single();
  if (error) throw error;

  const due = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 2 * 86_400_000));
  let pay: { id: string };
  try {
    pay = await call<{ id: string }>(acc.cred, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer, billingType: "PIX", value: i.value, dueDate: due, description: (i.description || "Pagamento").slice(0, 400), externalReference: row.id,
        ...(feeCents ? { split: [{ walletId: wallet, fixedValue: feeCents / 100, description: "Nexo CRM" }] } : {}),
      }),
    });
  } catch (e) {
    await db().from("pix_charges").delete().eq("id", row.id);
    throw e;
  }
  const qr = await call<{ payload: string }>(acc.cred, `/payments/${pay.id}/pixQrCode`);
  await db().from("pix_charges").update({ asaas_payment_id: pay.id }).eq("id", row.id);
  return { id: row.id as string, paymentId: pay.id, payload: qr.payload, feeCents };
}

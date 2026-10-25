import "server-only";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

async function asaas<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env("ASAAS_API_URL").replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "nexo-crm",
      access_token: env("ASAAS_API_KEY"),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { errors?: { description?: string }[] } & T;
  if (!res.ok) {
    const msg = body.errors?.[0]?.description ?? `Asaas respondeu ${res.status}`;
    throw new HttpError(res.status >= 500 ? 502 : 422, `Pagamento: ${msg}`);
  }
  return body;
}

export async function createCustomer(input: {
  name: string; cpfCnpj: string; email: string; mobilePhone?: string; externalReference: string;
}) {
  return asaas<{ id: string }>("/customers", { method: "POST", body: JSON.stringify(input) });
}

export async function createSubscription(input: {
  customer: string; valueCents: number; description: string; externalReference: string;
}) {
  const nextDueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); // hoje no Brasil
  return asaas<{ id: string }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: input.customer,
      billingType: "UNDEFINED", // cliente escolhe Pix, boleto ou cartão
      value: input.valueCents / 100,
      nextDueDate,
      cycle: "MONTHLY",
      description: input.description,
      externalReference: input.externalReference,
    }),
  });
}

export async function firstPaymentUrl(subscriptionId: string): Promise<string | null> {
  const r = await asaas<{ data: { invoiceUrl?: string; status: string }[] }>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=10`,
  );
  const open = r.data.find((p) => ["PENDING", "OVERDUE"].includes(p.status)) ?? r.data[0];
  return open?.invoiceUrl ?? null;
}

export async function cancelSubscription(subscriptionId: string) {
  return asaas<{ deleted: boolean }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
}

export interface AsaasSubscription { id: string; status: string; billingType: string; value: number; nextDueDate: string; cycle: string; creditCard?: { creditCardNumber?: string; creditCardBrand?: string } }
export interface AsaasPayment {
  id: string; subscription?: string; status: string; billingType: string; value: number; dueDate: string;
  invoiceUrl?: string; bankSlipUrl?: string; paymentDate?: string | null; clientPaymentDate?: string | null;
  creditCard?: { creditCardNumber?: string; creditCardBrand?: string; creditCardToken?: string };
}

export async function getSubscription(id: string) {
  return asaas<AsaasSubscription>(`/subscriptions/${encodeURIComponent(id)}`);
}

/** Muda vencimento, forma de pagamento ou cartão da assinatura (e das cobranças em aberto). */
export async function updateSubscription(id: string, patch: { nextDueDate?: string; billingType?: string; creditCardToken?: string; value?: number }) {
  return asaas<AsaasSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ ...patch, updatePendingPayments: true }),
  });
}

export async function subscriptionPayments(id: string, limit = 12) {
  const r = await asaas<{ data: AsaasPayment[] }>(`/subscriptions/${encodeURIComponent(id)}/payments?limit=${limit}`);
  return r.data;
}

/** Cobranças em aberto (pendentes ou vencidas) com vencimento no intervalo. */
export async function openPayments(status: "PENDING" | "OVERDUE", from: string, to: string) {
  const out: AsaasPayment[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await asaas<{ data: AsaasPayment[]; hasMore?: boolean }>(`/payments?status=${status}&dueDate%5Bge%5D=${from}&dueDate%5Ble%5D=${to}&limit=100&offset=${offset}`);
    out.push(...r.data);
    if (!r.hasMore) break;
  }
  return out;
}

/** Linha digitável do boleto. */
export async function boletoLine(paymentId: string): Promise<string | null> {
  const r = await asaas<{ identificationField?: string }>(`/payments/${encodeURIComponent(paymentId)}/identificationField`).catch(() => null);
  return r?.identificationField ?? null;
}

/** Pix copia e cola da cobrança. */
export async function pixPayload(paymentId: string): Promise<string | null> {
  const r = await asaas<{ payload?: string }>(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`).catch(() => null);
  return r?.payload ?? null;
}

export function isValidCpfCnpj(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len: number) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len: number) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

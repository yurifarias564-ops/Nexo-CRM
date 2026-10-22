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
  const nextDueDate = new Date().toISOString().slice(0, 10);
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

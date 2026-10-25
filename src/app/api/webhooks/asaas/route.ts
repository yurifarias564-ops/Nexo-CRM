import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { updateSubscription } from "@/lib/asaas";

export const runtime = "nodejs";

type AsaasEvent = {
  id?: string;
  event: string;
  payment?: { id: string; subscription?: string; externalReference?: string; dueDate?: string; status?: string; billingType?: string; creditCard?: { creditCardNumber?: string; creditCardBrand?: string; creditCardToken?: string } };
  subscription?: { id: string; externalReference?: string };
};

const ACTIVATE = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const PAST_DUE = new Set(["PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE"]);
const CANCEL = new Set(["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook do Asaas. Libera o acesso quando o pagamento é confirmado e bloqueia
 * quando vence/estorna/cancela. Idempotente pelo id do evento.
 */
export async function POST(req: Request) {
  const token = req.headers.get("asaas-access-token") ?? "";
  if (!safeEqual(token, env("ASAAS_WEBHOOK_TOKEN"))) {
    return new Response("unauthorized", { status: 401 });
  }

  let evt: AsaasEvent;
  try {
    evt = (await req.json()) as AsaasEvent;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const db = supabaseAdmin();
  const eventId = evt.id ?? `${evt.event}:${evt.payment?.id ?? evt.subscription?.id ?? ""}`;
  const { error: dupErr } = await db.from("webhook_events").insert({ provider: "asaas", event_id: eventId });
  if (dupErr) {
    // 23505 = já processado. Responde 200 para o Asaas não reenviar.
    if (dupErr.code === "23505") return new Response("ok");
    console.error("[asaas] idempotency", dupErr);
    return new Response("error", { status: 500 });
  }

  const subscriptionId = evt.payment?.subscription ?? evt.subscription?.id;
  const orgRef = evt.payment?.externalReference ?? evt.subscription?.externalReference;

  let query = db.from("subscriptions").select("organization_id, current_period_end");
  if (subscriptionId) query = query.eq("asaas_subscription_id", subscriptionId);
  else if (orgRef) query = query.eq("organization_id", orgRef);
  else return new Response("ok");

  const { data: sub } = await query.maybeSingle();
  if (!sub) return new Response("ok");

  const now = new Date().toISOString();
  try {
    if (ACTIVATE.has(evt.event)) {
      // Vigência: vencimento pago + 1 mês + 3 dias de tolerância
      const base = evt.payment?.dueDate ? new Date(`${evt.payment.dueDate}T12:00:00Z`) : new Date();
      const end = new Date(base);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(end.getUTCDate() + 3);
      const current = sub.current_period_end ? new Date(sub.current_period_end) : null;
      const periodEnd = current && current > end ? current : end;
      const p = evt.payment;
      const card = p?.billingType === "CREDIT_CARD" ? p.creditCard : undefined;
      const r = await db.from("subscriptions")
        .update({
          status: "active", current_period_end: periodEnd.toISOString(), updated_at: now,
          ...(p?.billingType ? { billing_type: p.billingType } : {}),
          ...(card ? { card_brand: card.creditCardBrand ?? null, card_last4: card.creditCardNumber?.slice(-4) ?? null } : {}),
        })
        .eq("organization_id", sub.organization_id);
      if (r.error) throw r.error;
      // Pagou com cartão: as próximas mensalidades passam a ser debitadas sozinhas no cartão, no dia do vencimento
      if (card?.creditCardToken && subscriptionId) {
        await updateSubscription(subscriptionId, { billingType: "CREDIT_CARD", creditCardToken: card.creditCardToken })
          .catch((e) => console.error("[asaas] cartão recorrente", e));
      }
    } else if ((evt.event === "PAYMENT_CREATED" || evt.event === "PAYMENT_UPDATED") && evt.payment?.dueDate && ["PENDING", "OVERDUE"].includes(evt.payment.status ?? "PENDING")) {
      await db.from("subscriptions").update({ next_due_date: evt.payment.dueDate, ...(evt.payment.billingType ? { billing_type: evt.payment.billingType } : {}), updated_at: now }).eq("organization_id", sub.organization_id);
    } else if (PAST_DUE.has(evt.event) || CANCEL.has(evt.event)) {
      const status = CANCEL.has(evt.event) ? "canceled" : "past_due";
      const r = await db.from("subscriptions").update({ status, updated_at: now }).eq("organization_id", sub.organization_id);
      if (r.error) throw r.error;
    }
  } catch (e) {
    // Remove a marca de idempotência para o Asaas poder reenviar
    await db.from("webhook_events").delete().eq("provider", "asaas").eq("event_id", eventId);
    console.error("[asaas] update", e);
    return new Response("error", { status: 500 });
  }

  return new Response("ok");
}

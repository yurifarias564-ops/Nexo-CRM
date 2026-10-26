import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkWebhookToken, refreshAccountStatus } from "@/lib/payments/asaas-store";
import { sendText } from "@/lib/send";
import { formatBRL } from "@/lib/utils";

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
type Evt = {
  id?: string; event: string;
  payment?: { id: string; externalReference?: string; value?: number; status?: string };
  transfer?: { id: string; status?: string; failReason?: string };
};

/**
 * Aviso de pagamento do Asaas DA LOJA (cobranças Pix feitas pelo CRM).
 * Pago → confirma a venda no CRM, avisa o cliente na conversa e contabiliza a taxa da plataforma (split).
 */
export async function POST(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!UUID.test(orgId)) return new Response("not found", { status: 404 });
  const db = supabaseAdmin();
  const { data: sec } = await db.from("org_payment_secrets").select("webhook_token").eq("organization_id", orgId).maybeSingle();
  if (!sec || !checkWebhookToken(sec.webhook_token, req.headers.get("asaas-access-token") ?? "")) return new Response("unauthorized", { status: 401 });

  let evt: Evt;
  try { evt = (await req.json()) as Evt; } catch { return new Response("bad request", { status: 400 }); }
  // Situação do cadastro da conta mudou: confere direto na fonte
  if (evt.event?.startsWith("ACCOUNT_STATUS_")) {
    await refreshAccountStatus(orgId).catch((e) => console.error("[pix nexo] status", (e as Error).message));
    return new Response("ok");
  }
  // Saque concluído / falhou / cancelado
  if (evt.transfer?.id && evt.event?.startsWith("TRANSFER_")) {
    const status = evt.event === "TRANSFER_DONE" ? "done" : evt.event === "TRANSFER_FAILED" ? "failed" : evt.event === "TRANSFER_CANCELLED" ? "canceled" : null;
    if (status) await db.from("payouts").update({ status, fail_reason: evt.transfer.failReason ?? null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("asaas_transfer_id", evt.transfer.id);
    return new Response("ok");
  }
  const p = evt.payment;
  if (!p?.id) return new Response("ok");

  // Idempotente: o Asaas pode reenviar o mesmo aviso
  const eventId = `${orgId}:${evt.id ?? `${evt.event}:${p.id}`}`;
  const { error: dup } = await db.from("webhook_events").insert({ provider: "asaas-loja", event_id: eventId });
  if (dup) return dup.code === "23505" ? new Response("ok") : new Response("error", { status: 500 });

  try {
    const { data: ch } = await db.from("pix_charges").select("*").eq("organization_id", orgId).eq("asaas_payment_id", p.id).maybeSingle();
    if (!ch) return new Response("ok"); // cobrança feita fora do CRM: ignora
    const now = new Date().toISOString();
    if (evt.event === "PAYMENT_RECEIVED" || evt.event === "PAYMENT_CONFIRMED") {
      if (ch.status === "paid") return new Response("ok");
      await db.from("pix_charges").update({ status: "paid", paid_at: now, fee_status: ch.fee_cents ? "confirmed" : "none" }).eq("id", ch.id);
      if (ch.lead_id) await db.from("activities").insert({ organization_id: orgId, lead_id: ch.lead_id, actor_id: null, type: "note", payload: { text: `✅ Pix de ${formatBRL(Number(ch.value))} pago${ch.description ? ` — ${ch.description}` : ""}`, via: "pix" } });
      if (ch.conversation_id || ch.lead_id) {
        await sendText(db, orgId, null, ch.conversation_id ? { conversationId: ch.conversation_id } : { leadId: ch.lead_id }, `✅ Pagamento de ${formatBRL(Number(ch.value))} confirmado! Obrigado.`, { automation: true })
          .catch((e) => console.error("[pix loja] aviso", (e as Error).message));
      }
    } else if (evt.event === "PAYMENT_OVERDUE") {
      if (ch.status === "pending") await db.from("pix_charges").update({ status: "overdue" }).eq("id", ch.id);
    } else if (evt.event === "PAYMENT_DELETED" || evt.event === "PAYMENT_REFUNDED") {
      // Estornada/cancelada: a taxa também sai da conta (o Asaas desfaz o split)
      await db.from("pix_charges").update({ status: evt.event === "PAYMENT_REFUNDED" ? "refunded" : "canceled", fee_status: ch.fee_cents ? "canceled" : "none" }).eq("id", ch.id);
    }
  } catch (e) {
    await db.from("webhook_events").delete().eq("provider", "asaas-loja").eq("event_id", eventId);
    console.error("[pix loja] webhook", e);
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}

import { fail, HttpError, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { subscriptionPayments } from "@/lib/asaas";
import { audit, requireHouse, sendPartnerBill } from "@/lib/platform/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Envia agora, no grupo do cliente, a cobrança em aberto mais próxima (boleto + Pix + link). */
export async function POST(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(404, "Não encontrado");
    const ctx = await requireHouse();
    const { data: sub } = await supabaseAdmin().from("subscriptions").select("asaas_subscription_id").eq("organization_id", orgId).maybeSingle();
    if (!sub?.asaas_subscription_id) throw new HttpError(409, "Este cliente não tem assinatura no Asaas.");
    const open = (await subscriptionPayments(sub.asaas_subscription_id, 12))
      .filter((p) => p.status === "PENDING" || p.status === "OVERDUE")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (!open) throw new HttpError(409, "Nenhuma cobrança em aberto agora.");
    await sendPartnerBill(orgId, open, "manual");
    await audit(ctx.userId, orgId, "cobrança enviada no grupo", { vencimento: open.dueDate, valor: open.value });
    return ok({ ok: true, dueDate: open.dueDate, value: open.value });
  } catch (e) {
    return fail(e);
  }
}

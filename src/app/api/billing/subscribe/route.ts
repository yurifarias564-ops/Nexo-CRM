import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createCustomer, createSubscription, firstPaymentUrl, isValidCpfCnpj } from "@/lib/asaas";
import { envOptional } from "@/lib/env";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { normalizePhone } from "@/lib/utils";

const Body = z.object({
  name: z.string().trim().min(3, "Informe o nome completo ou razão social").max(120),
  cpfCnpj: z.string().trim().refine(isValidCpfCnpj, "CPF ou CNPJ inválido"),
  phone: z.string().trim().optional(),
});

/** Cria (ou reaproveita) a assinatura da empresa e devolve o link de pagamento. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ allowInactive: true });
    if (ctx.role !== "owner") throw new HttpError(403, "Apenas o dono da conta pode assinar");
    const body = Body.parse(await readJson(req));
    const db = supabaseAdmin();

    const { data: sub } = await db
      .from("subscriptions")
      .select("status, asaas_customer_id, asaas_subscription_id, checkout_url")
      .eq("organization_id", ctx.org.id)
      .single();

    if (sub?.status === "active") throw new HttpError(409, "A assinatura já está ativa");

    // Reaproveita assinatura existente (evita cobrança duplicada em cliques repetidos)
    if (sub?.asaas_subscription_id) {
      const url = (await firstPaymentUrl(sub.asaas_subscription_id)) ?? sub.checkout_url;
      if (url) {
        await db.from("subscriptions").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);
        return ok({ url });
      }
    }

    const valueCents = Number(envOptional("PLAN_PRICE_CENTS", "19700"));
    if (!Number.isInteger(valueCents) || valueCents < 500) throw new Error("PLAN_PRICE_CENTS inválido");

    const customerId =
      sub?.asaas_customer_id ??
      (
        await createCustomer({
          name: body.name,
          cpfCnpj: body.cpfCnpj.replace(/\D/g, ""),
          email: ctx.email,
          mobilePhone: normalizePhone(body.phone)?.replace(/^55/, "") ?? undefined,
          externalReference: ctx.org.id,
        })
      ).id;

    const saved = await db.from("subscriptions").update({ asaas_customer_id: customerId }).eq("organization_id", ctx.org.id);
    if (saved.error) throw saved.error;

    const created = await createSubscription({
      customer: customerId,
      valueCents,
      description: `${envOptional("PLAN_NAME", "Plano Profissional")} — ${ctx.org.name}`,
      externalReference: ctx.org.id,
    });
    const url = await firstPaymentUrl(created.id);

    const stored = await db
      .from("subscriptions")
      .update({
        asaas_subscription_id: created.id,
        checkout_url: url,
        value_cents: valueCents,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", ctx.org.id);
    if (stored.error) throw stored.error;

    if (!url) throw new HttpError(502, "Assinatura criada, mas o link de pagamento ainda não está disponível. Tente em instantes.");
    return ok({ url });
  } catch (e) {
    return fail(e);
  }
}

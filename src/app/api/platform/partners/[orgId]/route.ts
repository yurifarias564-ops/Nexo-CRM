import { z } from "zod";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSubscription, subscriptionPayments, updateSubscription } from "@/lib/asaas";
import { audit, requireHouse } from "@/lib/platform/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

/** Detalhes do parceiro: assinatura e cobranças no Asaas (ao vivo) e histórico de ações. */
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    if (!UUID.test(orgId)) throw new HttpError(404, "Não encontrado");
    await requireHouse();
    const db = supabaseAdmin();
    const [{ data: sub }, { data: log }] = await Promise.all([
      db.from("subscriptions").select("*").eq("organization_id", orgId).maybeSingle(),
      db.from("platform_audit").select("action, details, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(20),
    ]);
    let asaas: Awaited<ReturnType<typeof getSubscription>> | null = null;
    let payments: Awaited<ReturnType<typeof subscriptionPayments>> = [];
    let asaasError: string | null = null;
    if (sub?.asaas_subscription_id) {
      try {
        [asaas, payments] = await Promise.all([getSubscription(sub.asaas_subscription_id), subscriptionPayments(sub.asaas_subscription_id, 12)]);
      } catch (e) { asaasError = (e as Error).message; }
    }
    return ok({ asaas, payments, asaasError, log: log ?? [] });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("due_date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida") }),
  z.object({ action: z.literal("status"), status: z.enum(["active", "blocked", "courtesy"]) }),
  z.object({ action: z.literal("group"), group_id: z.string().max(100).nullable(), group_name: z.string().max(200).nullable() }),
  z.object({ action: z.literal("notes"), notes: z.string().max(2000) }),
  z.object({ action: z.literal("value"), value_cents: z.number().int().min(500).max(100_000_00) }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    if (!UUID.test(orgId)) throw new HttpError(404, "Não encontrado");
    const ctx = await requireHouse();
    const b = Body.parse(await readJson(req, 10_000));
    const db = supabaseAdmin();
    const { data: org } = await db.from("organizations").select("id").eq("id", orgId).maybeSingle();
    if (!org) throw new HttpError(404, "Empresa não encontrada");
    const { data: sub } = await db.from("subscriptions").select("*").eq("organization_id", orgId).maybeSingle();
    const now = new Date().toISOString();

    if (b.action === "due_date") {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (b.date < todayStr) throw new HttpError(422, "Escolha hoje ou uma data futura");
      if (sub?.asaas_subscription_id) await updateSubscription(sub.asaas_subscription_id, { nextDueDate: b.date });
      // Acesso vale até o novo vencimento + 3 dias de tolerância
      const end = new Date(`${b.date}T23:59:00-03:00`);
      end.setUTCDate(end.getUTCDate() + 3);
      await db.from("subscriptions").upsert({ organization_id: orgId, status: "active", next_due_date: b.date, current_period_end: end.toISOString(), updated_at: now });
      await audit(ctx.userId, orgId, "vencimento alterado", { de: sub?.next_due_date ?? null, para: b.date, asaas: Boolean(sub?.asaas_subscription_id) });
    } else if (b.action === "status") {
      const patch = b.status === "blocked" ? { status: "past_due" } : b.status === "courtesy" ? { status: "active", current_period_end: null } : { status: "active" };
      if (b.status === "active" && sub?.current_period_end && new Date(sub.current_period_end) < new Date()) {
        // Reativar sem data: libera por mais 3 dias até ajustar o vencimento
        Object.assign(patch, { current_period_end: new Date(Date.now() + 3 * 86_400_000).toISOString() });
      }
      await db.from("subscriptions").upsert({ organization_id: orgId, ...patch, updated_at: now });
      await audit(ctx.userId, orgId, b.status === "blocked" ? "acesso bloqueado" : b.status === "courtesy" ? "cortesia (sem vencimento)" : "acesso liberado");
    } else if (b.action === "group") {
      await db.from("partner_settings").upsert({ organization_id: orgId, billing_group_id: b.group_id, billing_group_name: b.group_name, updated_at: now });
      await audit(ctx.userId, orgId, "grupo de cobrança", { grupo: b.group_name });
    } else if (b.action === "notes") {
      await db.from("partner_settings").upsert({ organization_id: orgId, notes: b.notes || null, updated_at: now });
    } else if (b.action === "value") {
      if (sub?.asaas_subscription_id) await updateSubscription(sub.asaas_subscription_id, { value: b.value_cents / 100 });
      await db.from("subscriptions").upsert({ organization_id: orgId, value_cents: b.value_cents, updated_at: now });
      await audit(ctx.userId, orgId, "valor alterado", { de: sub?.value_cents ?? null, para: b.value_cents });
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

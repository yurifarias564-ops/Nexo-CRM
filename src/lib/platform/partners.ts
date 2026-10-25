import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { requireApiContext } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { boletoLine, openPayments, pixPayload, type AsaasPayment } from "@/lib/asaas";
import { billingMessage } from "./billing-message";

export { billingMessage };
import { loadChannel, zapiCreds } from "@/lib/whatsapp";
import * as zapi from "@/lib/whatsapp/zapi";
import * as evo from "@/lib/whatsapp/evolution";

// Painel de parceiros: só o dono da plataforma (conta da casa).

export async function requireHouse() {
  const ctx = await requireApiContext({ allowInactive: true });
  const { data } = await (await supabaseServer()).rpc("is_house");
  if (!data) throw new HttpError(404, "Não encontrado");
  return ctx;
}

export async function audit(actorId: string, orgId: string | null, action: string, details: Record<string, unknown> = {}) {
  await supabaseAdmin().from("platform_audit").insert({ actor_id: actorId, organization_id: orgId, action, details }).then(({ error }) => { if (error) console.error("[auditoria]", error.message); }, (e) => console.error("[auditoria]", e));
}

export async function platformSettings() {
  const { data } = await supabaseAdmin().from("platform_settings").select("*").eq("id", true).maybeSingle();
  return (data as { billing_channel_id: string | null; billing_hour: number } | null) ?? { billing_channel_id: null, billing_hour: 9 };
}

/** Grupos do número da plataforma que envia as cobranças. */
export async function billingGroups() {
  const s = await platformSettings();
  if (!s.billing_channel_id) throw new HttpError(409, "Escolha primeiro o número de WhatsApp que envia as cobranças.");
  const ch = await loadChannel(s.billing_channel_id);
  if (ch.status !== "connected") throw new HttpError(409, `O número "${ch.name}" está desconectado.`);
  if (ch.provider === "zapi") return zapi.listGroups(zapiCreds(ch));
  if (ch.provider === "evolution" && ch.evolution_instance) return evo.fetchGroups(ch.evolution_instance);
  throw new HttpError(409, "Envio para grupos só funciona em número conectado por QR Code (Z-API ou Evolution).");
}

async function sendToGroup(groupId: string, text: string) {
  const s = await platformSettings();
  if (!s.billing_channel_id) throw new HttpError(409, "Número de cobrança não configurado");
  const ch = await loadChannel(s.billing_channel_id);
  if (ch.status !== "connected") throw new HttpError(409, `O número "${ch.name}" está desconectado.`);
  if (ch.provider === "zapi") return zapi.sendGroupText(zapiCreds(ch), groupId, text);
  if (ch.provider === "evolution" && ch.evolution_instance) return evo.sendText(ch.evolution_instance, groupId, text);
  throw new HttpError(409, "Envio para grupos só funciona em número conectado por QR Code.");
}

/** Envia a cobrança no grupo do cliente (uma vez por cobrança e tipo). */
export async function sendPartnerBill(orgId: string, p: AsaasPayment, kind: "due" | "overdue" | "manual") {
  const db = supabaseAdmin();
  const [{ data: org }, { data: ps }] = await Promise.all([
    db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    db.from("partner_settings").select("billing_group_id").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!ps?.billing_group_id) throw new HttpError(409, "Escolha o grupo do WhatsApp deste cliente.");
  if (kind !== "manual") {
    const { error } = await db.from("partner_billing_notices").insert({ payment_id: p.id, kind, organization_id: orgId });
    if (error) return false; // já enviado
  }
  try {
    const [line, pix] = await Promise.all([boletoLine(p.id), pixPayload(p.id)]);
    await sendToGroup(ps.billing_group_id, billingMessage(org?.name ?? "cliente", p, kind, line, pix));
    if (kind === "manual") await db.from("partner_billing_notices").upsert({ payment_id: p.id, kind, organization_id: orgId, sent_at: new Date().toISOString() });
    return true;
  } catch (e) {
    if (kind !== "manual") await db.from("partner_billing_notices").delete().eq("payment_id", p.id).eq("kind", kind);
    throw e;
  }
}

const today = (tz: string, plusDays = 0) => {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

/**
 * Cobrança automática nos grupos (chamado pelo cron): no dia do vencimento manda boleto/Pix
 * para quem não paga no cartão; 2 dias depois, se ainda estiver em aberto, manda o lembrete.
 * Quem paga no cartão é debitado sozinho pelo Asaas — só recebe mensagem se o cartão falhar.
 */
/** Acesso de suporte é temporário: some sozinho depois de 12 horas. */
export async function expireSupportAccess() {
  const db = supabaseAdmin();
  const { data } = await db.from("platform_support_access").select("organization_id, user_id").lt("created_at", new Date(Date.now() - 12 * 3600_000).toISOString());
  for (const r of data ?? []) {
    await db.from("organization_members").delete().eq("organization_id", r.organization_id).eq("user_id", r.user_id).neq("role", "owner");
    await db.from("platform_support_access").delete().eq("organization_id", r.organization_id).eq("user_id", r.user_id);
    await audit(r.user_id, r.organization_id, "acesso de suporte expirou (12h)");
  }
  return data?.length ?? 0;
}

export async function runPartnerBilling() {
  const s = await platformSettings();
  if (!s.billing_channel_id) return 0;
  const tz = "America/Sao_Paulo";
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < s.billing_hour || hour > 20) return 0;

  const db = supabaseAdmin();
  const { data: subs } = await db.from("subscriptions").select("organization_id, asaas_subscription_id").not("asaas_subscription_id", "is", null);
  const orgBySub = new Map((subs ?? []).map((x) => [x.asaas_subscription_id as string, x.organization_id as string]));
  const { data: groups } = await db.from("partner_settings").select("organization_id").not("billing_group_id", "is", null);
  const withGroup = new Set((groups ?? []).map((g) => g.organization_id));
  if (!withGroup.size) return 0;

  const t = today(tz), late = today(tz, -2);
  const [due, overdue] = await Promise.all([openPayments("PENDING", t, t), openPayments("OVERDUE", late, late)]);
  let sent = 0;
  for (const [list, kind] of [[due, "due"], [overdue, "overdue"]] as const) {
    for (const p of list) {
      const org = p.subscription ? orgBySub.get(p.subscription) : undefined;
      if (!org || !withGroup.has(org)) continue;
      if (kind === "due" && p.billingType === "CREDIT_CARD") continue; // débito automático no cartão
      try { if (await sendPartnerBill(org, p, kind)) sent++; } catch (e) { console.error("[parceiros] cobrança", org, (e as Error).message); }
    }
  }
  return sent;
}

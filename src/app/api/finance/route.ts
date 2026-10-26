import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { balance, PAYOUT_KEY_COOLDOWN_H, pixFeeSettings, storeAccount } from "@/lib/payments/asaas-store";
import { displayPixKey, type PixKeyType } from "@/lib/pix";

export const runtime = "nodejs";

/** Aba Finanças: situação do Pix Nexo, saldo e números do mês (a chave de API nunca sai do servidor). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const [fees, acc] = await Promise.all([pixFeeSettings(), storeAccount(ctx.org.id)]);
    const isOwner = ctx.role === "owner";
    const offer = { addonCents: fees.addonCents, firstCents: fees.firstCents, afterCents: fees.afterCents, firstDays: fees.firstDays };
    if (!acc) return ok({ account: null, offer, isOwner });

    let available: number | null = null;
    if (acc.status === "approved") available = await balance(ctx.org.id).catch(() => null);
    const monthStart = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date()) + "-01T03:00:00Z").toISOString();
    const { data: paid } = await supabaseAdmin().from("pix_charges").select("value").eq("organization_id", ctx.org.id).eq("status", "paid").gte("paid_at", monthStart);
    const { count: pending } = await supabaseAdmin().from("pix_charges").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "pending");
    const keyUnlocksAt = acc.payout_key_changed_at ? new Date(new Date(acc.payout_key_changed_at).getTime() + PAYOUT_KEY_COOLDOWN_H * 3_600_000).toISOString() : null;
    return ok({
      isOwner, offer,
      account: {
        status: acc.status, enabled: acc.enabled, name: acc.account_name, doc: acc.doc_masked, personType: acc.person_type,
        onboardingUrl: acc.onboarding_url, addonCents: acc.addon_cents, createdAt: acc.created_at,
        payoutKeyType: acc.payout_key_type, payoutKey: acc.payout_key ? displayPixKey(acc.payout_key_type as PixKeyType, acc.payout_key) : null,
        keyUnlocksAt: keyUnlocksAt && new Date(keyUnlocksAt) > new Date() ? keyUnlocksAt : null,
        autoPayout: acc.auto_payout,
      },
      balance: available,
      month: { sales: paid?.length ?? 0, value: (paid ?? []).reduce((a, r) => a + Number(r.value), 0) },
      pendingCharges: pending ?? 0,
    });
  } catch (e) {
    return fail(e);
  }
}

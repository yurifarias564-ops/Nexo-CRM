import { z } from "zod";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit, requireHouse } from "@/lib/platform/partners";
import { pixFeeSettings } from "@/lib/payments/asaas-store";

export const runtime = "nodejs";

/** Receita da plataforma com o Pix Nexo (taxa por venda + adicional) (só o dono da plataforma). */
export async function GET() {
  try {
    await requireHouse();
    const db = supabaseAdmin();
    const [fees, { data: rows }, { data: orgs }, { data: accounts }] = await Promise.all([
      pixFeeSettings(),
      db.from("pix_charges").select("organization_id, value, fee_cents, fee_status, status, created_at, paid_at").neq("fee_status", "none").order("created_at", { ascending: false }).limit(20000),
      db.from("organizations").select("id, name, created_at"),
      db.from("org_payment_accounts").select("organization_id, enabled, status, addon_cents"),
    ]);
    const nameOf = new Map((orgs ?? []).map((o) => [o.id, o.name as string]));
    const monthKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date(iso));
    const thisMonth = monthKey(new Date().toISOString());
    const byMonth = new Map<string, { month: string; sales: number; feeCents: number }>();
    const byOrg = new Map<string, { orgId: string; name: string; sales: number; feeCents: number; pendingCents: number; salesValue: number; lastAt: string | null }>();
    let totalCents = 0, monthCents = 0, pendingCents = 0, monthSales = 0;
    for (const r of rows ?? []) {
      const o = byOrg.get(r.organization_id) ?? { orgId: r.organization_id, name: nameOf.get(r.organization_id) ?? "—", sales: 0, feeCents: 0, pendingCents: 0, salesValue: 0, lastAt: null };
      if (r.fee_status === "confirmed" && r.paid_at) {
        const m = monthKey(r.paid_at);
        const b = byMonth.get(m) ?? { month: m, sales: 0, feeCents: 0 };
        b.sales++; b.feeCents += r.fee_cents; byMonth.set(m, b);
        totalCents += r.fee_cents;
        if (m === thisMonth) { monthCents += r.fee_cents; monthSales++; }
        o.sales++; o.feeCents += r.fee_cents; o.salesValue += Number(r.value);
        if (!o.lastAt || r.paid_at > o.lastAt) o.lastAt = r.paid_at;
      } else if (r.fee_status === "pending") { pendingCents += r.fee_cents; o.pendingCents += r.fee_cents; }
      byOrg.set(r.organization_id, o);
    }
    for (const a of accounts ?? []) if (!byOrg.has(a.organization_id)) byOrg.set(a.organization_id, { orgId: a.organization_id, name: nameOf.get(a.organization_id) ?? "—", sales: 0, feeCents: 0, pendingCents: 0, salesValue: 0, lastAt: null });
    return ok({
      fees: { firstCents: fees.firstCents, afterCents: fees.afterCents, firstDays: fees.firstDays, addonCents: fees.addonCents },
      addonMonthlyCents: (accounts ?? []).filter((a) => a.enabled).reduce((t, a) => t + (a.addon_cents ?? 0), 0),
      totalCents, monthCents, monthSales, pendingCents,
      months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12),
      orgs: [...byOrg.values()].map((o) => {
        const a = (accounts ?? []).find((x) => x.organization_id === o.orgId);
        return { ...o, connected: Boolean(a?.enabled), accountStatus: a?.status ?? null };
      }).sort((a, b) => b.feeCents - a.feeCents),
    });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ firstCents: z.number().int().min(0).max(10000), afterCents: z.number().int().min(0).max(10000), firstDays: z.number().int().min(0).max(365), addonCents: z.number().int().min(0).max(1_000_000) });

/** Taxa por venda Pix e preço do adicional (valem para as próximas cobranças/ativações). */
export async function PUT(req: Request) {
  try {
    const ctx = await requireHouse();
    const b = Body.parse(await readJson(req, 1000));
    const { error } = await supabaseAdmin().from("platform_settings").upsert({ id: true, pix_fee_first_cents: b.firstCents, pix_fee_after_cents: b.afterCents, pix_first_days: b.firstDays, pix_addon_cents: b.addonCents, updated_at: new Date().toISOString() });
    if (error) throw error;
    await audit(ctx.userId, null, "taxa do Pix alterada", b);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

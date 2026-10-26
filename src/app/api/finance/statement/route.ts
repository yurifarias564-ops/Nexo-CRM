import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { statement, storeAccount } from "@/lib/payments/asaas-store";

export const runtime = "nodejs";

/** Extrato, vendas Pix e saques da loja. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const acc = await storeAccount(ctx.org.id);
    if (!acc) return ok({ statement: [], sales: [], payouts: [] });
    const db = supabaseAdmin();
    const [st, { data: sales }, { data: payouts }] = await Promise.all([
      acc.status === "approved" ? statement(ctx.org.id).catch(() => []) : Promise.resolve([]),
      db.from("pix_charges").select("id, lead_id, source, value, description, payer_name, status, created_at, paid_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(60),
      db.from("payouts").select("id, value, key_display, status, fail_reason, auto, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(30),
    ]);
    return ok({ statement: st, sales: sales ?? [], payouts: payouts ?? [] });
  } catch (e) {
    return fail(e);
  }
}

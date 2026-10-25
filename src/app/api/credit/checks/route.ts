import { requireApiContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Últimas consultas de crédito da empresa (CPF sempre mascarado). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { data, error } = await supabaseAdmin().from("credit_checks")
      .select("id, source, cpf_masked, income, vehicle_value, down_payment, months, installment, provider, status, score, score_band, payment_capacity, reasons, banks, error, created_at, leads(id, name)")
      .eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return ok({ checks: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BusinessHours, DEFAULT_HOURS } from "@/lib/business-hours";
import { isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";

/** Horário comercial da empresa (usado pelas automações). */
export async function GET() {
  try {
    const ctx = await requireApiContext();
    const { data } = await supabaseAdmin().from("business_hours").select("time_zone, days").eq("organization_id", ctx.org.id).maybeSingle();
    const p = data ? BusinessHours.safeParse(data) : null;
    return ok({ hours: p?.success ? p.data : DEFAULT_HOURS });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = BusinessHours.parse(await readJson(req, 4_000));
    if (!isValidTimeZone(b.time_zone)) throw new Error("Fuso horário inválido");
    const { error } = await supabaseAdmin().from("business_hours").upsert({ organization_id: ctx.org.id, ...b, updated_at: new Date().toISOString() });
    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

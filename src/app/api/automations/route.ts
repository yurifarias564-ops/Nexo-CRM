import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AutomationBody } from "@/lib/automations/schema";
import { validateRefs } from "@/lib/automations/validate";

export const runtime = "nodejs";

/** Automações da empresa com números de execução. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const db = supabaseAdmin();
    const { data: autos, error } = await db.from("automations").select("*").eq("organization_id", ctx.org.id).order("created_at", { ascending: false });
    if (error) throw error;
    const ids = (autos ?? []).map((a) => a.id);
    const stats: Record<string, { total: number; waiting: number; failed: number; last: string | null }> = {};
    if (ids.length) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: runs } = await db.from("automation_runs").select("automation_id, status, created_at").in("automation_id", ids).gte("created_at", since).limit(20000);
      for (const r of runs ?? []) {
        const s = (stats[r.automation_id] ??= { total: 0, waiting: 0, failed: 0, last: null });
        s.total++;
        if (r.status === "waiting") s.waiting++;
        if (r.status === "failed") s.failed++;
        if (!s.last || r.created_at > s.last) s.last = r.created_at;
      }
    }
    return ok({ automations: autos ?? [], stats });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = AutomationBody.parse(await readJson(req, 100_000));
    await validateRefs(ctx.org.id, b);
    const { data, error } = await supabaseAdmin().from("automations").insert({ ...b, organization_id: ctx.org.id, created_by: ctx.userId }).select("*").single();
    if (error) throw error;
    return ok({ automation: data }, 201);
  } catch (e) {
    return fail(e);
  }
}

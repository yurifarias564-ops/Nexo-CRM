import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasIgScope } from "@/lib/instagram";
import { buildFlowRow, FlowBody } from "@/lib/ig-flows-save";

export const runtime = "nodejs";

/** Automações do Instagram da empresa, com os números de cada uma e as contas conectadas. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const db = supabaseAdmin();
    const [{ data: flows }, { data: chans }, { data: runs }] = await Promise.all([
      db.from("ig_flows").select("*").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }),
      db.from("whatsapp_channels").select("id, status, ig_username, ig_scopes").eq("organization_id", ctx.org.id).eq("provider", "instagram").order("created_at"),
      db.from("ig_flow_runs").select("flow_id, status, follow_blocks").eq("organization_id", ctx.org.id).limit(20000),
    ]);
    const stats: Record<string, { started: number; done: number; blocked: number }> = {};
    for (const r of runs ?? []) {
      const s = (stats[r.flow_id] ??= { started: 0, done: 0, blocked: 0 });
      s.started++; if (r.status === "done") s.done++; if (r.follow_blocks > 0) s.blocked++;
    }
    return ok({
      flows: flows ?? [], stats,
      channels: (chans ?? []).map((c) => ({ id: c.id, username: c.ig_username, connected: c.status === "connected", canComments: hasIgScope(c.ig_scopes, "comments"), canPublish: hasIgScope(c.ig_scopes, "publish") })),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const p = FlowBody.parse(await readJson(req));
    const row = await buildFlowRow(ctx.org.id, p, null);
    const { data, error } = await supabaseAdmin().from("ig_flows").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId }).select("*").single();
    if (error) throw error;
    return ok({ flow: data }, 201);
  } catch (e) {
    return fail(e);
  }
}

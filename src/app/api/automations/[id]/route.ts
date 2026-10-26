import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AutomationBody } from "@/lib/automations/schema";
import { validateRefs } from "@/lib/automations/validate";
import { TRIGGER_NODE, type Graph } from "@/lib/automations/schema";

/**
 * Fluxo editado: as execuções em andamento continuam no bloco certo.
 * Automação antiga (lista de passos) virando canvas: passo N → bloco "nN" (ids da conversão).
 * Execução parada num bloco que foi apagado: para, com o motivo.
 */
async function carryRuns(automationId: string, g: Graph, wasLinear: boolean) {
  const db = supabaseAdmin();
  const ids = new Set(g.nodes.map((n) => n.id));
  const start = g.edges.find((e) => e.from === TRIGGER_NODE && e.port === "out")?.to ?? null;
  const { data: runs } = await db.from("automation_runs").select("id, node_id, reply_node, step_index, status").eq("automation_id", automationId).in("status", ["running", "waiting", "processing"]);
  for (const r of runs ?? []) {
    if (wasLinear && !r.node_id) {
      const target = r.step_index === 0 ? start : `n${r.step_index + 1}`;
      await db.from("automation_runs").update(target && ids.has(target) ? { node_id: target } : { status: "stopped", error: "Fluxo editado: o passo onde estava não existe mais" }).eq("id", r.id);
    } else if ((r.node_id && !ids.has(r.node_id)) || (r.reply_node && !ids.has(r.reply_node))) {
      await db.from("automation_runs").update({ status: "stopped", error: "Fluxo editado: o bloco onde estava foi apagado" }).eq("id", r.id);
    }
  }
}

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/** Últimas execuções (com o passo a passo de cada uma). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Não encontrada");
    const ctx = await requireApiContext({ manage: true });
    const { data, error } = await supabaseAdmin().from("automation_runs").select("id, status, step_index, node_id, waiting_for, resume_at, log, error, created_at, updated_at, leads(id, name)")
      .eq("automation_id", id).eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(80);
    if (error) throw error;
    return ok({ runs: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Não encontrada");
    const ctx = await requireApiContext({ manage: true });
    const raw = (await readJson(req, 100_000)) as Record<string, unknown>;
    const db = supabaseAdmin();
    // Só ligar/desligar
    if (Object.keys(raw).length === 1 && typeof raw.enabled === "boolean") {
      const { data } = await db.from("automations").update({ enabled: raw.enabled, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.org.id).select("*").maybeSingle();
      if (!data) throw new HttpError(404, "Não encontrada");
      if (!raw.enabled) await db.from("automation_runs").update({ status: "stopped", error: "Automação desligada" }).eq("automation_id", id).eq("status", "waiting");
      return ok({ automation: data });
    }
    const b = AutomationBody.parse(raw);
    await validateRefs(ctx.org.id, b);
    const { data: before } = await db.from("automations").select("graph").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
    const { data, error } = await db.from("automations").update({ ...b, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.org.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Não encontrada");
    if (b.graph) await carryRuns(id, b.graph, !before?.graph);
    return ok({ automation: data });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Não encontrada");
    const ctx = await requireApiContext({ manage: true });
    await supabaseAdmin().from("automations").delete().eq("id", id).eq("organization_id", ctx.org.id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

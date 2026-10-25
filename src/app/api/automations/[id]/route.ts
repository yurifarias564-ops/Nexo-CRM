import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AutomationBody } from "@/lib/automations/schema";
import { validateRefs } from "@/lib/automations/validate";

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/** Últimas execuções (com o passo a passo de cada uma). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Não encontrada");
    const ctx = await requireApiContext({ manage: true });
    const { data, error } = await supabaseAdmin().from("automation_runs").select("id, status, step_index, resume_at, log, error, created_at, updated_at, leads(id, name)")
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
    const { data, error } = await db.from("automations").update({ ...b, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.org.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Não encontrada");
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

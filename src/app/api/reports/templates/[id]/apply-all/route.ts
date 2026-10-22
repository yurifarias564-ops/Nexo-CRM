import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Usa o mesmo modelo em todas as empresas (clientes) que o usuário administra.
 * Mantém WhatsApp, destino e horário que cada empresa já tinha.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Modelo não encontrado");
    const ctx = await requireApiContext({ manage: true });
    const sb = await supabaseServer();
    const { data: t } = await sb.from("report_templates").select("id, name").eq("id", id).maybeSingle();
    if (!t) throw new HttpError(404, "Modelo não encontrado");

    const db = supabaseAdmin();
    const { data: mems, error } = await db.from("organization_members").select("organization_id, role").eq("user_id", ctx.userId).in("role", ["owner", "admin"]);
    if (error) throw error;
    const orgIds = (mems ?? []).map((m) => m.organization_id as string);
    if (!orgIds.length) return ok({ applied: 0 });

    const { data: existing } = await db.from("report_settings").select("organization_id").in("organization_id", orgIds);
    const have = new Set((existing ?? []).map((r) => r.organization_id as string));
    const now = new Date().toISOString();
    if (have.size) {
      const upd = await db.from("report_settings").update({ template_id: t.id, template_name: t.name, updated_by: ctx.userId, updated_at: now }).in("organization_id", [...have]);
      if (upd.error) throw upd.error;
    }
    const fresh = orgIds.filter((o) => !have.has(o));
    if (fresh.length) {
      const ins = await db.from("report_settings").insert(fresh.map((o) => ({ organization_id: o, template_id: t.id, template_name: t.name, updated_by: ctx.userId, updated_at: now })));
      if (ins.error) throw ins.error;
    }
    return ok({ applied: orgIds.length });
  } catch (e) {
    return fail(e);
  }
}

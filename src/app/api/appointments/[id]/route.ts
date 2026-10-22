import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok } from "@/lib/http";
import { cancelAppointment } from "@/lib/appointments";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cancela o agendamento e remove o evento do Google Agenda. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Agendamento não encontrado");
    const ctx = await requireApiContext();
    const r = await cancelAppointment(await supabaseServer(), { orgId: ctx.org.id, userId: ctx.userId, canManage: ctx.role !== "agent" }, id);
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}

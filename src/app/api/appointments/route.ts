import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createAppointment } from "@/lib/appointments";
import { DEFAULT_TZ, isValidTimeZone, zonedToUtc } from "@/lib/time";

export const runtime = "nodejs";

const Body = z.object({
  leadId: z.string().uuid(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida"),
  durationMinutes: z.number().int().min(5).max(24 * 60).default(60),
  timeZone: z.string().optional(),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  moveToScheduleStage: z.boolean().default(false),
});

/** Cria um agendamento (e o evento no Google Agenda, se conectado). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`appt:${ctx.userId}`, 30, 60);
    const b = Body.parse(await readJson(req, 16_000));
    const tz = isValidTimeZone(b.timeZone) ? b.timeZone : DEFAULT_TZ;
    const start = zonedToUtc(b.start, tz);
    if (!start) throw new HttpError(422, "Data/hora inválida");
    const end = new Date(start.getTime() + b.durationMinutes * 60_000);
    const r = await createAppointment(await supabaseServer(), { orgId: ctx.org.id, userId: ctx.userId },
      { leadId: b.leadId, start, end, timeZone: tz, title: b.title, notes: b.notes, moveToScheduleStage: b.moveToScheduleStage });
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

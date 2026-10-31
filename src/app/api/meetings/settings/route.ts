import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadMeetingSettings } from "@/lib/appointments";
import { MeetingSettings } from "@/lib/meetings-shared";

export const runtime = "nodejs";

/** Reuniões: mensagem com o link, lembretes e em quais funis a coluna de agendamento abre o agendamento. */
export async function GET() {
  try {
    const ctx = await requireApiContext();
    const [settings, { data: pipes }] = await Promise.all([
      loadMeetingSettings(ctx.org.id),
      supabaseAdmin().from("pipelines").select("id, name, schedule_on_move").eq("organization_id", ctx.org.id).order("position"),
    ]);
    return ok({ settings, pipelines: pipes ?? [] });
  } catch (e) {
    return fail(e);
  }
}

const Body = MeetingSettings.extend({ pipelines: z.array(z.object({ id: z.string().uuid(), schedule_on_move: z.boolean() })).max(50) });

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 40_000));
    const db = supabaseAdmin();
    const { pipelines, ...s } = b;
    const { error } = await db.from("meeting_settings").upsert({ organization_id: ctx.org.id, ...s, updated_at: new Date().toISOString() });
    if (error) throw error;
    for (const p of pipelines) await db.from("pipelines").update({ schedule_on_move: p.schedule_on_move }).eq("organization_id", ctx.org.id).eq("id", p.id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

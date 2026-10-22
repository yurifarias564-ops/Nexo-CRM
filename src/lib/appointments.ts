import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { cancelEvent, createEvent } from "@/lib/google";
import { formatPhone, norm } from "@/lib/utils";
import { formatWhen } from "@/lib/time";

export type GoogleOutcome = "created" | "not_connected" | "error";

export interface CreatedAppointment {
  id: string;
  startsAt: string;
  google: GoogleOutcome;
  googleError?: string;
  googleLink?: string | null;
  movedTo?: string | null;
  summary: string;
}

/** Etapa "Agendamento" do mesmo funil do lead (nome contendo "agend"). */
export async function findScheduleStage(sb: SupabaseClient, pipelineId: string) {
  const { data } = await sb.from("stages").select("id, name, position").eq("pipeline_id", pipelineId).order("position");
  return (data ?? []).find((s) => norm(s.name).includes("agend")) ?? null;
}

export async function createAppointment(
  sb: SupabaseClient,
  ctx: { orgId: string; userId: string },
  input: { leadId: string; start: Date; end: Date; timeZone: string; title?: string | null; notes?: string | null; moveToScheduleStage?: boolean },
): Promise<CreatedAppointment> {
  if (input.end <= input.start) throw new HttpError(422, "O horário de término precisa ser depois do início");
  if (input.start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(422, "Esse horário já passou. Confira o dia e a hora.");

  const { data: lead } = await sb.from("leads").select("id, name, phone, email, pipeline_id, stage_id").eq("id", input.leadId).maybeSingle();
  if (!lead) throw new HttpError(404, "Lead não encontrado");

  const title = (input.title?.trim() || `Reunião com ${lead.name}`).slice(0, 200);
  const description = [
    `Lead: ${lead.name}`,
    lead.phone ? `WhatsApp: ${formatPhone(lead.phone)} — https://wa.me/${lead.phone}` : null,
    lead.email ? `E-mail: ${lead.email}` : null,
    input.notes?.trim() ? `\n${input.notes.trim()}` : null,
    `\nAgendado pelo Nexo CRM — ${appUrl()}/pipeline`,
  ].filter(Boolean).join("\n");

  // 1) Google Agenda (não bloqueia o agendamento no CRM se falhar)
  let google: GoogleOutcome = "not_connected";
  let googleError: string | undefined;
  let ev: Awaited<ReturnType<typeof createEvent>> = null;
  try {
    ev = await createEvent(ctx.userId, { title, description, start: input.start.toISOString(), end: input.end.toISOString(), timeZone: input.timeZone });
    google = ev ? "created" : "not_connected";
  } catch (e) {
    google = "error";
    googleError = e instanceof HttpError ? e.message : "Falha ao criar o evento no Google Agenda";
    console.error("[google calendar]", e);
  }

  // 2) Registro no CRM (RLS: usuário só agenda na própria empresa e em nome próprio)
  const { data: appt, error } = await sb.from("appointments").insert({
    organization_id: ctx.orgId, lead_id: lead.id, user_id: ctx.userId, title, description: input.notes?.trim() || null,
    starts_at: input.start.toISOString(), ends_at: input.end.toISOString(), time_zone: input.timeZone,
    google_event_id: ev?.id ?? null, google_calendar_id: ev?.calendarId ?? null, google_link: ev?.link ?? null,
  }).select("id").single();
  if (error) {
    if (ev) await cancelEvent(ctx.userId, ev.calendarId, ev.id).catch(() => undefined); // não deixa evento órfão
    throw error;
  }

  await sb.from("activities").insert({
    organization_id: ctx.orgId, lead_id: lead.id, actor_id: ctx.userId, type: "appointment_created",
    payload: { appointment_id: appt.id, starts_at: input.start.toISOString(), title, google },
  });

  // 3) Move para a etapa "Agendamento", se existir e o lead ainda não estiver nela
  let movedTo: string | null = null;
  if (input.moveToScheduleStage) {
    const st = await findScheduleStage(sb, lead.pipeline_id);
    if (st && st.id !== lead.stage_id) {
      const { data: top } = await sb.from("leads").select("position").eq("stage_id", st.id).order("position").limit(1).maybeSingle();
      const mv = await sb.from("leads").update({ stage_id: st.id, position: (top?.position ?? 0) - 1024 }).eq("id", lead.id);
      if (!mv.error) movedTo = st.name;
    }
  }

  return {
    id: appt.id, startsAt: input.start.toISOString(), google, googleError, googleLink: ev?.link ?? null, movedTo,
    summary: `${title} — ${formatWhen(input.start.toISOString(), input.timeZone)}`,
  };
}

export async function cancelAppointment(sb: SupabaseClient, ctx: { orgId: string; userId: string; canManage: boolean }, id: string) {
  const { data: a } = await sb.from("appointments")
    .select("id, lead_id, user_id, status, google_event_id, google_calendar_id, title, starts_at").eq("id", id).maybeSingle();
  if (!a) throw new HttpError(404, "Agendamento não encontrado");
  if (a.status === "canceled") return { google: "none" as const };
  if (a.user_id !== ctx.userId && !ctx.canManage) throw new HttpError(403, "Só quem agendou ou um administrador pode cancelar");

  let google: "removed" | "none" | "error" = "none";
  if (a.google_event_id && a.google_calendar_id && a.user_id) {
    try {
      await cancelEvent(a.user_id, a.google_calendar_id, a.google_event_id);
      google = "removed";
    } catch (e) {
      google = "error";
      console.error("[google calendar cancel]", e);
    }
  }
  const { error } = await sb.from("appointments").update({ status: "canceled" }).eq("id", id);
  if (error) throw error;
  await sb.from("activities").insert({
    organization_id: ctx.orgId, lead_id: a.lead_id, actor_id: ctx.userId, type: "appointment_canceled",
    payload: { appointment_id: id, starts_at: a.starts_at, title: a.title },
  });
  return { google };
}

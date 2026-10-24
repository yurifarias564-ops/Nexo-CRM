import { norm } from "@/lib/utils";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { describe, ResolvedAction } from "@/lib/voice-actions";
import { rateLimit } from "@/lib/rate-limit";
import { sendText } from "@/lib/send";
import { createAppointment } from "@/lib/appointments";
import { createScheduled } from "@/lib/scheduled";

export const runtime = "nodejs";

const Body = z.object({ transcript: z.string().max(2000), actions: z.array(ResolvedAction).min(1).max(20) });

/** Executa as ações confirmadas. Tudo passa pelo RLS do usuário. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`voice-exec:${ctx.userId}`, 30, 60);
    const { transcript, actions } = Body.parse(await readJson(req, 64_000));
    const sb = await supabaseServer();
    const done: string[] = [];

    const ensureTags = async (tags: { id: string | null; name: string }[]) => {
      const ids: string[] = [];
      for (const t of tags) {
        if (t.id) { ids.push(t.id); continue; }
        const { data, error } = await sb.from("tags").insert({ organization_id: ctx.org.id, name: t.name }).select("id").single();
        if (data) ids.push(data.id);
        else if (error?.code === "23505") {
          const { data: ex } = await sb.from("tags").select("id").eq("name", t.name).limit(1).maybeSingle();
          if (ex) ids.push(ex.id);
        } else if (error) throw error;
      }
      return ids;
    };
    const need = (id: string | null) => {
      if (!id) throw new HttpError(422, "Escolha qual lead você quis dizer antes de confirmar");
      return id;
    };

    // Etapas criadas neste comando: nome → id (para mover/criar lead nelas)
    const created = new Map<string, string>();
    const stageIdFor = async (id: string | null, name: string) => {
      if (id) return id;
      const got = created.get(norm(name));
      if (got) return got;
      const { data } = await sb.from("stages").select("id, name");
      const hit = (data ?? []).find((s) => norm(s.name) === norm(name));
      if (!hit) throw new HttpError(404, `A etapa "${name}" não foi criada`);
      return hit.id as string;
    };

    let failure: { action: string; error: string } | null = null;
    for (const a of actions) {
      try {
      switch (a.kind) {
        case "create_stage": {
          if (ctx.role === "agent") throw new HttpError(403, "Só administradores podem criar etapas do funil");
          const { data: list } = await sb.from("stages").select("id, name, kind, position").eq("pipeline_id", a.pipelineId).order("position");
          const all = (list ?? []) as { id: string; name: string; kind: string; position: number }[];
          const exists = all.find((s) => norm(s.name) === norm(a.name));
          if (exists) { created.set(norm(a.name), exists.id); break; }
          // Entra depois da etapa pedida; senão, antes de Ganho/Perdido
          let idx = a.afterStageId ? all.findIndex((s) => s.id === a.afterStageId) + 1 : all.findIndex((s) => s.kind !== "open");
          if (idx <= 0 || idx > all.length) idx = idx === 0 ? 0 : all.length;
          const PALETTE = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1"];
          const { data: st, error } = await sb.from("stages").insert({
            organization_id: ctx.org.id, pipeline_id: a.pipelineId, name: a.name, position: idx, color: PALETTE[all.length % PALETTE.length],
          }).select("id").single();
          if (error) throw error;
          // Renumera as posições para a nova etapa ficar no lugar certo
          const order = [...all.slice(0, idx).map((s) => s.id), st.id, ...all.slice(idx).map((s) => s.id)];
          for (let k = 0; k < order.length; k++) await sb.from("stages").update({ position: k }).eq("id", order[k]!);
          created.set(norm(a.name), st.id);
          break;
        }
        case "move_lead": {
          const stageId = await stageIdFor(a.stageId, a.stageName);
          const { data: top } = await sb.from("leads").select("position").eq("stage_id", stageId).order("position").limit(1).maybeSingle();
          const { error } = await sb.from("leads").update({ stage_id: stageId, position: (top?.position ?? 0) - 1024 }).eq("id", need(a.leadId));
          if (error) throw error;
          break;
        }
        case "add_tags": {
          const leadId = need(a.leadId);
          const ids = await ensureTags(a.tags);
          const { error } = await sb.from("lead_tags").upsert(ids.map((tag_id) => ({ lead_id: leadId, tag_id, organization_id: ctx.org.id })), { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
          if (error) throw error;
          break;
        }
        case "remove_tags": {
          const { error } = await sb.from("lead_tags").delete().eq("lead_id", need(a.leadId)).in("tag_id", a.tags.map((t) => t.id));
          if (error) throw error;
          break;
        }
        case "create_lead": {
          const stageId = await stageIdFor(a.stageId, a.stageName);
          const { data: st } = await sb.from("stages").select("pipeline_id").eq("id", stageId).maybeSingle();
          if (!st) throw new HttpError(404, "Etapa não encontrada");
          const { data: lead, error } = await sb.from("leads")
            .insert({ organization_id: ctx.org.id, pipeline_id: st.pipeline_id, stage_id: stageId, name: a.name, phone: a.phone, value: a.value ?? 0, source: "Comando de voz", position: -Date.now() / 1000 })
            .select("id").single();
          if (error) {
            if (error.code === "23505") throw new HttpError(409, "Já existe um lead com esse telefone");
            throw error;
          }
          if (a.tags.length) {
            const ids = await ensureTags(a.tags);
            const t = await sb.from("lead_tags").insert(ids.map((tag_id) => ({ lead_id: lead.id, tag_id, organization_id: ctx.org.id })));
            if (t.error) throw t.error;
          }
          break;
        }
        case "set_value": {
          const { error } = await sb.from("leads").update({ value: a.value }).eq("id", need(a.leadId));
          if (error) throw error;
          break;
        }
        case "assign_lead": {
          const { error } = await sb.from("leads").update({ assigned_to: a.userId }).eq("id", need(a.leadId));
          if (error) throw error;
          break;
        }
        case "update_lead": {
          const { error } = await sb.from("leads").update(a.patch).eq("id", need(a.leadId));
          if (error) throw error.code === "23505" ? new HttpError(409, "Já existe outro lead com esse telefone") : error;
          break;
        }
        case "send_message": {
          await rateLimit(`send:${ctx.userId}`, 60, 60);
          await sendText(sb, ctx.org.id, ctx.userId, { leadId: need(a.leadId) }, a.text);
          break;
        }
        case "schedule_message": {
          await createScheduled(sb, { orgId: ctx.org.id, userId: ctx.userId }, {
            target: { leadId: need(a.leadId) }, sendAt: new Date(a.sendAt), timeZone: a.timeZone, body: a.text,
          });
          break;
        }
        case "schedule_meeting": {
          const r = await createAppointment(sb, { orgId: ctx.org.id, userId: ctx.userId }, {
            leadId: need(a.leadId), start: new Date(a.start), end: new Date(a.end), timeZone: a.timeZone, title: a.title,
            moveToScheduleStage: Boolean(a.moveToStage),
          });
          const g = r.google === "created" ? " ✓ no Google Agenda" : r.google === "error" ? ` (salvo no CRM; Google: ${r.googleError})` : " (salvo no CRM; conecte o Google em Configurações)";
          done.push(`${describe(a).split(" · ")[0]}${g}`);
          continue;
        }
        case "log_call": {
          const { error } = await sb.from("activities").insert({
            organization_id: ctx.org.id, lead_id: need(a.leadId), actor_id: ctx.userId, type: "call",
            payload: { outcome: a.outcome, duration_min: a.durationMin, notes: a.notes, via: "voz" },
          });
          if (error) throw error;
          break;
        }
        case "add_note": {
          const { error } = await sb.from("activities").insert({ organization_id: ctx.org.id, lead_id: need(a.leadId), actor_id: ctx.userId, type: "note", payload: { text: a.note, via: "voz" } });
          if (error) throw error;
          break;
        }
      }
      done.push(describe(a));
      } catch (err) {
        // Para no primeiro erro e informa exatamente o que foi e o que não foi feito
        const msg = err instanceof HttpError ? err.message : err instanceof Error && "code" in err ? "Não permitido ou dado inválido" : "Erro inesperado";
        if (!(err instanceof HttpError)) console.error("[voice execute]", err);
        failure = { action: describe(a), error: msg };
        break;
      }
    }

    await supabaseAdmin().from("voice_commands").insert({ organization_id: ctx.org.id, user_id: ctx.userId, transcript, actions, executed: done.length > 0 });
    if (failure && !done.length) throw new HttpError(422, `${failure.action}: ${failure.error}`);
    return ok({ done, failure });
  } catch (e) {
    return fail(e);
  }
}

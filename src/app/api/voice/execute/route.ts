import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { describe, ResolvedAction } from "@/lib/voice-actions";
import { rateLimit } from "@/lib/rate-limit";
import { sendText } from "@/lib/send";

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

    let failure: { action: string; error: string } | null = null;
    for (const a of actions) {
      try {
      switch (a.kind) {
        case "move_lead": {
          const { data: top } = await sb.from("leads").select("position").eq("stage_id", a.stageId).order("position").limit(1).maybeSingle();
          const { error } = await sb.from("leads").update({ stage_id: a.stageId, position: (top?.position ?? 0) - 1024 }).eq("id", need(a.leadId));
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
          const { data: st } = await sb.from("stages").select("pipeline_id").eq("id", a.stageId).maybeSingle();
          if (!st) throw new HttpError(404, "Etapa não encontrada");
          const { data: lead, error } = await sb.from("leads")
            .insert({ organization_id: ctx.org.id, pipeline_id: st.pipeline_id, stage_id: a.stageId, name: a.name, phone: a.phone, value: a.value ?? 0, source: "Comando de voz", position: -Date.now() / 1000 })
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

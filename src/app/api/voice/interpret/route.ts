import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { bestMatch, interpret, norm, transcribe } from "@/lib/voice";
import type { ResolvedAction } from "@/lib/voice-actions";
import { normalizePhone } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    let transcript = "";

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(422, "Áudio não recebido");
      if (audio.size > MAX_AUDIO) throw new HttpError(413, "Áudio muito longo (máx. ~2 minutos)");
      const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
      transcript = await transcribe(audio, `comando.${ext}`);
    } else {
      const body = (await readJson(req, 8_000)) as { text?: unknown };
      transcript = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
    }
    if (!transcript) throw new HttpError(422, "Não consegui ouvir nada. Tente falar mais perto do microfone.");

    const sb = await supabaseServer();
    const [{ data: stages }, { data: tags }, { data: members }] = await Promise.all([
      sb.from("stages").select("id, name, position, pipeline_id").order("position"),
      sb.from("tags").select("id, name"),
      sb.from("organization_members").select("user_id, profiles!inner(full_name, email)").eq("organization_id", ctx.org.id),
    ]);
    const stageList = (stages ?? []) as { id: string; name: string }[];
    const tagList = (tags ?? []) as { id: string; name: string }[];
    type MemberRow = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] };
    const memberList = ((members ?? []) as MemberRow[]).map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { id: m.user_id, name: p?.full_name || p?.email || "Usuário" };
    });

    const { calls, reply } = await interpret(transcript, {
      stages: stageList.map((s) => s.name),
      tags: tagList.map((t) => t.name),
      members: memberList.map((m) => m.name),
    });

    const issues: string[] = [];
    const actions: ResolvedAction[] = [];
    const leadCache = new Map<string, { leadId: string | null; leadName: string; leadCandidates: { id: string; name: string; phone: string | null }[] }>();

    const resolveLead = async (raw: unknown) => {
      const q = String(raw ?? "").trim();
      const key = norm(q);
      if (leadCache.has(key)) return leadCache.get(key)!;
      const { data } = await sb.rpc("search_leads", { org: ctx.org.id, q, max_results: 5 });
      const cands = ((data ?? []) as { id: string; name: string; phone: string | null; score: number }[]);
      const exact = cands.filter((c) => norm(c.name) === key);
      let res;
      if (exact.length === 1) res = { leadId: exact[0]!.id, leadName: exact[0]!.name, leadCandidates: [] };
      else if (cands.length === 1) res = { leadId: cands[0]!.id, leadName: cands[0]!.name, leadCandidates: [] };
      else if (cands.length > 1 && cands[0]!.score >= 0.6 && cands[0]!.score - (cands[1]?.score ?? 0) >= 0.25)
        res = { leadId: cands[0]!.id, leadName: cands[0]!.name, leadCandidates: [] };
      else res = { leadId: null, leadName: q, leadCandidates: cands.map(({ id, name, phone }) => ({ id, name, phone })) };
      if (!res.leadId && !res.leadCandidates.length) issues.push(`Não encontrei o lead "${q}".`);
      leadCache.set(key, res);
      return res;
    };
    const resolveTags = (raw: unknown) =>
      (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean).map((name) => {
        const t = bestMatch(tagList, name);
        return t ? { id: t.id, name: t.name } : { id: null, name: name.trim().slice(0, 40) };
      });

    for (const c of calls) {
      const i = c.input;
      switch (c.name) {
        case "move_lead": {
          const st = bestMatch(stageList, String(i.stage ?? ""));
          if (!st) { issues.push(`Não existe a etapa "${i.stage}".`); break; }
          actions.push({ kind: "move_lead", ...(await resolveLead(i.lead)), stageId: st.id, stageName: st.name });
          break;
        }
        case "add_tags":
          actions.push({ kind: "add_tags", ...(await resolveLead(i.lead)), tags: resolveTags(i.tags) });
          break;
        case "remove_tags": {
          const ts = resolveTags(i.tags).filter((t): t is { id: string; name: string } => Boolean(t.id));
          if (!ts.length) { issues.push("Tag para remover não encontrada."); break; }
          actions.push({ kind: "remove_tags", ...(await resolveLead(i.lead)), tags: ts });
          break;
        }
        case "create_lead": {
          const st = (i.stage ? bestMatch(stageList, String(i.stage)) : null) ?? stageList[0];
          if (!st) { issues.push("Nenhuma etapa configurada."); break; }
          const value = Number(i.value);
          actions.push({
            kind: "create_lead", name: String(i.name ?? "").trim().slice(0, 160) || "Novo lead",
            phone: normalizePhone(i.phone), stageId: st.id, stageName: st.name,
            value: Number.isFinite(value) && value >= 0 ? value : null, tags: i.tags ? resolveTags(i.tags) : [],
          });
          break;
        }
        case "set_value": {
          const value = Number(i.value);
          if (!Number.isFinite(value) || value < 0) { issues.push("Valor inválido."); break; }
          actions.push({ kind: "set_value", ...(await resolveLead(i.lead)), value });
          break;
        }
        case "assign_lead": {
          const m = bestMatch(memberList, String(i.member ?? ""));
          if (!m) { issues.push(`Não encontrei "${i.member}" na equipe.`); break; }
          actions.push({ kind: "assign_lead", ...(await resolveLead(i.lead)), userId: m.id, userName: m.name });
          break;
        }
        case "add_note":
          actions.push({ kind: "add_note", ...(await resolveLead(i.lead)), note: String(i.note ?? "").slice(0, 2000) });
          break;
      }
    }

    if (!calls.length && reply) issues.push(reply);
    return ok({ transcript, actions, issues });
  } catch (e) {
    return fail(e);
  }
}

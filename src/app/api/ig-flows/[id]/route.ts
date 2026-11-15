import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFlowRow, FlowBody, type FlowInput } from "@/lib/ig-flows-save";
import type { IgFlowRow } from "@/lib/ig-flows";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
type Row = IgFlowRow & { organization_id: string };

async function load(orgId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Automação não encontrada");
  const { data } = await supabaseAdmin().from("ig_flows").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (!data) throw new HttpError(404, "Automação não encontrada");
  return data as Row;
}

/** Quem entrou no fluxo (últimos 100). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const flow = await load(ctx.org.id, (await params).id);
    const { data } = await supabaseAdmin().from("ig_flow_runs").select("id, username, step, status, follow_blocks, error, updated_at").eq("flow_id", flow.id).order("updated_at", { ascending: false }).limit(100);
    return ok({ flow, runs: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

const Toggle = z.object({ enabled: z.boolean() }).strict();

/** Salva o fluxo inteiro, ou só liga/desliga quando vem apenas { enabled }. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const prev = await load(ctx.org.id, (await params).id);
    const body = await readJson(req);
    const t = Toggle.safeParse(body);
    let p: FlowInput;
    if (t.success) {
      // Religar mantém a data já escolhida (em UTC, por isso o fuso UTC aqui)
      p = FlowBody.parse({
        name: prev.name, channelId: prev.channel_id, enabled: t.data.enabled, postMode: prev.post_mode, postMedia: prev.post_media, postCaption: prev.post_caption,
        postAt: prev.post_at ? prev.post_at.slice(0, 16) : null, timeZone: "UTC", postMediaId: prev.post_media_id, postPermalink: prev.post_permalink,
        keywords: prev.keywords, commentReply: prev.comment_reply, steps: prev.steps, finalText: prev.final_text, finalButton: prev.final_button, finalUrl: prev.final_url,
        finalRequireFollow: prev.final_require_follow, notFollowingText: prev.not_following_text,
      });
    } else p = FlowBody.parse(body);
    const row = await buildFlowRow(ctx.org.id, p, prev);
    if (t.success) row.time_zone = prev.time_zone;
    const { data, error } = await supabaseAdmin().from("ig_flows").update(row).eq("id", prev.id).select("*").single();
    if (error) throw error;
    // Trocou o arquivo: apaga o antigo
    const old = prev.post_media?.path, now = (data as Row).post_media?.path;
    if (old && old !== now && prev.post_status !== "published") await supabaseAdmin().storage.from("ig-posts").remove([old]);
    return ok({ flow: data });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const flow = await load(ctx.org.id, (await params).id);
    if (flow.post_status === "processing") throw new HttpError(409, "A publicação está sendo enviada ao Instagram agora. Tente de novo em um minuto.");
    const { error } = await supabaseAdmin().from("ig_flows").delete().eq("id", flow.id);
    if (error) throw error;
    if (flow.post_media?.path) await supabaseAdmin().storage.from("ig-posts").remove([flow.post_media.path]);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

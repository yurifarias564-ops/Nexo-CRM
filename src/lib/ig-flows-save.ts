import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TZ, isValidTimeZone, zonedToUtc } from "@/lib/time";
import { hasIgScope } from "@/lib/instagram";
import { flowProblems, IG_LIMITS, type IgFlowRow } from "@/lib/ig-flows";

const Step = z.object({
  text: z.string().trim().max(IG_LIMITS.text, "Mensagem com mais de 640 caracteres"),
  button: z.string().trim().max(IG_LIMITS.button, "Botão com mais de 20 caracteres"),
  requireFollow: z.boolean().default(false),
});
const Media = z.object({ path: z.string().min(3).max(300), mime: z.string().max(80), kind: z.enum(["video", "image"]), name: z.string().max(160), size: z.number().int().positive() });

export const FlowBody = z.object({
  name: z.string().trim().min(1, "Dê um nome à automação").max(120),
  channelId: z.string().uuid(),
  enabled: z.boolean().default(false),
  postMode: z.enum(["schedule", "existing", "any"]),
  postMedia: Media.nullable().default(null),
  postCaption: z.string().max(IG_LIMITS.caption, "Legenda com mais de 2.200 caracteres").nullable().default(null),
  postAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida").nullable().default(null),
  postNow: z.boolean().default(false),
  timeZone: z.string().default(DEFAULT_TZ),
  postMediaId: z.string().regex(/^\d{5,30}$/).nullable().default(null),
  postPermalink: z.string().url().max(300).nullable().default(null),
  keywords: z.array(z.string().trim().min(1).max(40)).max(IG_LIMITS.keywords).default([]),
  commentReply: z.string().trim().max(300).nullable().default(null),
  steps: z.array(Step).max(IG_LIMITS.steps),
  finalText: z.string().trim().max(IG_LIMITS.text).nullable().default(null),
  finalButton: z.string().trim().max(IG_LIMITS.button).nullable().default(null),
  finalUrl: z.string().trim().max(500).nullable().default(null),
  finalRequireFollow: z.boolean().default(false),
  notFollowingText: z.string().trim().max(IG_LIMITS.text).nullable().default(null),
});
export type FlowInput = z.infer<typeof FlowBody>;

type Existing = (IgFlowRow & { organization_id: string }) | null;

export async function igChannel(orgId: string, channelId: string) {
  const { data } = await supabaseAdmin().from("whatsapp_channels").select("id, status, ig_username, ig_scopes").eq("id", channelId).eq("organization_id", orgId).eq("provider", "instagram").maybeSingle();
  if (!data) throw new HttpError(404, "Conta do Instagram não encontrada");
  return data as { id: string; status: string; ig_username: string | null; ig_scopes: string | null };
}

/** Monta a linha do fluxo a partir do formulário, conferindo o que precisa estar certo para ligar. */
export async function buildFlowRow(orgId: string, p: FlowInput, prev: Existing) {
  const ch = await igChannel(orgId, p.channelId);
  const tz = isValidTimeZone(p.timeZone) ? p.timeZone : DEFAULT_TZ;
  const locked = prev && (prev.post_status === "processing" || prev.post_status === "published"); // já foi (ou está indo) para o Instagram
  const row: Record<string, unknown> = {
    name: p.name, channel_id: p.channelId, enabled: p.enabled, keywords: [...new Set(p.keywords)], comment_reply: p.commentReply || null,
    steps: p.steps.map((s, i) => ({ ...s, requireFollow: i === 0 ? false : s.requireFollow })),
    final_text: p.finalText || null, final_button: p.finalButton || null, final_url: p.finalUrl || null,
    final_require_follow: p.finalRequireFollow, not_following_text: p.notFollowingText || null, time_zone: tz,
  };
  let postAt: Date | null = prev?.post_at ? new Date(prev.post_at) : null;
  if (!locked) {
    row.post_mode = p.postMode;
    if (p.postMode === "schedule") {
      if (p.postMedia && !p.postMedia.path.startsWith(`${orgId}/`)) throw new HttpError(403, "Arquivo de outra empresa");
      postAt = p.postNow ? new Date() : p.postAt ? zonedToUtc(p.postAt, tz) : null;
      Object.assign(row, { post_media: p.postMedia, post_caption: p.postCaption || null, post_at: postAt?.toISOString() ?? null, post_media_id: null, post_permalink: null, post_container_id: null, post_error: null });
    } else {
      Object.assign(row, { post_media: null, post_caption: null, post_at: null, post_media_id: p.postMode === "existing" ? p.postMediaId : null, post_permalink: p.postMode === "existing" ? p.postPermalink : null, post_status: "none" });
    }
  }
  const view = { ...(prev ?? {}), ...row } as unknown as IgFlowRow;
  if (!locked && p.postMode === "schedule") row.post_status = "none";
  if (p.enabled) {
    const problems = flowProblems({ ...view, post_status: (locked ? prev!.post_status : "none") });
    if (problems.length) throw new HttpError(422, problems[0]!);
    if (ch.status !== "connected") throw new HttpError(409, "A conta do Instagram está desconectada. Reconecte para ligar a automação.");
    if (!hasIgScope(ch.ig_scopes, "comments")) throw new HttpError(409, "Falta a permissão de comentários. Toque em \"Liberar automações\" para reconectar o Instagram.");
    if (!locked && p.postMode === "schedule") {
      if (!hasIgScope(ch.ig_scopes, "publish")) throw new HttpError(409, "Falta a permissão de publicar. Toque em \"Liberar automações\" para reconectar o Instagram.");
      if (!postAt) throw new HttpError(422, "Escolha o dia e a hora da publicação");
      if (!p.postNow && postAt.getTime() < Date.now() - 2 * 60_000) throw new HttpError(422, "A data da publicação já passou");
      Object.assign(row, { post_status: "scheduled", post_attempts: 0 });
    }
  }
  return row;
}

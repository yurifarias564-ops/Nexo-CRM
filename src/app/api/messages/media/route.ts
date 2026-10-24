import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_MEDIA_BYTES, sendMediaFile } from "@/lib/send";

export const runtime = "nodejs";
export const maxDuration = 120;

const Fields = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    caption: z.string().max(1024, "Legenda muito longa").default(""),
    ptv: z.boolean().default(false),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Envia foto, vídeo, áudio ou documento pelo WhatsApp. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    if (Number(req.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES + 64_000) throw new HttpError(413, "Arquivo maior que 16 MB");
    await rateLimit(`media:${ctx.userId}`, 20, 60, "Muitos arquivos em sequência. Aguarde alguns segundos.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(422, "Arquivo não recebido");
    const f = Fields.parse({
      conversationId: form.get("conversationId") || undefined,
      leadId: form.get("leadId") || undefined,
      caption: String(form.get("caption") ?? "").trim(),
      ptv: form.get("ptv") === "1",
    });
    const r = await sendMediaFile(await supabaseServer(), ctx.org.id, ctx.userId, { conversationId: f.conversationId, leadId: f.leadId }, file, f.caption, { ptv: f.ptv });
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}

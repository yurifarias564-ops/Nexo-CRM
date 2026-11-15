import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IG_LIMITS } from "@/lib/ig-flows";

export const runtime = "nodejs";

const Body = z.object({ name: z.string().min(1).max(200), mime: z.string().max(80), size: z.number().int().positive() });
const KIND: Record<string, "video" | "image"> = { "video/mp4": "video", "video/quicktime": "video", "image/jpeg": "image" };

/**
 * Libera o envio do vídeo/foto da publicação direto para o armazenamento
 * (vídeo é grande demais para passar pelo servidor). Devolve o caminho e a chave de envio.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`ig-upload:${ctx.org.id}`, 30, 3600, "Muitos arquivos nesta hora. Aguarde um pouco.");
    const p = Body.parse(await readJson(req));
    const mime = p.mime.split(";")[0]!.toLowerCase();
    const kind = KIND[mime];
    if (!kind) throw new HttpError(422, "Use vídeo MP4 ou MOV, ou foto JPG (o Instagram não aceita PNG na publicação automática)");
    if (kind === "video" && p.size > IG_LIMITS.videoBytes) throw new HttpError(413, "Vídeo maior que 100 MB");
    if (kind === "image" && p.size > IG_LIMITS.imageBytes) throw new HttpError(413, "Foto maior que 8 MB");
    const ext = mime === "video/mp4" ? "mp4" : mime === "video/quicktime" ? "mov" : "jpg";
    const path = `${ctx.org.id}/${Date.now().toString(36)}-${randomBytes(5).toString("hex")}.${ext}`;
    const { data, error } = await supabaseAdmin().storage.from("ig-posts").createSignedUploadUrl(path);
    if (error || !data) throw new HttpError(502, `Não consegui preparar o envio: ${error?.message ?? "erro"}`);
    return ok({ path, token: data.token, media: { path, mime, kind, name: p.name.slice(0, 160), size: p.size } });
  } catch (e) {
    return fail(e);
  }
}

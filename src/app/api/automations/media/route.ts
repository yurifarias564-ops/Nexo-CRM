import { randomBytes } from "node:crypto";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MAX_MEDIA_BYTES } from "@/lib/send";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Arquivo para um bloco "Enviar mensagem" (foto, vídeo, áudio ou documento). Fica guardado só para a empresa. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`auto-media:${ctx.org.id}`, 60, 3600, "Muitos arquivos nesta hora. Aguarde um pouco.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new HttpError(422, "Arquivo não recebido");
    if (file.size > MAX_MEDIA_BYTES) throw new HttpError(413, "Arquivo maior que 16 MB (limite do WhatsApp)");
    const mime = (file.type || "application/octet-stream").split(";")[0]!.toLowerCase();
    const base = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/^_+/, "").slice(-100) || "arquivo";
    const path = `${ctx.org.id}/${randomBytes(4).toString("hex")}-${base}`;
    const { error } = await supabaseAdmin().storage.from("automation-media").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false });
    if (error) throw new HttpError(502, `Não consegui guardar o arquivo: ${error.message}`);
    return ok({ path, mime, name: file.name.slice(0, 160), size: file.size }, 201);
  } catch (e) {
    return fail(e);
  }
}

import { randomUUID } from "node:crypto";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { BUCKET } from "@/lib/reports/run";
import { extractBlueprint, MAX_TEMPLATE_BYTES, templateKind } from "@/lib/reports/blueprint";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Recebe o relatório de exemplo (PDF, Word ou texto), guarda e extrai o modelo. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`tpl-upload:${ctx.userId}`, 10, 3600, "Muitos modelos enviados nesta hora. Aguarde um pouco.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_TEMPLATE_BYTES + 64_000) throw new HttpError(413, "Arquivo maior que 15 MB");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new HttpError(422, "Envie o arquivo do relatório de exemplo");
    if (file.size > MAX_TEMPLATE_BYTES) throw new HttpError(413, "Arquivo maior que 15 MB");
    const kind = templateKind(file.type, file.name);
    if (!kind) throw new HttpError(422, "Formato não suportado. Envie PDF, Word (.docx) ou texto.");
    const name = String(form.get("name") ?? "").trim().slice(0, 120) || file.name.replace(/\.[^.]+$/, "").slice(0, 120);

    const buf = Buffer.from(await file.arrayBuffer());
    if (kind === "pdf" && buf.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(422, "O arquivo não é um PDF válido");
    if (kind === "docx" && buf.subarray(0, 2).toString() !== "PK") throw new HttpError(422, "O arquivo não é um Word (.docx) válido");

    const id = randomUUID();
    const ext = kind === "pdf" ? "pdf" : kind === "docx" ? "docx" : "txt";
    const path = `templates/${ctx.userId}/${id}.${ext}`;
    const db = supabaseAdmin();
    const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream" });
    if (up.error) throw up.error;
    try {
      const blueprint = await extractBlueprint(buf, kind);
      const { error } = await db.from("report_templates").insert({
        id, owner_id: ctx.userId, name, file_name: file.name.slice(0, 200), file_mime: file.type || "application/octet-stream", file_path: path, blueprint,
      });
      if (error) throw error;
      return ok({ id, name, blueprint }, 201);
    } catch (e) {
      await db.storage.from(BUCKET).remove([path]);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}

import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";
import { BUCKET } from "@/lib/reports/run";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Baixa o arquivo original do modelo (somente o dono). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Modelo não encontrado");
    await requireApiContext({ allowInactive: true });
    const { data: t } = await (await supabaseServer()).from("report_templates").select("file_path, file_name, file_mime").eq("id", id).maybeSingle();
    if (!t) throw new HttpError(404, "Modelo não encontrado");
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(t.file_path);
    if (error || !data) throw new HttpError(404, "Arquivo não encontrado");
    return new Response(data, {
      headers: {
        "Content-Type": t.file_mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(t.file_name)}"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

/** Exclui o modelo (somente o dono). Empresas que usavam ficam sem modelo. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Modelo não encontrado");
    await requireApiContext({ allowInactive: true });
    const sb = await supabaseServer();
    const { data: t } = await sb.from("report_templates").select("id, file_path").eq("id", id).maybeSingle();
    if (!t) throw new HttpError(404, "Modelo não encontrado");
    const { error } = await sb.from("report_templates").delete().eq("id", id);
    if (error) throw error;
    await supabaseAdmin().storage.from(BUCKET).remove([t.file_path]);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}

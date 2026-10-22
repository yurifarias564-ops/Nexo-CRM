import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError } from "@/lib/http";
import { BUCKET } from "@/lib/reports/run";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abre o PDF de um relatório gerado (RLS: só a equipe da empresa). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "Relatório não encontrado");
    await requireApiContext();
    const { data: run } = await (await supabaseServer()).from("report_runs").select("pdf_path, period").eq("id", id).maybeSingle();
    if (!run?.pdf_path) throw new HttpError(404, "Relatório não encontrado");
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(run.pdf_path);
    if (error || !data) throw new HttpError(404, "Arquivo não encontrado");
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(data, {
      headers: {
        "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="relatorio-${String(run.period).slice(0, 7)}.pdf"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

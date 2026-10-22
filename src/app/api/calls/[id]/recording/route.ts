import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok } from "@/lib/http";
import { CALLS_BUCKET } from "@/lib/calls";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 100 * 1024 * 1024;

async function load(id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "Ligação não encontrada");
  const { data } = await (await supabaseServer()).from("wa_calls")
    .select("id, organization_id, recording_mode, recording_path, recording_mime, backup_path, backup_mime, started_by, answered_by").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Ligação não encontrada");
  return data;
}

/** Ouvir/baixar a gravação. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiContext();
    const c = await load((await params).id);
    const q = new URL(req.url).searchParams;
    // Principal (WhatsApp) quando existe; senão a cópia gravada no navegador
    const useBackup = q.get("copia") === "1" || !c.recording_path;
    const path = useBackup ? c.backup_path : c.recording_path;
    const mime = useBackup ? c.backup_mime : c.recording_mime;
    if (!path) throw new HttpError(404, "Gravação ainda não disponível");
    const { data, error } = await supabaseAdmin().storage.from(CALLS_BUCKET).download(path);
    if (error || !data) throw new HttpError(404, "Gravação não encontrada");
    const ext = path.split(".").pop();
    const dl = q.get("download") === "1";
    return new Response(data, {
      headers: {
        "Content-Type": mime || "audio/ogg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="ligacao-${c.id.slice(0, 8)}.${ext}"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Gravação feita no navegador. Toda ligação manda a sua: no modo "navegador" ela é
 * a gravação principal; no modo WhatsApp fica como cópia de segurança.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiContext();
    const c = await load((await params).id);
    if (c.started_by !== ctx.userId && c.answered_by !== ctx.userId) throw new HttpError(403, "Só quem participou da ligação envia a gravação");
    const main = c.recording_mode === "browser";
    if (main ? c.recording_path : c.backup_path) return ok({ saved: true });
    if (Number(req.headers.get("content-length") ?? 0) > MAX) throw new HttpError(413, "Gravação muito grande");
    const blob = await req.blob();
    if (!blob.size || blob.size > MAX) throw new HttpError(422, "Gravação vazia ou muito grande");
    const mime = (blob.type || "audio/webm").split(";")[0]!;
    if (!mime.startsWith("audio/")) throw new HttpError(422, "Formato inválido");
    const path = `${c.organization_id}/${c.id}${main ? "" : "-navegador"}.${mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm"}`;
    const db = supabaseAdmin();
    const up = await db.storage.from(CALLS_BUCKET).upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: mime, upsert: true });
    if (up.error) throw up.error;
    await db.from("wa_calls").update(main ? { recording_path: path, recording_mime: mime, updated_at: new Date().toISOString() }
      : { backup_path: path, backup_mime: mime, updated_at: new Date().toISOString() }).eq("id", c.id);
    return ok({ saved: true }, 201);
  } catch (e) {
    return fail(e);
  }
}

import { fail, HttpError, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { brandingTarget } from "@/lib/branding/access";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Envia a logo (kind=logo) ou o ícone (kind=icon) da empresa. PNG, JPG ou WEBP até 2 MB. */
export async function POST(req: Request) {
  try {
    const { orgId } = await brandingTarget(req);
    const kind = new URL(req.url).searchParams.get("kind");
    if (kind !== "logo" && kind !== "icon") throw new HttpError(422, "Tipo de imagem inválido");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(422, "Envie uma imagem");
    const ext = TYPES[file.type];
    if (!ext) throw new HttpError(422, "Use PNG, JPG ou WEBP");
    if (file.size > 2 * 1024 * 1024) throw new HttpError(413, "Imagem muito grande (máx. 2 MB)");
    const buf = Buffer.from(await file.arrayBuffer());
    // Confere a assinatura do arquivo (não confia só no tipo informado)
    const sig = buf.subarray(0, 12).toString("hex");
    const okSig = (ext === "png" && sig.startsWith("89504e47")) || (ext === "jpg" && sig.startsWith("ffd8ff")) || (ext === "webp" && sig.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP");
    if (!okSig) throw new HttpError(422, "Arquivo de imagem inválido");

    const db = supabaseAdmin();
    const path = `${orgId}/${kind}-${Date.now()}.${ext}`;
    const { error } = await db.storage.from("branding").upload(path, buf, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (error) throw error;
    const url = db.storage.from("branding").getPublicUrl(path).data.publicUrl;
    const { error: e2 } = await db.from("org_branding").upsert({ organization_id: orgId, [`${kind}_url`]: url, updated_at: new Date().toISOString() });
    if (e2) throw e2;
    return ok({ url });
  } catch (e) {
    return fail(e);
  }
}

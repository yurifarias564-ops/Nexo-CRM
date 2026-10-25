import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/tracking/shared";
import { LinkBody } from "@/lib/tracking/schema";

export const runtime = "nodejs";

/** Links rastreados da empresa. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { data, error } = await supabaseAdmin().from("tracking_links").select("*").eq("organization_id", ctx.org.id).eq("archived", false).order("created_at", { ascending: false });
    if (error) throw error;
    return ok({ links: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = LinkBody.parse(await readJson(req, 20_000));
    const db = supabaseAdmin();
    if (b.channel_id) {
      const { data: ch } = await db.from("whatsapp_channels").select("id").eq("id", b.channel_id).eq("organization_id", ctx.org.id).maybeSingle();
      if (!ch) throw new HttpError(422, "Número de WhatsApp inválido");
    }
    if (b.kind === "site") {
      const { data: site } = await db.from("tracking_links").select("id").eq("organization_id", ctx.org.id).eq("kind", "site").eq("archived", false).maybeSingle();
      if (site) throw new HttpError(409, "O script do site já existe");
    }
    let slug = b.slug ?? (slugify(b.name) || "link");
    if (slug.length < 3) slug = `${slug}-link`;
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? slug : `${slug.slice(0, 33)}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await db.from("tracking_links").insert({ ...b, slug: candidate, organization_id: ctx.org.id, created_by: ctx.userId }).select("*").single();
      if (!error) return ok({ link: data }, 201);
      if (error.code !== "23505") throw error;
      if (b.slug) throw new HttpError(409, "Esse endereço já está em uso. Escolha outro.");
    }
    throw new HttpError(409, "Não consegui criar um endereço único. Tente outro nome.");
  } catch (e) {
    return fail(e);
  }
}

import { randomInt } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as a4 from "@/lib/voip/api4com";
import { loadVoip } from "@/lib/voip";

export const runtime = "nodejs";

const Body = z.object({
  userId: z.string().uuid(),
  // Ramal que já existe na Api4Com (opcional). Sem isso, o sistema cria o próximo livre.
  ramal: z.string().trim().regex(/^[0-9]{2,10}$/, "Ramal inválido").optional(),
  sipPass: z.string().min(4).max(200).optional(),
});

function generateSipPass() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 16 }, () => abc[randomInt(abc.length)]).join("");
}

/** Dá um ramal para a pessoa da equipe (cria na central ou vincula um existente). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`voip-ext:${ctx.org.id}`, 60, 3600);
    const b = Body.parse(await readJson(req, 4_000));
    if (Boolean(b.ramal) !== Boolean(b.sipPass)) throw new HttpError(422, "Informe ramal e senha juntos (ou deixe os dois vazios para criar um novo).");
    const v = await loadVoip(ctx.org.id);
    const db = supabaseAdmin();
    const { data: member } = await db.from("organization_members").select("user_id, profiles(full_name)").eq("organization_id", ctx.org.id).eq("user_id", b.userId).maybeSingle();
    if (!member) throw new HttpError(404, "Pessoa não encontrada na equipe");
    const { data: existing } = await db.from("voip_extensions").select("id").eq("organization_id", ctx.org.id).eq("user_id", b.userId).maybeSingle();
    if (existing) throw new HttpError(409, "Esta pessoa já tem ramal");

    let ramal = b.ramal ?? null;
    let sipPass = b.sipPass ?? null;
    let domain = v.domain;
    if (!ramal) {
      const { data: u } = await db.auth.admin.getUserById(b.userId);
      const prof = (Array.isArray(member.profiles) ? member.profiles[0] : member.profiles) as { full_name: string | null } | null;
      const [first, ...rest] = (prof?.full_name || u.user?.email?.split("@")[0] || "Vendedor").trim().split(/\s+/);
      sipPass = generateSipPass();
      const ext = await a4.createExtension(v.api_token, { firstName: first!, lastName: rest.join(" "), email: u.user?.email ?? `${b.userId}@nexo.invalid`, sipPass });
      ramal = String(ext.ramal);
      if (ext.senha) sipPass = String(ext.senha);
      if (ext.domain) domain = String(ext.domain).toLowerCase();
    }
    if (!/^[0-9]{2,10}$/.test(ramal)) throw new HttpError(502, "Ramal devolvido pela central é inválido");
    if (domain && domain !== v.domain) await db.from("voip_settings").update({ domain, updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);

    const { data: row, error } = await db.from("voip_extensions").insert({ organization_id: ctx.org.id, user_id: b.userId, ramal, domain }).select("id").single();
    if (error) throw error.code === "23505" ? new HttpError(409, "Este ramal já está com outra pessoa") : error;
    const s = await db.from("voip_extension_secrets").insert({ extension_id: row.id, sip_password: sipPass! });
    if (s.error) { await db.from("voip_extensions").delete().eq("id", row.id); throw s.error; }
    return ok({ id: row.id, ramal }, 201);
  } catch (e) {
    return fail(e);
  }
}

/** Remove o ramal da pessoa no CRM (não apaga na central). */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const userId = new URL(req.url).searchParams.get("userId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(422, "Pessoa inválida");
    const { error } = await supabaseAdmin().from("voip_extensions").delete().eq("organization_id", ctx.org.id).eq("user_id", userId);
    if (error) throw error;
    return ok({ removed: true });
  } catch (e) {
    return fail(e);
  }
}

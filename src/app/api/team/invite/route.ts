import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { fail, HttpError, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(254),
  role: z.enum(["admin", "agent"]),
});

/** Convida alguém para a empresa. Se a pessoa já tem conta, entra direto. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`invite:${ctx.org.id}`, 30, 3600, "Limite de convites por hora atingido.");
    const { email, role } = Body.parse(await readJson(req));
    const db = supabaseAdmin();

    const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing) {
      const { error } = await db.from("organization_members").insert({ organization_id: ctx.org.id, user_id: existing.id, role });
      if (error?.code === "23505") throw new HttpError(409, "Essa pessoa já faz parte da equipe");
      if (error) throw error;
      return ok({ status: "added" as const });
    }

    const { error: invErr } = await db.from("organization_invites").insert({ organization_id: ctx.org.id, email, role, invited_by: ctx.userId });
    if (invErr?.code === "23505") throw new HttpError(409, "Já existe um convite pendente para este e-mail");
    if (invErr) throw invErr;

    const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl()}/auth/callback?next=/auth/reset` });
    if (error) {
      await db.from("organization_invites").delete().eq("organization_id", ctx.org.id).eq("email", email).is("accepted_at", null);
      throw new HttpError(422, `Não foi possível enviar o convite: ${error.message}`);
    }
    return ok({ status: "invited" as const });
  } catch (e) {
    return fail(e);
  }
}

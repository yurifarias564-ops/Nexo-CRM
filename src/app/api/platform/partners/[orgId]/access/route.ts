import { fail, HttpError, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit, requireHouse } from "@/lib/platform/partners";

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/** Entrar na conta do cliente como suporte (vira administrador temporário e abre a conta dele). */
export async function POST(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    if (!UUID.test(orgId)) throw new HttpError(404, "Não encontrado");
    const ctx = await requireHouse();
    const db = supabaseAdmin();
    const { data: org } = await db.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
    if (!org) throw new HttpError(404, "Empresa não encontrada");
    const { data: member } = await db.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", ctx.userId).maybeSingle();
    if (!member) {
      // Primeiro a marca de "suporte" (é ela que permite remover o acesso depois), depois o acesso
      const mark = await db.from("platform_support_access").upsert({ organization_id: orgId, user_id: ctx.userId, created_at: new Date().toISOString() });
      if (mark.error) throw mark.error;
      const { error } = await db.from("organization_members").insert({ organization_id: orgId, user_id: ctx.userId, role: "admin" });
      if (error) {
        await db.from("platform_support_access").delete().eq("organization_id", orgId).eq("user_id", ctx.userId);
        throw error;
      }
    }
    await db.from("profiles").update({ current_organization_id: orgId }).eq("id", ctx.userId);
    await audit(ctx.userId, orgId, "acessou a conta (suporte)");
    return ok({ ok: true, name: org.name });
  } catch (e) {
    return fail(e);
  }
}

/** Sair da conta do cliente: remove o acesso de suporte e volta para a sua empresa. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    if (!UUID.test(orgId)) throw new HttpError(404, "Não encontrado");
    const ctx = await requireHouse();
    const db = supabaseAdmin();
    const { data: sup } = await db.from("platform_support_access").select("organization_id").eq("organization_id", orgId).eq("user_id", ctx.userId).maybeSingle();
    if (sup) {
      await db.from("organization_members").delete().eq("organization_id", orgId).eq("user_id", ctx.userId).neq("role", "owner");
      await db.from("platform_support_access").delete().eq("organization_id", orgId).eq("user_id", ctx.userId);
    }
    const { data: home } = await db.from("organization_members").select("organization_id").eq("user_id", ctx.userId).eq("role", "owner").order("created_at").limit(1).maybeSingle();
    await db.from("profiles").update({ current_organization_id: home?.organization_id ?? null }).eq("id", ctx.userId);
    await audit(ctx.userId, orgId, "saiu da conta (suporte)");
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

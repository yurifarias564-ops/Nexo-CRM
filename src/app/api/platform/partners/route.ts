import { fail, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { platformSettings, requireHouse } from "@/lib/platform/partners";

export const runtime = "nodejs";

/** Todas as empresas clientes, com status, vencimento, forma de pagamento e uso. */
export async function GET() {
  try {
    const ctx = await requireHouse();
    const db = supabaseAdmin();
    const [{ data: rows, error }, settings, { data: support }, { data: houseOrgs }] = await Promise.all([
      db.rpc("platform_partners"),
      platformSettings(),
      db.from("platform_support_access").select("organization_id").eq("user_id", ctx.userId),
      db.from("organization_members").select("organization_id").eq("user_id", ctx.userId).eq("role", "owner"),
    ]);
    if (error) throw error;
    const own = new Set((houseOrgs ?? []).map((o) => o.organization_id));
    const { data: channels } = own.size
      ? await db.from("whatsapp_channels").select("id, name, phone_number, provider, status, organization_id").in("organization_id", [...own])
      : { data: [] };
    return ok({
      partners: (rows ?? []).map((r: { id: string }) => ({ ...r, mine: own.has(r.id) })),
      settings, channels: channels ?? [],
      supporting: (support ?? []).map((s) => s.organization_id),
      currentOrg: ctx.org?.id ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}

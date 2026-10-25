import { z } from "zod";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { billingGroups, requireHouse } from "@/lib/platform/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Grupos do WhatsApp do número que envia as cobranças. */
export async function GET() {
  try {
    await requireHouse();
    return ok({ groups: await billingGroups() });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ billing_channel_id: z.string().uuid().nullable(), billing_hour: z.number().int().min(6).max(20) });

/** Número que manda as cobranças nos grupos e a hora do envio. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireHouse();
    const b = Body.parse(await readJson(req, 2000));
    const db = supabaseAdmin();
    if (b.billing_channel_id) {
      const { data: ch } = await db.from("whatsapp_channels").select("organization_id").eq("id", b.billing_channel_id).maybeSingle();
      const { data: own } = ch ? await db.from("organization_members").select("role").eq("organization_id", ch.organization_id).eq("user_id", ctx.userId).eq("role", "owner").maybeSingle() : { data: null };
      if (!own) throw new HttpError(422, "Escolha um número da sua própria empresa");
    }
    await db.from("platform_settings").upsert({ id: true, ...b, updated_at: new Date().toISOString() });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

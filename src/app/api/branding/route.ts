import { SUPABASE_URL } from "@/lib/supabase/config";
import { z } from "zod";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { brandingTarget } from "@/lib/branding/access";
import { domainsReady } from "@/lib/branding/vercel";

export const runtime = "nodejs";

/** Personalização da empresa (logo, nome, cores, login, domínio). */
export async function GET(req: Request) {
  try {
    const { ctx, orgId } = await brandingTarget(req);
    const db = supabaseAdmin();
    const [{ data }, { data: org }] = await Promise.all([
      db.from("org_branding").select("*").eq("organization_id", orgId).maybeSingle(),
      db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]);
    return ok({ branding: data, orgName: org?.name ?? "", canDomain: ctx.isHouse, domainsReady: domainsReady() });
  } catch (e) {
    return fail(e);
  }
}

const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => (v ? v : null));
const Body = z.object({
  app_name: opt(40),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida").nullable(),
  login_title: opt(120),
  login_subtitle: opt(300),
  support_whatsapp: z.string().trim().transform((v) => v.replace(/\D/g, "")).refine((v) => !v || /^\d{10,15}$/.test(v), "WhatsApp inválido (DDI + DDD + número)").nullable().optional(),
  hide_powered_by: z.boolean(),
  logo_url: z.string().url().max(500).nullable().optional(),
  icon_url: z.string().url().max(500).nullable().optional(),
});

export async function PUT(req: Request) {
  try {
    const { ctx, orgId } = await brandingTarget(req);
    const b = Body.parse(await readJson(req, 10_000));
    // "Sem a marca Nexo" é decisão do dono da plataforma (plano white label)
    const db = supabaseAdmin();
    const { data: cur } = await db.from("org_branding").select("hide_powered_by").eq("organization_id", orgId).maybeSingle();
    const hide = ctx.isHouse ? b.hide_powered_by : cur?.hide_powered_by ?? false;
    const row: Record<string, unknown> = {
      organization_id: orgId, app_name: b.app_name, primary_color: b.primary_color, login_title: b.login_title, login_subtitle: b.login_subtitle,
      support_whatsapp: b.support_whatsapp || null, hide_powered_by: hide, updated_at: new Date().toISOString(),
    };
    // Só aceita imagens do nosso armazenamento (vêm do upload)
    for (const k of ["logo_url", "icon_url"] as const) {
      if (b[k] === null) row[k] = null;
      else if (b[k] && b[k]!.startsWith(`${SUPABASE_URL}/storage/v1/object/public/branding/${orgId}/`) && !b[k]!.includes("..")) row[k] = b[k];
    }
    const { data, error } = await db.from("org_branding").upsert(row).select("*").single();
    if (error) throw error;
    return ok({ branding: data });
  } catch (e) {
    return fail(e);
  }
}

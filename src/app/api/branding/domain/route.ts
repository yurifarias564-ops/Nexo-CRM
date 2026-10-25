import { z } from "zod";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { brandingTarget } from "@/lib/branding/access";
import { cleanDomain } from "@/lib/branding/shared";
import { addDomain, domainState, removeDomain } from "@/lib/branding/vercel";
import { audit } from "@/lib/platform/partners";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";

async function current(orgId: string) {
  const { data } = await supabaseAdmin().from("org_branding").select("custom_domain").eq("organization_id", orgId).maybeSingle();
  return data?.custom_domain ?? null;
}

/** Situação do domínio próprio: registros de DNS que faltam e se já está no ar. */
export async function GET(req: Request) {
  try {
    const { orgId } = await brandingTarget(req, { houseOnly: true });
    const domain = await current(orgId);
    if (!domain) return ok({ domain: null });
    const st = await domainState(domain);
    const status = st.verified && st.configured ? "active" : "pending";
    await supabaseAdmin().from("org_branding").update({ domain_status: status, domain_checked_at: new Date().toISOString() }).eq("organization_id", orgId);
    return ok({ domain, status, ...st });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ domain: z.string().max(253) });

/** Liga um domínio próprio (ex.: crm.empresadocliente.com.br) à empresa. */
export async function POST(req: Request) {
  try {
    const { ctx, orgId } = await brandingTarget(req, { houseOnly: true });
    const domain = cleanDomain(Body.parse(await readJson(req, 2000)).domain);
    if (!domain) throw new HttpError(422, "Domínio inválido. Ex.: crm.suaempresa.com.br");
    if (domain === new URL(appUrl()).host || domain.endsWith(".vercel.app")) throw new HttpError(422, "Use um domínio do cliente.");
    const db = supabaseAdmin();
    const { data: taken } = await db.from("org_branding").select("organization_id").eq("custom_domain", domain).maybeSingle();
    if (taken && taken.organization_id !== orgId) throw new HttpError(409, "Esse domínio já está ligado a outra empresa.");
    const prev = await current(orgId);
    const st = await addDomain(domain);
    if (prev && prev !== domain) await removeDomain(prev).catch(() => undefined);
    const { error } = await db.from("org_branding").upsert({ organization_id: orgId, custom_domain: domain, domain_status: st.verified && st.configured ? "active" : "pending", domain_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error) throw error;
    await audit(ctx.userId, orgId, "domínio próprio", { domain });
    return ok({ domain, status: st.verified && st.configured ? "active" : "pending", ...st });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, orgId } = await brandingTarget(req, { houseOnly: true });
    const domain = await current(orgId);
    if (domain) await removeDomain(domain).catch(() => undefined);
    await supabaseAdmin().from("org_branding").update({ custom_domain: null, domain_status: null }).eq("organization_id", orgId);
    await audit(ctx.userId, orgId, "domínio removido", { domain });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

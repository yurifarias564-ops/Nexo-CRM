import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { DEFAULT_BRAND, type Brand } from "./shared";

type Row = {
  organization_id: string; app_name: string | null; logo_url: string | null; icon_url: string | null; primary_color: string | null;
  login_title: string | null; login_subtitle: string | null; support_whatsapp: string | null; hide_powered_by: boolean;
  custom_domain: string | null; domain_status: string | null;
};

export function toBrand(r: Row | null, orgName?: string): Brand {
  if (!r) return { ...DEFAULT_BRAND };
  return {
    appName: r.app_name || orgName || DEFAULT_BRAND.appName,
    logoUrl: r.logo_url, iconUrl: r.icon_url, primaryColor: r.primary_color || DEFAULT_BRAND.primaryColor,
    loginTitle: r.login_title, loginSubtitle: r.login_subtitle, supportWhatsapp: r.support_whatsapp,
    hidePoweredBy: r.hide_powered_by, custom: true,
  };
}

export const brandingRow = cache(async (orgId: string) => {
  const { data } = await supabaseAdmin().from("org_branding").select("*").eq("organization_id", orgId).maybeSingle();
  return (data as Row | null) ?? null;
});

export async function brandForOrg(orgId: string, orgName?: string) {
  return toBrand(await brandingRow(orgId), orgName);
}

/** Host da requisição (sem porta). */
export async function currentHost(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

const mainHost = () => { try { return new URL(appUrl()).host.toLowerCase(); } catch { return ""; } };

/** Marca pelo domínio acessado (login e páginas antes de entrar). Domínio principal = marca padrão. */
export const brandForHost = cache(async (): Promise<{ brand: Brand; orgId: string | null }> => {
  const host = await currentHost();
  if (!host || host === mainHost() || host.endsWith(".vercel.app") || host === "localhost") return { brand: { ...DEFAULT_BRAND }, orgId: null };
  const { data } = await supabaseAdmin().from("org_branding").select("*").eq("custom_domain", host.replace(/^www\./, "")).maybeSingle();
  const row = (data as Row | null) ?? null;
  return { brand: toBrand(row), orgId: row?.organization_id ?? null };
});

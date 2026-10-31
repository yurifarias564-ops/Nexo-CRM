import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { HttpError } from "@/lib/http";

const TOKEN = /^[a-f0-9]{40}$/;

/** Nome e logo da empresa para o cabeçalho do link. */
export async function orgBrand(orgId: string): Promise<{ logo: string | null; color: string | null; appName: string | null }> {
  const { data } = await supabaseAdmin().from("org_branding").select("logo_url, icon_url, primary_color, app_name").eq("organization_id", orgId).maybeSingle();
  return { logo: data?.logo_url ?? data?.icon_url ?? null, color: data?.primary_color ?? null, appName: data?.app_name ?? null };
}
export const shareUrl = (token: string) => `${appUrl()}/c/${token}`;

/** Empresa do link (ou 404). Só o que esta empresa tem fica acessível pelo link. */
export async function orgByToken(token: string): Promise<{ orgId: string; orgName: string }> {
  if (!TOKEN.test(token)) throw new HttpError(404, "Link inválido ou desativado");
  const db = supabaseAdmin();
  const { data } = await db.from("team_share_links").select("organization_id, last_used_at, organizations(name)").eq("token", token).maybeSingle();
  if (!data) throw new HttpError(404, "Link inválido ou desativado");
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 3_600_000) {
    void db.from("team_share_links").update({ last_used_at: new Date().toISOString() }).eq("token", token).then(() => undefined, () => undefined);
  }
  const o = data.organizations as { name?: string } | { name?: string }[] | null;
  return { orgId: data.organization_id, orgName: (Array.isArray(o) ? o[0]?.name : o?.name) ?? "" };
}

export async function getShare(orgId: string) {
  const { data } = await supabaseAdmin().from("team_share_links").select("token, created_at, last_used_at").eq("organization_id", orgId).maybeSingle();
  return data ? { url: shareUrl(data.token), createdAt: data.created_at, lastUsedAt: data.last_used_at } : null;
}

/** Cria o link (ou troca por um novo — o antigo para de funcionar). */
export async function rotateShare(orgId: string, userId: string | null) {
  const token = randomBytes(20).toString("hex");
  const { error } = await supabaseAdmin().from("team_share_links").upsert({ organization_id: orgId, token, created_by: userId, created_at: new Date().toISOString(), last_used_at: null });
  if (error) throw error;
  return getShare(orgId);
}

export async function disableShare(orgId: string) {
  await supabaseAdmin().from("team_share_links").delete().eq("organization_id", orgId);
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import type { Organization, Role, Subscription } from "@/lib/types";

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string;
  org: Organization | null;
  role: Role | null;
  subscription: Subscription | null;
  active: boolean;
  /** Dono da plataforma (painel de parceiros, acesso de suporte às contas). */
  isHouse: boolean;
  orgs: { id: string; name: string; role: Role }[];
}

/** Carrega usuário, empresa ativa, papel e assinatura (memoizado por requisição). */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: house }] = await Promise.all([
    supabase.from("profiles").select("full_name, current_organization_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("organization_members")
      .select("role, organization_id, organizations(id, name, created_at)")
      .eq("user_id", user.id),
    supabase.rpc("is_house").then((r) => r, () => ({ data: false })),
  ]);

  type M = { role: Role; organization_id: string; organizations: Organization | Organization[] | null };
  const orgs = ((memberships ?? []) as M[])
    .map((m) => {
      const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return o ? { id: o.id, name: o.name, role: m.role, created_at: o.created_at } : null;
    })
    .filter((x): x is { id: string; name: string; role: Role; created_at: string } => x !== null);

  const current = orgs.find((o) => o.id === profile?.current_organization_id) ?? orgs[0] ?? null;

  let subscription: Subscription | null = null;
  if (current) {
    const { data } = await supabase
      .from("subscriptions")
      .select("organization_id, status, checkout_url, value_cents, current_period_end")
      .eq("organization_id", current.id)
      .maybeSingle();
    subscription = (data as Subscription | null) ?? null;
  }

  const isHouse = house === true;
  // O dono da plataforma entra na conta do cliente mesmo com a assinatura vencida (suporte)
  const active = isHouse || (
    subscription?.status === "active" &&
    (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date()));

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? user.email ?? "",
    org: current ? { id: current.id, name: current.name, created_at: current.created_at } : null,
    role: current?.role ?? null,
    subscription,
    active,
    isHouse,
    orgs: orgs.map(({ id, name, role }) => ({ id, name, role })),
  };
});

/** Para páginas do app: exige login, empresa e assinatura ativa. */
export async function requireAppContext() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");
  if (!ctx.active) redirect("/billing");
  return ctx as SessionContext & { org: Organization; role: Role };
}

/** Páginas só de dono/administrador: o vendedor volta para o Funil. */
export async function requireManagerPage() {
  const ctx = await requireAppContext();
  if (ctx.role === "agent") redirect("/pipeline");
  return ctx;
}

/** Para rotas de API: mesmas regras, mas lança erro HTTP em vez de redirecionar. */
export async function requireApiContext(opts: { manage?: boolean; allowInactive?: boolean } = {}) {
  const ctx = await getSessionContext();
  if (!ctx) throw new HttpError(401, "Não autenticado");
  if (!ctx.org || !ctx.role) throw new HttpError(403, "Nenhuma empresa selecionada");
  if (!opts.allowInactive && !ctx.active) throw new HttpError(402, "Assinatura inativa. Regularize o pagamento.");
  if (opts.manage && ctx.role === "agent") throw new HttpError(403, "Apenas administradores podem fazer isso");
  return ctx as SessionContext & { org: Organization; role: Role };
}

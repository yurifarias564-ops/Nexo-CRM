import { requireAppContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { WorkspaceProvider } from "@/components/workspace";
import { AppShell } from "@/components/shell/app-shell";
import type { Member, Pipeline, QuickReply, Stage, Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const sb = await supabaseServer();
  const [p, s, t, m, q] = await Promise.all([
    sb.from("pipelines").select("*").order("position"),
    sb.from("stages").select("*").order("position"),
    sb.from("tags").select("*").order("name"),
    sb.from("organization_members").select("user_id, role, profiles(full_name, email)").eq("organization_id", ctx.org.id),
    sb.from("quick_replies").select("*").order("shortcut"),
  ]);
  const support = ctx.isHouse
    ? Boolean((await supabaseAdmin().from("platform_support_access").select("organization_id").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).maybeSingle()).data)
    : false;
  type MRow = { user_id: string; role: Member["role"]; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
  const members: Member[] = ((m.data ?? []) as MRow[]).map((r) => {
    const pr = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return { user_id: r.user_id, role: r.role, full_name: pr?.full_name ?? null, email: pr?.email ?? null };
  });

  return (
    <WorkspaceProvider
      initial={{
        orgId: ctx.org.id,
        orgName: ctx.org.name,
        userId: ctx.userId,
        userName: ctx.fullName,
        role: ctx.role,
        orgs: ctx.orgs,
        pipelines: (p.data ?? []) as Pipeline[],
        stages: (s.data ?? []) as Stage[],
        tags: (t.data ?? []) as Tag[],
        members,
        quickReplies: (q.data ?? []) as QuickReply[],
        isHouse: ctx.isHouse,
        supportMode: support,
      }}
    >
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}

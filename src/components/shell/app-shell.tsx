"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarClock, ChevronsUpDown, KanbanSquare, LogOut, MessageCircle, Settings, Users, FileBarChart } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Avatar } from "@/components/ui/misc";
import { Logo } from "@/components/logo";
import { VoiceCommand } from "@/components/voice/voice-command";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Painel", icon: BarChart3 },
  { href: "/pipeline", label: "Funil", icon: KanbanSquare },
  { href: "/inbox", label: "Conversas", icon: MessageCircle },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/agendadas", label: "Agendadas", icon: CalendarClock },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { href: "/settings", label: "Configurações", icon: Settings },
];

function useUnread(orgId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const { count: c } = await sb.from("conversations").select("id", { count: "exact", head: true }).gt("unread_count", 0);
      setCount(c ?? 0);
    };
    load();
    const ch = sb.channel(`unread:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `organization_id=eq.${orgId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 600);
      })
      .subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [orgId]);
  return count;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  const unread = useUnread(ws.orgId);
  const [orgMenu, setOrgMenu] = useState(false);

  async function switchOrg(id: string) {
    const { error } = await supabaseBrowser().rpc("switch_organization", { org: id });
    if (error) return toast.error(error.message);
    setOrgMenu(false);
    router.push("/pipeline");
    router.refresh();
  }
  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-ink-900/70 backdrop-blur md:flex">
        <div className="px-5 pb-4 pt-5"><Logo /></div>

        <div className="relative px-3">
          <button onClick={() => setOrgMenu((v) => !v)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 text-left text-sm hover:border-brand-400/40">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy-500 text-[11px] font-bold text-white">{ws.orgName[0]?.toUpperCase()}</span>
            <span className="flex-1 truncate font-medium text-slate-100">{ws.orgName}</span>
            <ChevronsUpDown className="h-4 w-4 text-slate-500" />
          </button>
          {orgMenu && ws.orgs.length > 0 && (
            <div className="absolute left-3 right-3 top-12 z-30 animate-fadeIn rounded-lg border border-line bg-ink-800 p-1 shadow-card">
              {ws.orgs.map((o) => (
                <button key={o.id} onClick={() => switchOrg(o.id)} className={cn("w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-ink-700", o.id === ws.orgId ? "text-brand-300" : "text-slate-200")}>
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="mt-6 flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: I }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} prefetch
                className={cn("group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active ? "bg-gradient-to-r from-brand-500/20 to-transparent text-white shadow-[inset_2px_0_0_0_#3b82f6]" : "text-slate-400 hover:bg-ink-800 hover:text-slate-100")}>
                <I className={cn("h-4 w-4", active ? "text-brand-300" : "text-slate-500 group-hover:text-slate-300")} />
                <span className="flex-1">{label}</span>
                {href === "/inbox" && unread > 0 && (
                  <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar name={ws.userName} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">{ws.userName}</p>
              <p className="text-xs capitalize text-slate-500">{ws.role === "owner" ? "Proprietário" : ws.role === "admin" ? "Administrador" : "Atendente"}</p>
            </div>
            <button onClick={logout} className="rounded-md p-1.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200" aria-label="Sair" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ink-950/60 px-4 backdrop-blur md:px-6">
          <div className="md:hidden"><Logo compact /></div>
          <nav className="flex gap-1 md:hidden">
            {NAV.map(({ href, icon: I, label }) => (
              <Link key={href} href={href} aria-label={label} className={cn("rounded-md p-2", path.startsWith(href) ? "bg-ink-800 text-brand-300" : "text-slate-400")}>
                <I className="h-4 w-4" />
              </Link>
            ))}
          </nav>
          <h1 className="hidden text-sm font-medium text-slate-300 md:block">
            {NAV.find((n) => path.startsWith(n.href))?.label}
          </h1>
          <div className="ml-auto"><VoiceCommand /></div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

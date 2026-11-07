"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarClock, Check, ChevronDown, KanbanSquare, LogOut, MessageCircle, Settings, Users, FileBarChart, UsersRound, PhoneCall, Bot, Handshake, PlayCircle, Workflow, Wallet, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Avatar } from "@/components/ui/misc";
import { Logo } from "@/components/logo";
import { Intro, replayIntro } from "@/components/intro/intro";
import { VoiceCommand } from "@/components/voice/voice-command";
import { CallProvider } from "@/components/calls/call-provider";
import { VoipProvider } from "@/components/calls/voip-provider";
import { cn } from "@/lib/utils";
import { ConnectionAlert } from "./connection-alert";
import { AssistantButton } from "@/components/assistant/assistant-panel";

const NAV: { href: string; label: string; icon: typeof BarChart3; seller?: boolean; main?: boolean }[] = [
  { main: true, href: "/dashboard", label: "Painel", icon: BarChart3 },
  { main: true, seller: true, href: "/pipeline", label: "Funil", icon: KanbanSquare },
  { main: true, seller: true, href: "/inbox", label: "Conversas", icon: MessageCircle },
  { href: "/agente", label: "Agente de IA", icon: Bot },
  { href: "/automacoes", label: "Automações", icon: Workflow },
  { href: "/ligacoes", label: "Ligações", icon: PhoneCall },
  { main: true, href: "/leads", label: "Leads", icon: Users },
  { main: true, href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/agendadas", label: "Agendadas", icon: CalendarClock },
  { main: true, seller: true, href: "/time", label: "Time", icon: UsersRound },
  { main: true, href: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { href: "/financas", label: "Finanças", icon: Wallet },
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

/** Clientes esperando resposta (aparece piscando em vermelho no "Painel"). */
function useWaiting(orgId: string, enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const sb = supabaseBrowser();
    const load = async () => {
      const { data } = await sb.rpc("unanswered_leads", { org: orgId, p_seller: null });
      setN((data ?? []).length);
    };
    const t = setTimeout(() => void load(), 0);
    const i = setInterval(() => void load(), 60_000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [orgId, enabled]);
  return n;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const base = ws.role === "agent" ? NAV.filter((n) => n.seller) : NAV;
  const nav = ws.isHouse && !ws.supportMode ? [...base, { href: "/parceiros", label: "Parceiros", icon: Handshake }] : base;
  const path = usePathname();
  const router = useRouter();
  const unread = useUnread(ws.orgId);
  const waiting = useWaiting(ws.orgId, ws.role !== "agent");
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

  const [more, setMore] = useState(false);
  const mainNav = ws.role === "agent" ? nav : nav.filter((n) => n.main);
  const moreNav = ws.role === "agent" ? [] : nav.filter((n) => !n.main);
  const moreActive = moreNav.some((n) => path.startsWith(n.href));
  const roleLabel = ws.role === "owner" ? "Proprietário" : ws.role === "admin" ? "Administrador" : "Vendedor";

  const badge = (href: string) => (
    <>
      {href === "/dashboard" && waiting > 0 && (
        <span className="nx-blink ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" title={`${waiting} cliente(s) esperando resposta`}>{waiting > 99 ? "99+" : waiting}</span>
      )}
      {href === "/inbox" && unread > 0 && (
        <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-brand-300" title={`${unread} conversa(s) não lida(s)`} />
      )}
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="relative z-30 shrink-0 bg-ink-950">
        <div className="flex h-16 items-center gap-3 px-4 md:px-6">
          <Link href="/dashboard" className="shrink-0"><Logo brand={ws.brand} /></Link>

          <nav className="ml-4 hidden min-w-0 lg:flex">
            <div className="pill-group">
              {mainNav.map(({ href, label }) => (
                <Link key={href} href={href} prefetch className={cn("pill flex items-center", path.startsWith(href) && "pill-active")}>
                  {label}{badge(href)}
                </Link>
              ))}
              {moreNav.length > 0 && (
                <div className="relative">
                  <button onClick={() => setMore((v) => !v)} className={cn("pill flex items-center gap-1", moreActive && "pill-active")}>
                    {moreActive ? moreNav.find((n) => path.startsWith(n.href))?.label : "Mais"}<ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {more && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMore(false)} />
                      <div className="absolute left-0 top-11 z-40 w-56 animate-fadeIn rounded-2xl border border-line bg-ink-850 p-1.5 shadow-2xl">
                        {moreNav.map(({ href, label, icon: I }) => (
                          <Link key={href} href={href} onClick={() => setMore(false)}
                            className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm", path.startsWith(href) ? "bg-ink-700 text-white" : "text-slate-300 hover:bg-ink-800 hover:text-white")}>
                            <I className="h-4 w-4 text-slate-500" />{label}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <AssistantButton />
            <VoiceCommand />
            <div className="relative">
              <button onClick={() => setOrgMenu((v) => !v)} className="flex items-center gap-2 rounded-full border border-line bg-ink-900 py-1 pl-1 pr-3 hover:bg-ink-800" aria-label="Conta">
                <Avatar name={ws.userName} className="h-7 w-7" />
                <span className="hidden max-w-[140px] truncate text-sm font-medium text-slate-200 sm:block">{ws.orgName}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>
              {orgMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setOrgMenu(false)} />
                  <div className="absolute right-0 top-12 z-40 w-64 animate-fadeIn rounded-2xl border border-line bg-ink-850 p-1.5 shadow-2xl">
                    <div className="px-3 py-2">
                      <p className="truncate text-sm font-semibold text-white">{ws.userName}</p>
                      <p className="text-xs text-slate-500">{roleLabel}</p>
                    </div>
                    {ws.orgs.length > 1 && (
                      <div className="border-t border-line py-1">
                        <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-slate-500">Empresas</p>
                        {ws.orgs.map((o) => (
                          <button key={o.id} onClick={() => void switchOrg(o.id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-ink-800">
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-ink-700 text-[11px] font-bold text-white">{o.name[0]?.toUpperCase()}</span>
                            <span className="flex-1 truncate">{o.name}</span>
                            {o.id === ws.orgId && <Check className="h-4 w-4 text-brand-300" />}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-line pt-1">
                      <button onClick={() => { setOrgMenu(false); replayIntro(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-ink-800"><PlayCircle className="h-4 w-4 text-slate-500" /> Ver apresentação</button>
                      <button onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-ink-800"><LogOut className="h-4 w-4 text-slate-500" /> Sair</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:hidden">
          {nav.map(({ href, label }) => (
            <Link key={href} href={href} className={cn("pill flex shrink-0 items-center border border-line", path.startsWith(href) && "pill-active border-transparent")}>
              {label}{badge(href)}
            </Link>
          ))}
        </nav>
      </header>
      <ConnectionAlert />
      <Intro />
      {ws.supportMode && <SupportBar orgId={ws.orgId} orgName={ws.orgName} />}
      <main className="min-h-0 flex-1 overflow-hidden"><CallProvider><VoipProvider>{children}</VoipProvider></CallProvider></main>
    </div>
  );
}

/** Faixa quando o dono da plataforma está dentro da conta de um cliente. */
function SupportBar({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    const res = await fetch(`/api/platform/partners/${orgId}/access`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json()).error);
    router.push("/parceiros");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-100">
      <Handshake className="h-3.5 w-3.5" />
      <span className="flex-1 truncate">Você está na conta de <b>{orgName}</b> como suporte. Tudo o que fizer aqui fica registrado.</span>
      <button onClick={() => void leave()} disabled={busy} className="rounded-md border border-amber-400/40 px-2.5 py-1 font-medium hover:bg-amber-500/20">{busy ? "Saindo…" : "Sair e voltar para Parceiros"}</button>
    </div>
  );
}

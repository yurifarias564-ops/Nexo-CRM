"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Mail, Smartphone, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { Section } from "./section";
import type { Role } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";

interface Channel { id: string; name: string; phone_number: string | null }

const ROLE: Record<Role, string> = { owner: "Proprietário", admin: "Administrador", agent: "Vendedor" };

export function TeamTab() {
  const ws = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [links, setLinks] = useState<Set<string>>(new Set());

  const loadLinks = useCallback(async () => {
    if (!ws.canManage) return;
    const sb = supabaseBrowser();
    const [{ data: ch }, { data: cm }] = await Promise.all([
      sb.from("whatsapp_channels").select("id, name, phone_number").eq("organization_id", ws.orgId).order("created_at"),
      sb.from("channel_members").select("channel_id, user_id").eq("organization_id", ws.orgId),
    ]);
    setChannels((ch ?? []) as Channel[]);
    setLinks(new Set(((cm ?? []) as { channel_id: string; user_id: string }[]).map((r) => `${r.user_id}:${r.channel_id}`)));
  }, [ws.canManage, ws.orgId]);
  useEffect(() => { const t = setTimeout(() => void loadLinks(), 0); return () => clearTimeout(t); }, [loadLinks]);

  async function toggleLink(userId: string, channelId: string) {
    const key = `${userId}:${channelId}`;
    const sb = supabaseBrowser();
    const on = links.has(key);
    const { error } = on
      ? await sb.from("channel_members").delete().eq("channel_id", channelId).eq("user_id", userId)
      : await sb.from("channel_members").insert({ organization_id: ws.orgId, channel_id: channelId, user_id: userId });
    if (error) return toast.error(error.message);
    toast.success(on ? "Número desvinculado" : "Número vinculado — os leads desse número já aparecem para essa pessoa");
    await loadLinks();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(data.error);
    toast.success(data.status === "added" ? "Adicionado à equipe" : "Convite enviado por e-mail");
    setEmail("");
    await ws.reload(["members"]);
  }
  async function changeRole(userId: string, r: Role) {
    const { error } = await supabaseBrowser().from("organization_members").update({ role: r }).eq("organization_id", ws.orgId).eq("user_id", userId);
    if (error) return toast.error(error.message);
    await ws.reload(["members"]);
  }
  async function removeMember(userId: string, name: string) {
    if (!confirm(`Remover ${name} da equipe?`)) return;
    const { error } = await supabaseBrowser().from("organization_members").delete().eq("organization_id", ws.orgId).eq("user_id", userId);
    if (error) return toast.error(error.message);
    await ws.reload(["members"]);
  }

  return (
    <Section title="Equipe" text="Vendedor vê só o Funil, as Conversas e o Time comercial dele — apenas os leads dele e os que chegam pelos números marcados abaixo. Dono e administradores veem tudo.">
      {ws.canManage && (
        <form onSubmit={invite} className="card mb-4 flex flex-wrap gap-2 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" type="email" required placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <select className="field w-auto" value={role} onChange={(e) => setRole(e.target.value as "admin" | "agent")}>
            <option value="agent">Vendedor</option>
            <option value="admin">Administrador</option>
          </select>
          <Button type="submit" loading={busy}>Convidar</Button>
        </form>
      )}
      <ul className="card divide-y divide-line">
        {ws.members.map((m) => {
          const name = m.full_name ?? m.email ?? "Usuário";
          const editable = ws.canManage && m.role !== "owner" && m.user_id !== ws.userId;
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-100">{name} {m.user_id === ws.userId && <span className="text-xs text-slate-500">(você)</span>}</p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
              {editable ? (
                <>
                  <select className="field h-8 w-auto text-xs" value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as Role)}>
                    <option value="agent">Vendedor</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-300" onClick={() => removeMember(m.user_id, name)} aria-label="Remover"><UserMinus className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <span className="rounded-full bg-ink-700 px-2.5 py-1 text-xs text-slate-300">{ROLE[m.role]}</span>
              )}
              {ws.canManage && m.role === "agent" && (
                <div className="basis-full pl-11">
                  {channels.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-500">Números que essa pessoa atende:</span>
                      {channels.map((c) => {
                        const on = links.has(`${m.user_id}:${c.id}`);
                        return (
                          <button key={c.id} type="button" onClick={() => void toggleLink(m.user_id, c.id)} aria-pressed={on}
                            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                              on ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-line text-slate-400 hover:text-slate-200")}>
                            {on ? <Check className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                            {c.phone_number ? formatPhone(c.phone_number) : c.name}{c.phone_number ? ` · ${c.name}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="text-xs text-slate-500">Conecte um número em WhatsApp para escolher quais essa pessoa atende.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

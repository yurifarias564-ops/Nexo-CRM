"use client";
import { useState } from "react";
import { Mail, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { Section } from "./section";
import type { Role } from "@/lib/types";

const ROLE: Record<Role, string> = { owner: "Proprietário", admin: "Administrador", agent: "Atendente" };

export function TeamTab() {
  const ws = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [busy, setBusy] = useState(false);

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
    <Section title="Equipe" text="Atendentes veem e atendem leads; administradores também configuram o sistema.">
      {ws.canManage && (
        <form onSubmit={invite} className="card mb-4 flex flex-wrap gap-2 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" type="email" required placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <select className="field w-auto" value={role} onChange={(e) => setRole(e.target.value as "admin" | "agent")}>
            <option value="agent">Atendente</option>
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
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-100">{name} {m.user_id === ws.userId && <span className="text-xs text-slate-500">(você)</span>}</p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
              {editable ? (
                <>
                  <select className="field h-8 w-auto text-xs" value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as Role)}>
                    <option value="agent">Atendente</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-300" onClick={() => removeMember(m.user_id, name)} aria-label="Remover"><UserMinus className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <span className="rounded-full bg-ink-700 px-2.5 py-1 text-xs text-slate-300">{ROLE[m.role]}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

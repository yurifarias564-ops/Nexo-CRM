"use client";
import { useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Unplug } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Section } from "./section";

const MESSAGES: Record<string, [ "success" | "error" | "message", string ]> = {
  ok: ["success", "Google Agenda conectado! Os agendamentos agora vão direto para a sua agenda."],
  erro: ["error", "Não foi possível conectar o Google Agenda."],
  cancelado: ["message", "Conexão com o Google cancelada."],
  config: ["error", "O Google ainda não foi configurado no servidor (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET)."],
};

export function IntegrationsTab({ googleStatus, googleMsg }: { googleStatus?: string; googleMsg?: string }) {
  const ws = useWorkspace();
  const [conn, setConn] = useState<{ google_email: string | null; connected_at: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabaseBrowser().from("google_connections").select("google_email, connected_at").eq("user_id", ws.userId).maybeSingle()
      .then(({ data }) => setConn(data ?? null));
  }, [ws.userId]);

  useEffect(() => {
    const m = googleStatus ? MESSAGES[googleStatus] : undefined;
    if (!m) return;
    const t = setTimeout(() => toast[m[0]](m[1], googleMsg ? { description: googleMsg } : undefined), 0);
    window.history.replaceState(null, "", "/settings?tab=integrations");
    return () => clearTimeout(t);
  }, [googleStatus, googleMsg]);

  async function disconnect() {
    if (!confirm("Desconectar o Google Agenda? Os próximos agendamentos ficarão só no CRM.")) return;
    setBusy(true);
    const res = await fetch("/api/google", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json()).error);
    setConn(null);
    toast.success("Google Agenda desconectado");
  }

  return (
    <Section title="Integrações" text="Cada pessoa da equipe conecta a própria conta. Os agendamentos feitos por ela vão para a agenda dela.">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800 text-brand-300">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">Google Agenda</p>
          {conn === undefined ? <p className="mt-1 text-sm text-slate-500">Verificando…</p> : conn ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-300"><CalendarCheck className="h-4 w-4" /> Conectado{conn.google_email ? ` como ${conn.google_email}` : ""}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Ao agendar por voz, pelo funil ou pelo lead, o evento é criado na sua agenda no horário escolhido.</p>
          )}
        </div>
        {conn === undefined ? <Spinner /> : conn ? (
          <Button variant="outline" onClick={disconnect} loading={busy}><Unplug className="h-4 w-4" /> Desconectar</Button>
        ) : (
          <a href="/api/google/connect" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-glow hover:bg-brand-400">
            <CalendarDays className="h-4 w-4" /> Conectar Google Agenda
          </a>
        )}
      </div>
      <div className="mt-4 rounded-lg border border-line bg-ink-950/50 p-4 text-sm text-slate-400">
        <p className="font-medium text-slate-200">Como agendar</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b className="text-slate-300">Por voz:</b> “agendamento com o Yuri amanhã às 10 horas” — o lead vai para a etapa Agendamento e o evento é criado.</li>
          <li><b className="text-slate-300">No funil:</b> arraste o lead para a coluna Agendamento e escolha dia e hora.</li>
          <li><b className="text-slate-300">No lead:</b> botão Agendar, com lista e cancelamento dos agendamentos.</li>
        </ul>
      </div>
    </Section>
  );
}

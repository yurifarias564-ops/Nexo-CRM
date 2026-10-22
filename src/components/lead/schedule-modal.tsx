"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarPlus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/ui/misc";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/Sao_Paulo"; } };

export interface ScheduleResult { google: "created" | "not_connected" | "error"; googleError?: string; googleLink?: string | null; movedTo?: string | null; summary: string }

/** Agendar compromisso com o lead (salva no CRM e cria o evento no Google Agenda). */
export function ScheduleModal({
  open, onClose, leadId, leadName, moveToScheduleStage = false, onDone,
}: { open: boolean; onClose: () => void; leadId: string | null; leadName: string; moveToScheduleStage?: boolean; onDone?: (r: ScheduleResult) => void }) {
  return (
    <Modal open={open && !!leadId} onClose={onClose} title={`Agendar com ${leadName}`}>
      {open && leadId && <Form key={leadId} leadId={leadId} leadName={leadName} moveToScheduleStage={moveToScheduleStage} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function Form({ leadId, leadName, moveToScheduleStage, onClose, onDone }: {
  leadId: string; leadName: string; moveToScheduleStage: boolean; onClose: () => void; onDone?: (r: ScheduleResult) => void;
}) {
  const ws = useWorkspace();
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d); });
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState(`Reunião com ${leadName}`);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabaseBrowser().from("google_connections").select("google_email").eq("user_id", ws.userId).maybeSingle()
      .then(({ data }) => setGoogle(data ? (data.google_email ?? "conectado") : null));
  }, [ws.userId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, start: `${date}T${time}`, durationMinutes: duration, timeZone: userTz(), title, notes: notes || undefined, moveToScheduleStage }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(body.error);
    const r = body as ScheduleResult;
    if (r.google === "created") toast.success("Agendado no Google Agenda", { description: r.summary });
    else if (r.google === "error") toast.warning("Agendado no CRM, mas o Google Agenda falhou", { description: r.googleError, duration: 10000 });
    else toast.success("Agendado no CRM", { description: "Conecte o Google em Configurações → Integrações para criar o evento automaticamente." });
    onDone?.(r);
    onClose();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia"><input type="date" className="field" required value={date} min={localDate(new Date())} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Horário"><input type="time" className="field" required value={time} step={300} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label="Título"><input className="field" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Duração">
          <select className="field" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? "30" : ""}`}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Observações (opcional)"><textarea className="field h-20 resize-none py-2" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-950/50 px-3 py-2 text-xs">
        {google === undefined ? <span className="text-slate-500">Verificando Google Agenda…</span> : google ? (
          <><CalendarCheck className="h-4 w-4 text-emerald-300" /><span className="text-slate-300">Será criado no Google Agenda de <b className="text-slate-100">{google}</b></span></>
        ) : (
          <><CalendarPlus className="h-4 w-4 text-amber-300" /><span className="flex-1 text-slate-300">Google Agenda não conectado: ficará só no CRM.</span>
            <Link href="/settings?tab=integrations" className="inline-flex items-center gap-1 text-brand-300 hover:underline">Conectar <ExternalLink className="h-3 w-3" /></Link></>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Agora não</Button>
        <Button type="submit" loading={busy}><CalendarPlus className="h-4 w-4" /> Agendar</Button>
      </div>
    </form>
  );
}

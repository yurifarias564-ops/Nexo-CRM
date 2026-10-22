"use client";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/misc";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/constants";

/** Registra uma ligação feita para o lead (entra no relatório do mês). */
export function CallModal({ open, onClose, leadId, leadName, onDone }: {
  open: boolean; onClose: () => void; leadId: string; leadName: string; onDone: (a: { id: number; type: string; payload: Record<string, unknown>; created_at: string; actor_id: string | null }) => void;
}) {
  const ws = useWorkspace();
  const [outcome, setOutcome] = useState<CallOutcome>("atendeu");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const m = minutes.trim() ? Number(minutes.replace(",", ".")) : null;
    if (m !== null && (!Number.isFinite(m) || m < 0 || m > 600)) return toast.error("Duração inválida (em minutos)");
    setBusy(true);
    const { data, error } = await supabaseBrowser().from("activities").insert({
      organization_id: ws.orgId, lead_id: leadId, actor_id: ws.userId, type: "call",
      payload: { outcome, duration_min: m, notes: notes.trim().slice(0, 2000) || null },
    }).select("id, type, payload, created_at, actor_id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ligação registrada");
    onDone(data);
    setNotes(""); setMinutes(""); setOutcome("atendeu");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Registrar ligação · ${leadName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Registrar</Button></>}>
      <div className="space-y-4">
        <div>
          <span className="label">Resultado</span>
          <div className="flex flex-wrap gap-2">
            {CALL_OUTCOMES.map((o) => (
              <button key={o.value} type="button" onClick={() => setOutcome(o.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${outcome === o.value ? "border-brand-400 bg-brand-500/15 text-brand-100" : "border-line text-slate-400 hover:border-slate-500"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">Duração (minutos, opcional)</span>
          <input className="field" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Ex.: 5" />
        </label>
        <label className="block">
          <span className="label">O que foi conversado (opcional)</span>
          <textarea className="field min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Ex.: pediu proposta até sexta" />
        </label>
      </div>
    </Modal>
  );
}

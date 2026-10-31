"use client";
import { useEffect, useState } from "react";
import { BellRing, CalendarClock, Plus, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import type { MeetingSettings, Reminder } from "@/lib/meetings-shared";

const VARS = "{{primeiro_nome}} {{data}} {{hora}} {{link}} {{vendedor}} {{empresa}}";

/** Reuniões: em quais funis a coluna de agendamento abre o agendamento, link da videochamada e lembretes. */
export function MeetingSettingsPanel() {
  const ws = useWorkspace();
  const [s, setS] = useState<MeetingSettings | null>(null);
  const [pipes, setPipes] = useState<{ id: string; name: string; schedule_on_move: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/meetings/settings").then(async (r) => {
      const j = await r.json();
      if (!r.ok) return toast.error(j.error);
      setS(j.settings); setPipes(j.pipelines);
    });
  }, []);
  if (!s) return <div className="flex justify-center py-16"><Spinner /></div>;
  const set = (p: Partial<MeetingSettings>) => { setS({ ...s, ...p }); setDirty(true); };
  const setRule = (i: number, r: Reminder) => set({ reminders: s.reminders.map((x, k) => (k === i ? r : x)) });

  async function save() {
    setBusy(true);
    const r = await fetch("/api/meetings/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s, pipelines: pipes.map((p) => ({ id: p.id, schedule_on_move: p.schedule_on_move })) }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(j.error);
    setDirty(false);
    toast.success("Reuniões salvas");
    void ws.reload(["pipelines"]);
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-white"><CalendarClock className="h-4 w-4 text-brand-300" /> Abrir o agendamento ao mover para a coluna “Agendamento”</h3>
        <p className="text-sm text-slate-400">Nos funis marcados, soltar o lead na coluna de agendamento abre a tela para escolher dia e hora. Nos outros, o lead só muda de coluna.</p>
        <div className="flex flex-wrap gap-2">
          {pipes.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm text-slate-200">
              <input type="checkbox" checked={p.schedule_on_move} disabled={!ws.canManage}
                onChange={(e) => { setPipes(pipes.map((x) => (x.id === p.id ? { ...x, schedule_on_move: e.target.checked } : x))); setDirty(true); }} />
              {p.name}
            </label>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <label className="flex items-center gap-2 font-semibold text-white">
          <input type="checkbox" checked={s.send_link} disabled={!ws.canManage} onChange={(e) => set({ send_link: e.target.checked })} />
          <Video className="h-4 w-4 text-brand-300" /> Enviar o link da videochamada ao agendar (vem marcado)
        </label>
        <textarea className="field min-h-[110px]" value={s.link_message} disabled={!ws.canManage} maxLength={2000} onChange={(e) => set({ link_message: e.target.value })} />
        <p className="text-xs text-slate-500">Pode usar: {VARS}</p>
      </section>

      <section className="card space-y-3 p-4">
        <label className="flex items-center gap-2 font-semibold text-white">
          <input type="checkbox" checked={s.reminders_enabled} disabled={!ws.canManage} onChange={(e) => set({ reminders_enabled: e.target.checked })} />
          <BellRing className="h-4 w-4 text-amber-300" /> Lembretes antes da reunião (vem marcado)
        </label>
        <p className="text-sm text-slate-400">Programados na hora em que você agenda. Lembrete que já passou é pulado (ex.: agendou às 13h para as 15h → só sai o de 30 min antes). Se cancelar a reunião, os lembretes são cancelados.</p>
        <div className="space-y-3">
          {s.reminders.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line bg-ink-900 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <select className="field w-auto" value={r.kind} disabled={!ws.canManage}
                  onChange={(e) => { const k = e.target.value as Reminder["kind"]; setRule(i, k === "before" ? { kind: "before", minutes: 30, text: r.text } : { kind: k, time: "time" in r ? r.time : "09:00", text: r.text }); }}>
                  <option value="day_before_at">Na véspera, às</option>
                  <option value="day_at">No dia da reunião, às</option>
                  <option value="before">Antes da reunião</option>
                </select>
                {r.kind === "before" ? (
                  <select className="field w-auto" value={r.minutes} disabled={!ws.canManage} onChange={(e) => setRule(i, { ...r, minutes: Number(e.target.value) })}>
                    {[5, 10, 15, 30, 45, 60, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? "s" : ""}`}</option>)}
                  </select>
                ) : (
                  <input type="time" className="field w-auto" value={r.time} disabled={!ws.canManage} onChange={(e) => setRule(i, { ...r, time: e.target.value })} />
                )}
                {ws.canManage && <button type="button" className="ml-auto rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Remover lembrete" onClick={() => set({ reminders: s.reminders.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>}
              </div>
              <textarea className="field min-h-[64px]" value={r.text} disabled={!ws.canManage} maxLength={1000} onChange={(e) => setRule(i, { ...r, text: e.target.value })} />
            </div>
          ))}
        </div>
        {ws.canManage && s.reminders.length < 8 && (
          <Button size="sm" variant="outline" onClick={() => set({ reminders: [...s.reminders, { kind: "before", minutes: 60, text: "{{primeiro_nome}}, nossa reunião começa em 1 hora. Link: {{link}}" }] })}><Plus className="h-3.5 w-3.5" /> Adicionar lembrete</Button>
        )}
        <p className="text-xs text-slate-500">Pode usar: {VARS}</p>
      </section>

      {ws.canManage && <div className="sticky bottom-2 flex justify-end"><Button onClick={() => void save()} loading={busy} disabled={!dirty}>Salvar</Button></div>}
    </div>
  );
}

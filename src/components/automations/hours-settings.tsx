"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { inHours, WEEKDAYS, type BusinessHours } from "@/lib/business-hours";
import { cn } from "@/lib/utils";

/** Horário comercial da empresa: cada dia com seu horário (vale para "dentro do horário", "esperar abrir" e "fora do expediente"). */
export function HoursSettingsPanel() {
  const ws = useWorkspace();
  const [h, setH] = useState<BusinessHours | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    fetch("/api/business-hours").then(async (r) => { const j = await r.json(); if (!r.ok) return toast.error(j.error); setH(j.hours); });
  }, []);
  if (!h) return <div className="flex justify-center py-16"><Spinner /></div>;
  const setDay = (i: number, p: Partial<BusinessHours["days"][number]>) => { setH({ ...h, days: h.days.map((d, k) => (k === i ? { ...d, ...p } : d)) }); setDirty(true); };
  const open = inHours(h);

  async function save() {
    setBusy(true);
    const r = await fetch("/api/business-hours", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(h) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(j.error);
    setDirty(false);
    toast.success("Horário salvo");
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 font-semibold text-white">Horário em que o time de vendas trabalha</h3>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", open ? "bg-emerald-500/15 text-emerald-300" : "bg-indigo-500/15 text-indigo-200")}>
            {open ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />} Agora: {open ? "em expediente" : "fora do expediente"}
          </span>
        </div>
        <p className="text-sm text-slate-400">Vale para os blocos “Esperar horário comercial” e “Se… está em horário comercial”, e para o gatilho de mensagem “só fora do expediente” (noite, madrugada, fim de semana). Pode passar da meia-noite (ex.: 18:00 às 02:00).</p>
        <div className="divide-y divide-line rounded-lg border border-line">
          {h.days.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <label className="flex w-32 items-center gap-2 text-slate-200"><input type="checkbox" checked={d.on} disabled={!ws.canManage} onChange={(e) => setDay(i, { on: e.target.checked })} /> {WEEKDAYS[i]}</label>
              {d.on ? (
                <div className="flex items-center gap-2">
                  <input type="time" className="field h-9 w-auto" value={d.start} disabled={!ws.canManage} onChange={(e) => setDay(i, { start: e.target.value })} />
                  <span className="text-slate-500">às</span>
                  <input type="time" className="field h-9 w-auto" value={d.end === "24:00" ? "23:59" : d.end} disabled={!ws.canManage} onChange={(e) => setDay(i, { end: e.target.value })} />
                </div>
              ) : <span className="text-slate-500">Fechado</span>}
            </div>
          ))}
        </div>
      </section>
      {ws.canManage && <div className="flex justify-end"><Button onClick={() => void save()} loading={busy} disabled={!dirty}>Salvar horário</Button></div>}
    </div>
  );
}
